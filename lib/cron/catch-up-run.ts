import "server-only";
import { prisma } from "@/lib/db";
import { CATCH_UP_BUDGET_MS, CATCH_UP_JOB, catchUpCandidates, LOOKBACK_MS, MAX_PER_TICK, missedJobs, type CatchUpSummary } from "./catch-up";
import { runTickJob } from "./tick";

// The tick's catch-up step (lib/cron/catch-up.ts has the rules): reads each job's last start, runs the missed ones the
// same way the tick runs a due job (its own route, with the CRON_SECRET bearer), and writes one "catch-up" CronRun row
// so Admin -> Health can say "caught up". Looks every 5 minutes and right after the server starts (and every minute
// while more are waiting), so the tick's every-minute path stays one cheap check. Never throws.

/** Missed time already tried, per job, for this server process. */
const attempted = new Map<string, string>();
let lastLookAt = 0;
let morePending = false;
const LOOK_EVERY_MS = 5 * 60_000;

type Db = Pick<typeof prisma, "cronRun">;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type CaughtUp = { job: string; slot: string; ok: boolean; calls: number };

/** Tests: forget what this process tried. */
export function resetCatchUpForTests() {
  attempted.clear();
  lastLookAt = 0;
  morePending = false;
}

export async function runCatchUp(now: Date, options: { origin: string; secret: string; stopAt?: number; fetchImpl?: FetchLike; db?: Db }): Promise<CaughtUp[]> {
  try {
    if (lastLookAt && !morePending && now.getTime() - lastLookAt < LOOK_EVERY_MS) return [];
    lastLookAt = now.getTime();
    const db = options.db ?? prisma;
    const names = catchUpCandidates().map((c) => c.job);
    const rows = await db.cronRun.groupBy({ by: ["job"], where: { job: { in: names }, startedAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } }, _max: { startedAt: true } });
    const lastStarts = new Map<string, Date | null>(names.map((n) => [n, rows.find((r) => r.job === n)?._max.startedAt ?? null]));
    const missed = missedJobs(now, lastStarts, attempted);
    morePending = missed.length > MAX_PER_TICK;
    const done: CaughtUp[] = [];
    // Its own small budget, never more than what is left of the tick's.
    const stopAt = Math.min(Date.now() + CATCH_UP_BUDGET_MS, options.stopAt ?? Number.POSITIVE_INFINITY);
    for (const m of missed.slice(0, MAX_PER_TICK)) {
      if (Date.now() > stopAt) {
        morePending = true;
        break;
      }
      attempted.set(m.job, m.slot.toISOString());
      console.log(`[cron] catching up ${m.path} (missed ${m.slot.toISOString()})`);
      const r = await runTickJob(m.path, { origin: options.origin, secret: options.secret, fetchImpl: options.fetchImpl, stopAt });
      done.push({ job: m.job, slot: m.slot.toISOString(), ok: r.ok, calls: r.calls });
    }
    if (done.length) {
      const summary: CatchUpSummary = { jobs: done.map((d) => ({ job: d.job, slot: d.slot, ok: d.ok })) };
      await db.cronRun
        .create({ data: { job: CATCH_UP_JOB, startedAt: now, finishedAt: new Date(), ok: done.every((d) => d.ok), summary: JSON.stringify(summary).slice(0, 1_000), error: null } })
        .catch((e: unknown) => console.error("[cron] could not record the catch-up", e instanceof Error ? e.message : e));
    }
    return done;
  } catch (error) {
    console.error("[cron] catch-up failed:", error instanceof Error ? error.message : error);
    return [];
  }
}
