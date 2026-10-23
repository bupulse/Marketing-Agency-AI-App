import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { registerJobHandler, scheduleJob } from "@/lib/jobs/due";
import { judgeResolved } from "./ai";
import { emailWaitingChat } from "./alerts";
import { JOB_JUDGE, historyFor } from "./answer";
import { JOB_REPLY_EMAIL, JOB_TRANSCRIPT, sendReplyEmail, sendTicketEmail, sendTranscriptEmail } from "./emails";
import { JOB_ALERT, JOB_TICKET } from "./handover";
import { JUDGE_AFTER_MS } from "./limits";
import { sweepSupport } from "./retention";
import { getSupportSettings, teamHours } from "./settings";

// The support chat's background work, as DueJobs run by the every-minute cron (lib/jobs/due.ts, app/api/cron/publish):
//   support.alert        2 minutes after a hand-over in team hours: email the agents on duty if nobody replied (once)
//   support.ticket       a hand-over outside team hours: the "we got your message" email to the visitor
//   support.reply_email  2 minutes after an agent's reply: email it to a visitor who has not seen it in the chat
//   support.transcript   the transcript the visitor asked for when rating
//   support.judge        2 hours after an AI-only chat's last message (or when it closes): did the AI resolve it?
//   support.sweep        hourly: retention and idle visits (retention.ts); it schedules its own next run
// Handlers are safe to run twice. A failed email throws, so the job retries with a growing delay.

export const JOB_SWEEP = "support.sweep";
const SWEEP_EVERY_MS = 60 * 60 * 1000;

const idOf = (payload: unknown) => (payload && typeof payload === "object" && typeof (payload as { conversationId?: unknown }).conversationId === "string" ? (payload as { conversationId: string }).conversationId : null);

let sweepScheduledAt = 0;

/** Makes sure the hourly sweep exists (once per server instance an hour; a pending sweep is never moved). */
export function scheduleSweep(now = Date.now()) {
  if (now - sweepScheduledAt < SWEEP_EVERY_MS) return;
  sweepScheduledAt = now;
  prisma.dueJob
    .createMany({ data: [{ kind: JOB_SWEEP, runAt: new Date(now), payload: {}, dedupeKey: JOB_SWEEP }], skipDuplicates: true })
    .catch((error) => logError(error, { source: "support.sweep.schedule", level: "warn" }));
}

export async function runAlert(payload: unknown, now = new Date()) {
  const id = idOf(payload);
  const handoverAt = typeof (payload as { handoverAt?: unknown })?.handoverAt === "string" ? new Date((payload as { handoverAt: string }).handoverAt) : null;
  if (!id || !handoverAt) return;
  if (!teamHours(await getSupportSettings(), now).open) return;
  // Claim first: the same hand-over is emailed once even if the job runs twice.
  const { count } = await prisma.supportConversation.updateMany({ where: { id, status: "WAITING", handoverAt, alertSentAt: null, firstHumanReplyAt: null }, data: { alertSentAt: now } });
  if (!count) return;
  const c = await prisma.supportConversation.findUnique({ where: { id }, select: { number: true, departmentId: true, visitor: { select: { name: true, businessName: true } } } });
  const last = await prisma.supportMessage.findFirst({ where: { conversationId: id, author: "VISITOR" }, orderBy: { createdAt: "desc" }, select: { body: true } });
  if (c) await emailWaitingChat({ id, number: c.number, departmentId: c.departmentId, visitorName: c.visitor.name ?? c.visitor.businessName ?? "A visitor", preview: last?.body.slice(0, 300) ?? "" });
}

export async function runJudge(payload: unknown, now = new Date()) {
  const id = idOf(payload);
  if (!id) return;
  const c = await prisma.supportConversation.findUnique({ where: { id }, select: { status: true, handoverAt: true, agentReplyCount: true, aiReplyCount: true, rating: true, aiResolved: true, lastMessageAt: true } });
  if (!c || c.aiResolved !== null || c.aiReplyCount === 0) return;
  const set = async (resolved: boolean) => {
    await prisma.supportConversation.updateMany({ where: { id, aiResolved: null }, data: { aiResolved: resolved } });
    if (resolved) await prisma.supportEvent.create({ data: { name: "ai_resolved", conversationId: id, at: now } });
  };
  // Only chats no person touched count (Zendesk's rule, docs/research 2.6).
  if (c.handoverAt || c.agentReplyCount > 0 || c.rating === -1) return set(false);
  if (c.rating === 1) return set(true);
  if (c.status !== "CLOSED" && now.getTime() - c.lastMessageAt.getTime() < JUDGE_AFTER_MS) {
    await scheduleJob({ kind: JOB_JUDGE, runAt: new Date(c.lastMessageAt.getTime() + JUDGE_AFTER_MS), payload: { conversationId: id }, dedupeKey: `${JOB_JUDGE}:${id}` });
    return;
  }
  const rows = await prisma.supportMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 40, select: { author: true, kind: true, body: true, attachment: { select: { transcript: true } } } });
  await set(await judgeResolved(historyFor(rows)));
}

const mustSend = (sent: boolean, what: string) => {
  if (!sent) throw new Error(`${what} email not sent`);
};

registerJobHandler(JOB_ALERT, (job) => runAlert(job.payload));
registerJobHandler(JOB_TICKET, async (job) => {
  const id = idOf(job.payload);
  if (id) mustSend(await sendTicketEmail(id), "Ticket");
});
registerJobHandler(JOB_REPLY_EMAIL, async (job) => {
  const id = idOf(job.payload);
  if (id) mustSend(await sendReplyEmail(id), "Reply");
});
registerJobHandler(JOB_TRANSCRIPT, async (job) => {
  const id = idOf(job.payload);
  if (id) mustSend(await sendTranscriptEmail(id), "Transcript");
});
registerJobHandler(JOB_JUDGE, (job) => runJudge(job.payload));
registerJobHandler(JOB_SWEEP, async () => {
  const result = await sweepSupport();
  await scheduleJob({ kind: JOB_SWEEP, runAt: new Date(Date.now() + SWEEP_EVERY_MS), payload: { last: result }, dedupeKey: JOB_SWEEP });
});
