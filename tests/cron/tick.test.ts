import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cronMatches, dueRoutes, tickMinute } from "@/lib/cron/schedule";
import { JOB_BUDGET_MS, MAX_CURSOR_CALLS, ROUTE_TIMEOUT_MS, runTick, runTickJob, TICK_BUDGET_MS } from "@/lib/cron/tick";
import { CRON_ROUTES } from "@/worker-crons";

const { runCatchUp } = vi.hoisted(() => ({ runCatchUp: vi.fn(async () => [] as unknown[]) }));
vi.mock("@/lib/cron/catch-up-run", () => ({ runCatchUp }));
import { POST } from "@/app/api/cron/tick/route";

const at = (iso: string) => new Date(iso);
const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cron expressions", () => {
  it.each([
    ["* * * * *", "2026-11-03T10:17:00Z", true],
    ["23 * * * *", "2026-11-03T10:23:00Z", true],
    ["23 * * * *", "2026-11-03T10:24:00Z", false],
    ["*/4 * * * *", "2026-11-03T10:56:00Z", true],
    ["*/4 * * * *", "2026-11-03T10:57:00Z", false],
    ["31 */6 * * *", "2026-11-03T18:31:00Z", true],
    ["31 */6 * * *", "2026-11-03T19:31:00Z", false],
    ["47 3 * * *", "2026-11-03T03:47:00Z", true],
    ["47 3 * * *", "2026-11-03T04:47:00Z", false],
    // 6 Nov 2026 is a Friday, 8 Nov a Sunday, 9 Nov a Monday.
    ["11 */3 * * 5,6", "2026-11-06T09:11:00Z", true],
    ["11 */3 * * 5,6", "2026-11-06T10:11:00Z", false],
    ["11 */3 * * 5,6", "2026-11-09T09:11:00Z", false],
    ["*/30 * * * 5,6,0", "2026-11-08T23:30:00Z", true],
    ["*/30 * * * 5,6,0", "2026-11-09T00:00:00Z", false],
    ["0 0 * * 7", "2026-11-08T00:00:00Z", true], // 7 is Sunday too
    ["10-20/5 * * * *", "2026-11-03T10:15:00Z", true],
    ["10-20/5 * * * *", "2026-11-03T10:25:00Z", false],
    ["5/20 * * * *", "2026-11-03T10:45:00Z", true],
    // Day of month and day of week both restricted: either matches.
    ["0 0 1 * 1", "2026-11-09T00:00:00Z", true],
    ["0 0 1 * 1", "2026-11-01T00:00:00Z", true],
    ["0 0 1 * 1", "2026-11-03T00:00:00Z", false],
  ])("%s at %s: %s", (expression, iso, expected) => {
    expect(cronMatches(expression, at(iso))).toBe(expected);
  });

  it.each(["* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "a * * * *", "5-1 * * * *", "* * 0 * *"])("rejects %j", (expression) => {
    expect(() => cronMatches(expression, at("2026-11-03T10:00:00Z"))).toThrow();
  });

  it("every schedule in worker-crons.ts parses and fires at least once a week", () => {
    const week = Array.from({ length: 7 * 24 * 60 }, (_, i) => new Date(Date.UTC(2026, 10, 2) + i * 60_000));
    for (const cron of Object.keys(CRON_ROUTES)) expect(week.some((d) => cronMatches(cron, d)), cron).toBe(true);
  });
});

describe("due routes", () => {
  it("only the publisher in a quiet minute", () => {
    expect(dueRoutes(at("2026-11-03T10:01:00Z"))).toEqual(["/api/cron/publish"]);
  });

  it("the publisher first, then the others due that minute", () => {
    expect(dueRoutes(at("2026-11-03T03:47:00Z"))).toEqual(["/api/cron/publish", "/api/cron/store-sync"]);
    expect(dueRoutes(at("2026-11-03T10:52:00Z"))).toEqual(["/api/cron/publish", "/api/cron/video-jobs"]);
    expect(dueRoutes(at("2026-11-03T18:31:00Z"))).toEqual(["/api/cron/publish", "/api/cron/creator-views"]);
  });

  it("matches what Cloudflare runs: over a whole week, each route as often as its schedule fires", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 7 * 24 * 60; i++) for (const path of dueRoutes(new Date(Date.UTC(2026, 10, 2) + i * 60_000))) counts[path] = (counts[path] ?? 0) + 1;
    expect(counts["/api/cron/publish"]).toBe(7 * 24 * 60);
    expect(counts["/api/cron/video-jobs"]).toBe((7 * 24 * 60) / 4);
    expect(counts["/api/cron/metrics"]).toBe(7 * 24);
    expect(counts["/api/cron/store-sync"]).toBe(7);
    expect(counts["/api/cron/creator-views"]).toBe(7 * 4);
    expect(counts["/api/cron/autopilot"]).toBe(2 * 8); // Friday and Saturday, every 3 hours
    expect(counts["/api/cron/autopilot-visuals"]).toBe(3 * 48); // Friday to Sunday, every 30 minutes
    expect(Object.keys(counts).sort()).toEqual([...new Set(Object.values(CRON_ROUTES))].sort());
  });
});

describe("the tick's minute", () => {
  const now = at("2026-11-03T10:14:03.200Z");

  it("uses Cloud Scheduler's planned time, cut to the minute", () => {
    expect(tickMinute("2026-11-03T10:13:00Z", now).toISOString()).toBe("2026-11-03T10:13:00.000Z");
    expect(tickMinute("2026-11-03T12:13:00+02:00", now).toISOString()).toBe("2026-11-03T10:13:00.000Z");
  });

  it("falls back to now for a missing, malformed or far-off planned time", () => {
    for (const value of [null, "", "yesterday", "2026-11-02T10:13:00Z", "2026-11-03T11:13:00Z"]) {
      expect(tickMinute(value, now).toISOString()).toBe("2026-11-03T10:14:00.000Z");
    }
  });
});

describe("running a tick", () => {
  const origin = "http://127.0.0.1:8080";
  const secret = "s3cret";

  it("calls each due route in order with the bearer secret, and one failure does not stop the next", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer s3cret");
      expect(init?.method).toBe("POST");
      if (url.includes("/publish")) throw new Error("connection refused");
      return ok({ sent: 0 });
    });
    const summary = await runTick(at("2026-11-03T03:47:00Z"), { origin, secret, fetchImpl });
    expect(calls).toEqual([`${origin}/api/cron/publish`, `${origin}/api/cron/store-sync`]);
    expect(summary.minute).toBe("2026-11-03T03:47:00.000Z");
    expect(summary.jobs.map((j) => [j.path, j.ok, j.calls])).toEqual([
      ["/api/cron/publish", false, 1],
      ["/api/cron/store-sync", true, 1],
    ]);
    expect(summary.jobs[0].error).toBe("connection refused");
    expect(summary.skipped).toEqual([]);
  });

  it("an error answer is a failed job with its status", async () => {
    const result = await runTickJob("/api/cron/metrics", { origin, secret, fetchImpl: async () => new Response("boom", { status: 500 }) });
    expect(result).toMatchObject({ path: "/api/cron/metrics", ok: false, calls: 1, status: 500, error: "answered 500" });
  });

  it("follows nextCursor until the route answers none", async () => {
    const urls: string[] = [];
    const answers = [{ nextCursor: "b1" }, { nextCursor: "b 2" }, { nextCursor: null }];
    const result = await runTickJob("/api/cron/store-sync", { origin, secret, fetchImpl: async (url) => (urls.push(url), ok(answers[urls.length - 1])) });
    expect(urls).toEqual([`${origin}/api/cron/store-sync`, `${origin}/api/cron/store-sync?cursor=b1`, `${origin}/api/cron/store-sync?cursor=b+2`]);
    expect(result).toMatchObject({ ok: true, calls: 3, status: 200 });
  });

  it("stops at the call limit and at the job's time budget", async () => {
    const endless = async () => ok({ nextCursor: "again" });
    expect((await runTickJob("/api/cron/daily-posts", { origin, secret, fetchImpl: endless })).calls).toBe(MAX_CURSOR_CALLS);
    let clock = 0;
    const slow = async () => ((clock += JOB_BUDGET_MS / 2 + 1), ok({ nextCursor: "again" }));
    expect((await runTickJob("/api/cron/daily-posts", { origin, secret, fetchImpl: slow, now: () => clock })).calls).toBe(2);
  });

  it("starts no new job after the tick's budget and lists it as skipped", async () => {
    let clock = 0;
    const fetchImpl = async () => ((clock += TICK_BUDGET_MS + 1), ok());
    const summary = await runTick(at("2026-11-03T03:47:00Z"), { origin, secret, fetchImpl, now: () => clock });
    expect(summary.jobs.map((j) => j.path)).toEqual(["/api/cron/publish"]);
    expect(summary.skipped).toEqual(["/api/cron/store-sync"]);
  });

  it("a cursor job also stops at the tick's budget, so the tick ends inside Cloud Scheduler's 30 minutes", async () => {
    let clock = 0;
    const fetchImpl = async () => ((clock += 4 * 60 * 1000), ok({ nextCursor: "again" }));
    const result = await runTickJob("/api/cron/daily-posts", { origin, secret, fetchImpl, now: () => clock, stopAt: 6 * 60 * 1000 });
    expect(result.calls).toBe(2);
    expect(TICK_BUDGET_MS + ROUTE_TIMEOUT_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

describe("POST /api/cron/tick", () => {
  function call(authorization?: string, headers: Record<string, string> = {}) {
    return POST(new NextRequest("https://bupulse.test/api/cron/tick", { method: "POST", headers: { ...(authorization ? { authorization } : {}), ...headers } }));
  }

  it("returns 500 when CRON_SECRET is not set, and calls nothing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await call("Bearer ")).status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", "s3cret", "Bearer s3cret2", "bearer s3cret"])("returns 401 for %s and calls nothing", async (header) => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await call(header)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs the planned minute's jobs on this instance's own port (Cloud Run) and answers the summary", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("PLATFORM", "cloudrun");
    vi.stubEnv("PORT", "8080");
    const fetchSpy = vi.fn<(url: string) => Promise<Response>>(async () => ok());
    vi.stubGlobal("fetch", fetchSpy);
    const response = await call("Bearer s3cret", { "x-cloudscheduler-scheduletime": new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString() });
    expect(response.status).toBe(200);
    const summary = (await response.json()) as { minute: string; jobs: { path: string; ok: boolean }[] };
    expect(summary.jobs[0]).toMatchObject({ path: "/api/cron/publish", ok: true });
    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:8080/api/cron/publish");
  });

  it("elsewhere calls the request's own origin", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("PLATFORM", "node");
    const fetchSpy = vi.fn<(url: string) => Promise<Response>>(async () => ok());
    vi.stubGlobal("fetch", fetchSpy);
    expect((await call("Bearer s3cret")).status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://bupulse.test/api/cron/publish");
  });

  it("then catches up missed jobs and lists them in the summary", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("PLATFORM", "node");
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    runCatchUp.mockResolvedValueOnce([{ job: "store-sync", slot: "2026-11-13T03:47:00.000Z", ok: true, calls: 1 }]);
    const body = (await (await call("Bearer s3cret")).json()) as { caughtUp?: { job: string }[] };
    expect(body.caughtUp).toEqual([expect.objectContaining({ job: "store-sync" })]);
    expect(runCatchUp).toHaveBeenLastCalledWith(expect.any(Date), expect.objectContaining({ origin: "https://bupulse.test", secret: "s3cret" }));
  });

  it("answers 200 with the failure in the summary when a job fails (no Cloud Scheduler retry)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("PLATFORM", "node");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { jobs: { ok: boolean; status: number }[] }).jobs[0]).toMatchObject({ ok: false, status: 503 });
  });
});
