import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { CRON_JOBS } from "@/lib/admin/cron";
import { CATCH_UP_JOB, catchUpCandidates, missedJobs, readCatchUpSummary } from "@/lib/cron/catch-up";
import { resetCatchUpForTests, runCatchUp } from "@/lib/cron/catch-up-run";

const at = (iso: string) => new Date(iso);
/** Every job last ran at `iso` (as if the server went off right after). */
const allLast = (iso: string) => new Map(CRON_JOBS.map((j) => [j.job, at(iso)] as [string, Date | null]));

describe("missed jobs after a power cut", () => {
  // Off from 01:00 to 06:30 UTC on Friday 13 November 2026.
  const back = at("2026-11-13T06:30:00Z");
  const last = allLast("2026-11-13T00:59:00Z");

  it("runs each daily job whose time passed while the server was off, once", () => {
    const jobs = missedJobs(back, last).map((m) => m.job);
    for (const daily of ["store-sync", "analytics-rollup", "plan-price-changes", "media-cleanup", "purge-accounts", "social-refresh"]) expect(jobs).toContain(daily);
    // Mobile Money renewals (05:41, 49 minutes before the server came back) too.
    expect(jobs).toContain("momo-renewals");
  });

  it("never catches up the publisher or the jobs that run every few minutes (they run again on their own)", () => {
    const jobs = missedJobs(back, last).map((m) => m.job);
    expect(jobs).not.toContain("publish");
    expect(jobs).not.toContain("video-jobs");
    expect(jobs).not.toContain("autopilot-visuals");
    expect(catchUpCandidates().map((c) => c.job)).not.toContain("publish");
    // The video robot is GitHub's, not the tick's.
    expect(catchUpCandidates().map((c) => c.job)).not.toContain("video-robot");
  });

  it("an hourly job is caught up only when its next time is more than 15 minutes away", () => {
    // metrics at :23: at 06:30 its 05:23 time was missed and 07:23 is 53 minutes away.
    expect(missedJobs(back, last).map((m) => m.job)).toContain("metrics");
    // At 07:10 the 06:23 time was missed, but 07:23 is 13 minutes away: it just waits.
    expect(missedJobs(at("2026-11-13T07:10:00Z"), last).map((m) => m.job)).not.toContain("metrics");
  });

  it("a time less than 20 minutes old is not missed yet (its run may still be going)", () => {
    // store-sync at 03:47; at 04:00 its run of 03:47 may not have reported yet.
    const l = allLast("2026-11-12T03:47:10Z");
    expect(missedJobs(at("2026-11-13T04:00:00Z"), l).map((m) => m.job)).not.toContain("store-sync");
    expect(missedJobs(at("2026-11-13T04:10:00Z"), l).map((m) => m.job)).toContain("store-sync");
  });

  it("nothing is missed when every job ran at its time", () => {
    const now = at("2026-11-13T06:30:00Z");
    const ran = new Map<string, Date | null>([
      ["store-sync", at("2026-11-13T03:47:05Z")],
      ["analytics-rollup", at("2026-11-13T02:17:03Z")],
      ["metrics", at("2026-11-13T06:23:02Z")],
    ]);
    const jobs = missedJobs(now, ran).map((m) => m.job);
    expect(jobs).not.toContain("store-sync");
    expect(jobs).not.toContain("analytics-rollup");
    expect(jobs).not.toContain("metrics");
  });

  it("a job that never ran is never started by the catch-up", () => {
    expect(missedJobs(back, new Map())).toEqual([]);
  });

  it("each missed time is tried once per server process", () => {
    const first = missedJobs(back, last);
    const tried = new Map(first.map((m) => [m.job, m.slot.toISOString()]));
    expect(missedJobs(back, last, tried)).toEqual([]);
  });

  it("reads the catch-up row back for Health", () => {
    expect(readCatchUpSummary(JSON.stringify({ jobs: [{ job: "store-sync", slot: "2026-11-13T03:47:00.000Z", ok: true }] }))).toEqual([{ job: "store-sync", slot: "2026-11-13T03:47:00.000Z", ok: true }]);
    expect(readCatchUpSummary("not json")).toEqual([]);
    expect(readCatchUpSummary(null)).toEqual([]);
  });
});

describe("runCatchUp", () => {
  beforeEach(() => {
    resetCatchUpForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  function fakeDb(lastIso: string) {
    const created: { job: string; summary: string; ok: boolean }[] = [];
    /** Jobs a route call started (the route's own recordCron row), by name. */
    const ran = new Map<string, Date>();
    return {
      created,
      ran,
      db: {
        cronRun: {
          groupBy: vi.fn(async ({ where }: { where: { job: { in: string[] } } }) => where.job.in.map((job) => ({ job, _max: { startedAt: ran.get(job) ?? at(lastIso) } }))),
          create: vi.fn(async ({ data }: { data: { job: string; summary: string; ok: boolean } }) => {
            created.push(data);
            return data;
          }),
        },
      },
    };
  }

  it("runs at most 3 missed jobs per tick through their own routes, records them, then the rest next minute", async () => {
    const f = fakeDb("2026-11-13T00:59:00Z");
    let clock = at("2026-11-13T06:30:00Z");
    const fetchImpl = vi.fn(async (url: string) => {
      f.ran.set(url.split("/api/cron/")[1], clock);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const now = clock;
    const done = await runCatchUp(now, { origin: "http://127.0.0.1:3002", secret: "s", fetchImpl, db: f.db as never });
    expect(done).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[0]).toMatch(/^http:\/\/127\.0\.0\.1:3002\/api\/cron\//);
      expect(call[0]).not.toContain("/api/cron/publish");
      expect(new Headers(call[1].headers).get("authorization")).toBe("Bearer s");
    }
    expect(f.created).toHaveLength(1);
    expect(f.created[0].job).toBe(CATCH_UP_JOB);
    expect(readCatchUpSummary(f.created[0].summary).map((j) => j.job)).toEqual(done.map((d) => d.job));
    // More were waiting: the next minute looks again and runs others, never the same one twice.
    clock = new Date(now.getTime() + 60_000);
    const next = await runCatchUp(clock, { origin: "http://127.0.0.1:3002", secret: "s", fetchImpl, db: f.db as never });
    expect(next.length).toBeGreaterThan(0);
    expect(next.map((d) => d.job).some((j) => done.map((d) => d.job).includes(j))).toBe(false);
  });

  it("looks only every 5 minutes when nothing is waiting", async () => {
    const f = fakeDb("2026-11-13T06:29:00Z");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await runCatchUp(at("2026-11-13T06:30:00Z"), { origin: "http://x", secret: "s", fetchImpl, db: f.db as never });
    await runCatchUp(at("2026-11-13T06:31:00Z"), { origin: "http://x", secret: "s", fetchImpl, db: f.db as never });
    expect(f.db.cronRun.groupBy).toHaveBeenCalledTimes(1);
    await runCatchUp(at("2026-11-13T06:36:00Z"), { origin: "http://x", secret: "s", fetchImpl, db: f.db as never });
    expect(f.db.cronRun.groupBy).toHaveBeenCalledTimes(2);
  });

  it("never throws when the database cannot be read", async () => {
    const db = { cronRun: { groupBy: vi.fn(async () => Promise.reject(new Error("db down"))), create: vi.fn() } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runCatchUp(at("2026-11-13T06:30:00Z"), { origin: "http://x", secret: "s", db: db as never })).toEqual([]);
  });
});
