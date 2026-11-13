import { CRON_JOBS, nextRun, prevRun } from "@/lib/admin/cron";
import { CRON_ROUTES } from "@/worker-crons";

// Catching up scheduled jobs that were missed (docs/SELF_HOST.md, "Missed jobs"): the self-hosted PC's tick only runs
// the jobs due in the minute it runs, so a power cut, a restart or a long tick that skipped a job's minute left it
// "overdue" on Admin -> Health until its next time, up to a day later for the daily ones. The tick now runs each missed
// job ONCE when the server is back. Pure (no database): tests/cron/catch-up.test.ts.
//
// Safe for clients:
// - Every job route only acts on what is due and claims its work first (one digest per business and day, one notice
//   per renewal, one daily-posts run per company and day, ...): each says "safe to run twice" at its top.
// - The publisher is never caught up: it runs every minute anyway, claims each post atomically (a post is published
//   once), never sends a post again that was mid-publish when the power went (it becomes "check the network", lib/
//   publishing/engine.ts sweepStalePosts), and leaves posts from a past local day to the carry-over, which reschedules
//   them (the daily-posts job, itself caught up here).
// - A missed time counts only once it is CATCH_UP_DELAY_MS old (a run of that time may still be going) and only when
//   no run started since; a job due again within NEXT_SOON_MS just waits; at most MAX_PER_TICK jobs per tick, and each
//   missed time is tried once per server process (a job that fails is not retried every minute).

export const CATCH_UP_JOB = "catch-up";
export const CATCH_UP_DELAY_MS = 20 * 60_000;
/** Jobs that run this often or more (the publisher, the Video Studio sweep) run again soon on their own. */
export const MIN_PERIOD_MS = 30 * 60_000;
export const NEXT_SOON_MS = 15 * 60_000;
/** Older missed times are not run (a job missed for over a week waits for its next time). */
export const MAX_AGE_MS = 7 * 86_400_000;
export const MAX_PER_TICK = 3;
/** How far back the tick reads each job's last start. */
export const LOOKBACK_MS = 8 * 86_400_000;

export type MissedJob = { job: string; path: string; slot: Date };

/** The jobs the tick runs (it calls /api/cron/<job>), apart from the frequent ones. */
export function catchUpCandidates(routes: Record<string, string> = CRON_ROUTES): { job: string; cron: string; path: string }[] {
  const paths = new Set(Object.values(routes));
  return CRON_JOBS.map((j) => ({ job: j.job, cron: j.cron, path: `/api/cron/${j.job}` })).filter((j) => paths.has(j.path) && j.job !== "publish");
}

/**
 * The jobs whose latest scheduled time was missed. `lastStarts`: each job's latest recorded start (a job with no record
 * at all is never caught up: it may be new or switched off). `attempted`: job -> missed time already tried.
 */
export function missedJobs(now: Date, lastStarts: Map<string, Date | null>, attempted: Map<string, string> = new Map(), routes: Record<string, string> = CRON_ROUTES): MissedJob[] {
  const out: MissedJob[] = [];
  for (const j of catchUpCandidates(routes)) {
    const slot = prevRun(j.cron, new Date(now.getTime() - CATCH_UP_DELAY_MS));
    if (!slot || now.getTime() - slot.getTime() > MAX_AGE_MS) continue;
    const after = nextRun(j.cron, slot);
    if (!after || after.getTime() - slot.getTime() <= MIN_PERIOD_MS) continue;
    const next = nextRun(j.cron, now);
    if (next && next.getTime() - now.getTime() <= NEXT_SOON_MS) continue;
    const last = lastStarts.get(j.job);
    if (!last || last.getTime() >= slot.getTime()) continue;
    if (attempted.get(j.job) === slot.toISOString()) continue;
    out.push({ job: j.job, path: j.path, slot });
  }
  return out;
}

/** What the tick writes in its "catch-up" CronRun row, and Health reads back. */
export type CatchUpSummary = { jobs: { job: string; slot: string; ok: boolean }[] };

export function readCatchUpSummary(summary: string | null): CatchUpSummary["jobs"] {
  try {
    const v = JSON.parse(summary ?? "") as CatchUpSummary;
    return Array.isArray(v?.jobs) ? v.jobs.filter((j) => typeof j?.job === "string" && typeof j?.slot === "string") : [];
  } catch {
    return [];
  }
}
