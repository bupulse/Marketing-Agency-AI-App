import "server-only";
import { prisma } from "@/lib/db";
import { scheduleJob } from "@/lib/jobs/due";
import { waitUntil } from "@/lib/platform/background";
import type { DepartmentKey, HandoverReason, Hours } from "./contract";
import { pushToAgents } from "./alerts";
import { ALERT_AFTER_MS } from "./limits";
import { broadcast } from "./realtime";
import { getSupportSettings, teamHours } from "./settings";

// Handing a chat from the AI to people (docs/SUPPORT_CHAT.md section 2): the AI goes quiet, the chat waits for the
// department it belongs to, and the agents are alerted at once (push) and by email after 2 minutes without a reply.
// Outside team hours the chat becomes a ticket (PENDING): the visitor is told when the team is back and gets an email,
// and the team replies when it opens. Safe to call twice: only a chat the AI is answering is handed over.

export const JOB_ALERT = "support.alert";
export const JOB_TICKET = "support.ticket";

const REASON_TEXT: Record<HandoverReason, string> = {
  asked: "asked for a person",
  not_confident: "the AI was not sure",
  upset: "the visitor sounds upset",
  topic: "a topic the team always handles",
  outside_hours: "outside team hours",
  agent: "an agent took over",
};

/** What the visitor reads when there is no AI answer to say it (the AI is off, failed, or they pressed the button). */
export function handoverText(language: string | null, hours: Hours): string {
  const fr = language === "fr";
  if (hours.open) return fr ? "Je fais venir une personne de notre équipe. Elle vous répondra ici dans un instant." : "I'm getting a person from our team. They will reply here shortly.";
  if (fr) return `Notre équipe est absente pour le moment${hours.opensAt ? ` (retour à ${hours.opensAt})` : ""}. Votre message est transmis : elle vous répondra ici et par e-mail.`;
  return `Our team is away right now (${hours.label}). I've passed your message on: they will reply here and by email when they are back.`;
}

/** Hands the chat over. Returns false when it was not with the AI (already handed over, with a person, or closed). */
export async function handOver(conversationId: string, reason: HandoverReason, opts: { department?: DepartmentKey | null; now?: Date } = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const hours = teamHours(await getSupportSettings(), now);
  const department = opts.department ? await prisma.supportDepartment.findUnique({ where: { key: opts.department }, select: { id: true } }) : null;
  const status = hours.open ? "WAITING" : "PENDING";
  const current = await prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { tags: true } });
  const { count } = await prisma.supportConversation.updateMany({
    where: { id: conversationId, status: "AI" },
    data: {
      status,
      aiActive: false,
      handoverAt: now,
      handoverReason: reason,
      waitingSince: now,
      alertSentAt: null,
      ticketSentAt: null,
      ...(department ? { departmentId: department.id } : {}),
      ...(!hours.open && current && !current.tags.includes("outside hours") ? { tags: [...current.tags, "outside hours"].slice(0, 8) } : {}),
    },
  });
  if (!count) return false;
  await prisma.$transaction([
    // EVENT bodies are shown to the visitor as they are (a divider line); the reason stays in handoverReason for agents.
    prisma.supportMessage.create({ data: { conversationId, author: "SYSTEM", kind: "EVENT", body: hours.open ? "Waiting for a person from the BuPulse team" : `Sent to the BuPulse team · ${hours.label}` } }),
    prisma.supportEvent.create({ data: { name: "handover", conversationId, at: now } }),
  ]);
  if (hours.open) {
    await scheduleJob({ kind: JOB_ALERT, runAt: new Date(now.getTime() + ALERT_AFTER_MS), payload: { conversationId, handoverAt: now.toISOString() }, dedupeKey: `${JOB_ALERT}:${conversationId}` });
  } else {
    await scheduleJob({ kind: JOB_TICKET, runAt: now, payload: { conversationId }, dedupeKey: `${JOB_TICKET}:${conversationId}` });
  }
  await broadcast({ type: "handover", conversationId, reason }, { inbox: true, conversation: conversationId });
  await broadcast({ type: "conversation.updated", conversationId, fields: ["status"] }, { visitor: conversationId });
  if (hours.open) waitUntil(pushToAgents(conversationId, `Chat waiting: ${REASON_TEXT[reason]}`));
  return true;
}
