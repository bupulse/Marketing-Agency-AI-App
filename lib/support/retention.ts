import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { scheduleJob } from "@/lib/jobs/due";
import { AI_CHAT_IDLE_CLOSE_MS, IP_RETENTION_MS, PAGE_HIT_RETENTION_MS, UPLOAD_SLOT_MS, VISIT_IDLE_MS } from "./limits";
import { JOB_JUDGE } from "./answer";
import { removeObjects } from "./storage";

// The support chat's clean-up (docs/SUPPORT_CHAT.md section 7 and the privacy policy): visits idle 20 minutes are
// closed, IP addresses are cut 30 days after the visit (the country stays), page hits go after 30 days, attachments are
// deleted when they expire (and upload slots nobody finished after an hour), and AI-only chats with nothing new for a day
// are closed. Run hourly by the "support.sweep" job. Idempotent: running it twice changes nothing the second time.

export type SweepResult = { visitsClosed: number; ipsCleared: number; pageHitsDeleted: number; filesDeleted: number; chatsClosed: number };

/** The cut-off times for one run, from `now`. Pure, for the tests. */
export function sweepCutoffs(now: Date) {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  return { visitIdle: ago(VISIT_IDLE_MS), ip: ago(IP_RETENTION_MS), pageHits: ago(PAGE_HIT_RETENTION_MS), uploadSlot: ago(UPLOAD_SLOT_MS), aiChat: ago(AI_CHAT_IDLE_CLOSE_MS) };
}

export async function sweepSupport(now = new Date()): Promise<SweepResult> {
  const cut = sweepCutoffs(now);
  const visits = await prisma.$executeRaw`UPDATE "SupportVisit" SET "endedAt" = "lastSeenAt" WHERE "endedAt" IS NULL AND "lastSeenAt" < ${cut.visitIdle}`;
  const ips = await prisma.supportVisit.updateMany({ where: { startedAt: { lt: cut.ip }, OR: [{ ip: { not: null } }, { city: { not: null } }, { region: { not: null } }] }, data: { ip: null, city: null, region: null } });
  const hits = await prisma.supportPageHit.deleteMany({ where: { at: { lt: cut.pageHits } } });

  // Files: expired ones, and slots never finished. Storage first, then the rows (a storage error keeps the rows for the next run).
  let files = 0;
  const gone = await prisma.supportAttachment.findMany({ where: { OR: [{ expiresAt: { lt: now } }, { uploadedAt: null, createdAt: { lt: cut.uploadSlot } }] }, select: { id: true, storagePath: true }, take: 500 });
  if (gone.length) {
    try {
      await removeObjects(gone.map((a) => a.storagePath));
      files = (await prisma.supportAttachment.deleteMany({ where: { id: { in: gone.map((a) => a.id) } } })).count;
    } catch (error) {
      await logError(error, { source: "support.sweep.files", level: "warn" });
    }
  }

  let chatsClosed = 0;
  const idle = await prisma.supportConversation.findMany({ where: { status: "AI", lastMessageAt: { lt: cut.aiChat } }, select: { id: true }, take: 500 });
  if (idle.length) {
    const ids = idle.map((c) => c.id);
    await prisma.supportConversation.updateMany({ where: { id: { in: ids }, status: "AI" }, data: { status: "CLOSED", closedAt: now, closedBy: "system" } });
    // Only the ones this run closed: an agent may have taken one in between.
    const closed = (await prisma.supportConversation.findMany({ where: { id: { in: ids }, status: "CLOSED", closedBy: "system", closedAt: now }, select: { id: true } })).map((c) => c.id);
    chatsClosed = closed.length;
    if (closed.length) await prisma.supportEvent.createMany({ data: closed.map((conversationId) => ({ name: "closed", conversationId, at: now })) });
    for (const id of closed) await scheduleJob({ kind: JOB_JUDGE, runAt: now, payload: { conversationId: id }, dedupeKey: `${JOB_JUDGE}:${id}` });
  }
  await prisma.supportConversation.updateMany({ where: { visitorDraftAt: { lt: cut.visitIdle } }, data: { visitorDraft: null, visitorDraftAt: null } });
  return { visitsClosed: Number(visits), ipsCleared: ips.count, pageHitsDeleted: hits.count, filesDeleted: files, chatsClosed };
}
