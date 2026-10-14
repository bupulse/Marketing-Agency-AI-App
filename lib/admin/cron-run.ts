import "server-only";
import { prisma } from "@/lib/db";
import { scrubSecrets } from "./scrub";
import { runAsBackgroundJob } from "@/lib/platform/background-job";

const KEEP_DAYS = 14;

function summarise(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  try {
    return scrubSecrets(JSON.stringify(result), 400);
  } catch {
    return null;
  }
}

/**
 * Runs a cron job and records it in CronRun for the admin health page: one row when it ends, with the outcome.
 * The job's result passes through untouched and an error is re-thrown, so the route behaves exactly as before.
 * A failed write of the record is ignored: monitoring must never break the job.
 */
export async function recordCron<T>(job: string, run: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  let result: T;
  try {
    // Emails a job sends link to the public address, not to the host the cron was called on.
    result = await runAsBackgroundJob(run);
  } catch (error) {
    await write(job, startedAt, false, null, error instanceof Error ? error.message : String(error));
    throw error;
  }
  // A job that throws, or answers with { ok: false } or an error string, is not healthy even though it returned. (A "failed" count
  // in the summary is shown but does not mark the run unhealthy: one failed post is normal for the publisher.)
  const r = result as { ok?: unknown; error?: unknown } | null;
  const failed = typeof r === "object" && r !== null && (r.ok === false || typeof r.error === "string");
  await write(job, startedAt, !failed, summarise(result), failed && typeof r?.error === "string" ? r.error.slice(0, 300) : null);
  return result;
}

async function write(job: string, startedAt: Date, ok: boolean, summary: string | null, error: string | null) {
  try {
    await prisma.cronRun.create({ data: { job, startedAt, finishedAt: new Date(), ok, summary: summary ? scrubSecrets(summary, 400) : null, error: error ? scrubSecrets(error, 500) : null } });
    // Old rows are cleaned up now and then, not on every run (publish runs every minute).
    if (Math.random() < 0.01) await prisma.cronRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
  } catch (e) {
    console.error("[cron-run] could not record", job, e instanceof Error ? e.message : e);
  }
}
