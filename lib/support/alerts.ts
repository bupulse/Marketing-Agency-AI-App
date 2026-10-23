import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { allowedEndpoint, vapidKeys } from "@/lib/push/service";
import { sendWebPush } from "@/lib/push/web-push";
import { renderEmail, sendEmail } from "@/lib/publishing/email";

// Telling agents a chat needs them (docs/SUPPORT_CHAT.md section 3): a push to their phones and browsers at once,
// an email when nobody replied after 2 minutes (jobs.ts), never WhatsApp (built later, it needs the paid API).
// "On duty" means an active, unlocked agent who is online or away; with a department, its members first.

/** The support app's address: SUPPORT_APP_URL (https://support.bupulse.com), else this site's /support. */
export function supportAppUrl(path = "/"): string {
  const base = (process.env.SUPPORT_APP_URL || `${publicSiteUrl()}/support`).replace(/\/$/, "");
  return path === "/" ? base : `${base}${path}`;
}

export const chatLink = (conversationId: string) => supportAppUrl(`/chats/${conversationId}`);

export async function agentsOnDuty(departmentId: string | null): Promise<{ id: string; email: string; name: string }[]> {
  const base: Prisma.SupportAgentWhereInput = { status: "active", lockedAt: null, availability: { in: ["online", "away"] } };
  const select = { id: true, email: true, name: true } as const;
  if (departmentId) {
    const members = await prisma.supportAgent.findMany({ where: { ...base, departments: { some: { departmentId } } }, select });
    if (members.length) return members;
  }
  return prisma.supportAgent.findMany({ where: base, select });
}

/** A push to every device of the agents on duty. Gone subscriptions are removed. Never throws. */
export async function pushToAgents(conversationId: string, title: string): Promise<number> {
  const keys = vapidKeys();
  if (!keys) return 0;
  try {
    const c = await prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { number: true, departmentId: true, visitor: { select: { name: true, businessName: true } } } });
    if (!c) return 0;
    const agents = await agentsOnDuty(c.departmentId);
    const devices = await prisma.supportDevice.findMany({ where: { agentId: { in: agents.map((a) => a.id) }, kind: "webpush" }, take: 50, select: { id: true, endpoint: true, keys: true } });
    const message = { title, body: `#${c.number} ${c.visitor.name ?? c.visitor.businessName ?? "A visitor"}`, url: chatLink(conversationId), tag: `support-${conversationId}` };
    const results = await Promise.all(
      devices.map(async (d) => {
        const k = (d.keys ?? {}) as { p256dh?: string; auth?: string };
        if (!k.p256dh || !k.auth || !allowedEndpoint(d.endpoint)) return { id: d.id, ok: false, gone: false };
        try {
          return { id: d.id, ...(await sendWebPush({ endpoint: d.endpoint, p256dh: k.p256dh, auth: k.auth }, message, keys, { urgency: "high" })) };
        } catch {
          return { id: d.id, ok: false, gone: false };
        }
      }),
    );
    const gone = results.filter((r) => r.gone).map((r) => r.id);
    const sent = results.filter((r) => r.ok).map((r) => r.id);
    if (gone.length) await prisma.supportDevice.deleteMany({ where: { id: { in: gone } } });
    if (sent.length) await prisma.supportDevice.updateMany({ where: { id: { in: sent } }, data: { lastSentAt: new Date() } });
    return sent.length;
  } catch (error) {
    await logError(error, { source: "support.push", level: "warn" });
    return 0;
  }
}

/** The "a chat has waited 2 minutes" email to each agent on duty. Returns how many were sent. */
export async function emailWaitingChat(c: { id: string; number: number; departmentId: string | null; visitorName: string; preview: string }): Promise<number> {
  const agents = await agentsOnDuty(c.departmentId);
  const sent = await Promise.all(
    agents.map((a) => {
      const { html, text } = renderEmail({
        heading: `Chat #${c.number} is waiting`,
        intro: `${c.visitorName} has been waiting for a person for 2 minutes and nobody has replied yet.`,
        blocks: c.preview ? [{ label: "Last message", value: c.preview }] : [],
        button: { label: "Open the chat", url: chatLink(c.id) },
        footer: "You get this because you are on duty in the BuPulse support app. Set yourself to offline to stop these emails.",
      });
      return sendEmail({ to: a.email, subject: `Chat #${c.number} is waiting for a reply`, html, text });
    }),
  );
  return sent.filter(Boolean).length;
}
