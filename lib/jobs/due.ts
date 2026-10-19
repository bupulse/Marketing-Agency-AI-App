import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

// Work to do at a given time (DueJob): resume an automation after a "wait" step, time out a question nobody answered,
// check a social account for new comments. Any module registers a handler for its job kind; the every-minute cron
// (app/api/cron/publish, which runs runDueJobs after the publisher) claims what is due and runs it.
//
// Rules: a handler must be safe to run twice (a job can be retried after a crash), must not throw for an expected
// outcome (return normally), and should finish in seconds. A thrown error retries the job with a growing delay, up to
// MAX_ATTEMPTS, then marks it FAILED with the error.

export type DueJobHandler = (job: { id: string; businessId: string | null; payload: Prisma.JsonValue; attempts: number }) => Promise<void>;

const handlers = new Map<string, DueJobHandler>();

/** Registers the handler for a job kind ("automation.resume", "social.poll", ...). The last registration wins. */
export function registerJobHandler(kind: string, handler: DueJobHandler): void {
  handlers.set(kind, handler);
}

export const MAX_ATTEMPTS = 5;
/** Jobs claimed per cron call; the rest wait for the next minute. */
export const BATCH = 25;
/** A RUNNING job older than this was abandoned by a crashed call and may be claimed again. */
const STALE_MS = 5 * 60 * 1000;
/** Time budget for one cron call, so it ends well inside the platform's limits. */
const BUDGET_MS = 40 * 1000;

/**
 * Schedules a job. With a `dedupeKey`, at most one job with that key is pending at a time: scheduling again moves the
 * pending one to the new time and payload instead of adding a second (the key is cleared when the job ends).
 */
export async function scheduleJob(input: { kind: string; runAt: Date; payload?: Prisma.InputJsonValue; businessId?: string | null; dedupeKey?: string }) {
  const data = { kind: input.kind, runAt: input.runAt, payload: input.payload ?? {}, businessId: input.businessId ?? null };
  if (!input.dedupeKey) return prisma.dueJob.create({ data });
  return prisma.dueJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: { ...data, dedupeKey: input.dedupeKey },
    update: { ...data, status: "PENDING", attempts: 0, lastError: null, claimedAt: null },
  });
}

/** Cancels the pending job with this key, if any. */
export async function cancelJob(dedupeKey: string): Promise<void> {
  await prisma.dueJob.deleteMany({ where: { dedupeKey, status: "PENDING" } });
}

/** Retry delay after `attempts` failures: 1, 2, 4, 8 minutes. */
export function retryDelayMs(attempts: number): number {
  return 60_000 * 2 ** Math.max(0, attempts - 1);
}

/** Claims one due job atomically (two cron calls never get the same job). */
async function claimOne(now: Date) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "DueJob" SET "status" = 'RUNNING', "claimedAt" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "DueJob"
      WHERE ("status" = 'PENDING' AND "runAt" <= ${now})
         OR ("status" = 'RUNNING' AND "claimedAt" < ${new Date(now.getTime() - STALE_MS)})
      ORDER BY "runAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  if (!rows.length) return null;
  return prisma.dueJob.findUnique({ where: { id: rows[0].id } });
}

/** Runs the jobs that are due, oldest first, within the batch size and time budget. */
export async function runDueJobs(now = () => new Date()): Promise<{ ran: number; failed: number; retried: number; unknown: number }> {
  const started = Date.now();
  const result = { ran: 0, failed: 0, retried: 0, unknown: 0 };
  for (let i = 0; i < BATCH && Date.now() - started < BUDGET_MS; i++) {
    const job = await claimOne(now());
    if (!job) break;
    const handler = handlers.get(job.kind);
    if (!handler) {
      // A kind with no handler in this build (an older or newer deploy wrote it): leave it for a build that knows it.
      result.unknown++;
      await prisma.dueJob.update({ where: { id: job.id }, data: { status: "PENDING", runAt: new Date(now().getTime() + 10 * 60_000), attempts: { decrement: 1 } } });
      continue;
    }
    try {
      await handler({ id: job.id, businessId: job.businessId, payload: job.payload, attempts: job.attempts });
      // Only a job still RUNNING is finished: a handler that scheduled its own key again (scheduleJob upserts the
      // same row back to PENDING) keeps that new run.
      await prisma.dueJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "DONE", doneAt: now(), dedupeKey: null } });
      result.ran++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (job.attempts >= MAX_ATTEMPTS) {
        await prisma.dueJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: message, doneAt: now(), dedupeKey: null } });
        result.failed++;
      } else {
        await prisma.dueJob.update({ where: { id: job.id }, data: { status: "PENDING", lastError: message, runAt: new Date(now().getTime() + retryDelayMs(job.attempts)) } });
        result.retried++;
      }
      console.error(`[jobs.${job.kind}]`, message);
    }
  }
  return result;
}

/** Deletes finished jobs older than `days` (kept a while for the admin to look at). */
export async function pruneDueJobs(days = 14): Promise<number> {
  const { count } = await prisma.dueJob.deleteMany({ where: { status: { in: ["DONE", "FAILED"] }, doneAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return count;
}
