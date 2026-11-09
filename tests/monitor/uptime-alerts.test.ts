import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/monitor/alerts", () => ({ sendBackUpAlert: vi.fn() }));
const { getCustomKey, recordUptimeCheckMock } = vi.hoisted(() => ({ getCustomKey: vi.fn(), recordUptimeCheckMock: vi.fn() }));
vi.mock("@/lib/admin/service-keys", () => ({ getCustomKey }));

import { recordUptimeCheck } from "@/lib/monitor/uptime";
import type { UptimeCheckInput } from "@/lib/monitor/uptime-rules";
import { checkWithRetry, main, previousConclusion, sendDownAlerts, shouldAlertDown } from "@/scripts/monitor/uptime-check.mjs";

// ---- an in-memory stand-in for the three tables -------------------------------------------------------------

type Check = { checkedAt: Date; ok: boolean; afterFailure: boolean };
type Range = { gt?: Date; lt?: Date; lte?: Date; gte?: Date };
const inRange = (d: Date, r: Range = {}) => (!r.gt || d > r.gt) && (!r.lt || d < r.lt) && (!r.lte || d <= r.lte) && (!r.gte || d >= r.gte);

function fakeDb() {
  const checks: Check[] = [];
  const incidents: { id: string; startedAt: Date; alertedAt?: Date | null }[] = [];
  const beats: { receivedAt: Date }[] = [];
  const db = {
    uptimeCheck: {
      findFirst: async ({ where }: { where: { ok?: boolean; checkedAt?: Range } }) =>
        checks.filter((c) => (where.ok === undefined || c.ok === where.ok) && inRange(c.checkedAt, where.checkedAt)).sort((a, b) => +b.checkedAt - +a.checkedAt)[0] ?? null,
      create: async ({ data }: { data: Check }) => {
        checks.push({ checkedAt: data.checkedAt, ok: data.ok, afterFailure: data.afterFailure });
        return data;
      },
      deleteMany: async () => ({ count: 0 }),
      count: async ({ where }: { where: { ok: boolean; checkedAt: Range } }) => checks.filter((c) => c.ok === where.ok && inRange(c.checkedAt, where.checkedAt)).length,
    },
    uptimeIncident: {
      create: async ({ data }: { data: { startedAt: Date } }) => {
        if (incidents.some((i) => +i.startedAt === +data.startedAt)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { id: `inc${incidents.length + 1}`, startedAt: data.startedAt };
        incidents.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: { alertedAt: Date } }) => Object.assign(incidents.find((i) => i.id === where.id)!, data),
    },
    monitorHeartbeat: {
      findFirst: async ({ where }: { where: { receivedAt: Range } }) => beats.find((b) => inRange(b.receivedAt, where.receivedAt)) ?? null,
      findMany: async ({ where }: { where: { receivedAt: Range } }) => beats.filter((b) => inRange(b.receivedAt, where.receivedAt)),
    },
  };
  return { db, checks, incidents, beats };
}

const T0 = new Date("2026-11-09T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const good = (over: Partial<UptimeCheckInput> = {}): UptimeCheckInput => ({ ok: true, statusCode: 200, statusMs: 300, databaseMs: 40, version: "1.0.0", pages: [], retried: false, afterFailure: false, ...over });
const bad = (): UptimeCheckInput => ({ ...good(), ok: false, statusCode: 503 });

describe("recordUptimeCheck: the back-up alert goes out once per outage", () => {
  let f: ReturnType<typeof fakeDb>;
  let alert: ReturnType<typeof vi.fn>;
  const run = (input: UptimeCheckInput, min: number) => recordUptimeCheck(input, at(min), { db: f.db as never, alert: alert as never, random: () => 1 });

  beforeEach(() => {
    f = fakeDb();
    alert = vi.fn(async () => ({ email: "sent", telegram: "skipped" }));
  });

  it("good checks every 5 minutes: no outage, no alert", async () => {
    for (const m of [0, 5, 10, 15]) expect((await run(good(), m)).outage).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(f.checks).toHaveLength(4);
  });

  it("down for a while (failed checks stored), then up: one outage, one alert", async () => {
    await run(good(), 0);
    await run(bad(), 5);
    await run(bad(), 10);
    const back = await run(good({ afterFailure: true }), 20);
    expect(back.outage).toEqual({ startedAt: at(0), endedAt: at(20), minutes: 20, reason: "failed-check" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(f.incidents).toHaveLength(1);
    expect(f.incidents[0].alertedAt).toBeInstanceOf(Date);
    // The next good check is 5 minutes later: nothing more.
    await run(good(), 25);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("the same outage seen twice (a check posted twice at once) never alerts twice", async () => {
    await run(good(), 0);
    // Both requests read the same last good check before either is written.
    const prevFindFirst = f.db.uptimeCheck.findFirst;
    f.db.uptimeCheck.findFirst = async () => ({ checkedAt: at(0), ok: true, afterFailure: false });
    const [a, b] = await Promise.all([run(good({ afterFailure: true }), 40), run(good({ afterFailure: true }), 40)]);
    f.db.uptimeCheck.findFirst = prevFindFirst;
    expect([a.alerted, b.alerted].filter(Boolean)).toHaveLength(1);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("the PC was off (nothing reached the server at all): the PC's silence makes the gap an outage", async () => {
    f.beats.push({ receivedAt: at(-1) }, { receivedAt: at(0) }, { receivedAt: at(19) }, { receivedAt: at(20) });
    await run(good(), 0);
    const back = await run(good(), 20);
    expect(back.outage?.reason).toBe("pc-silent");
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("GitHub ran late (a 20-minute gap, PC reporting every minute): no outage, no alert", async () => {
    for (let m = -1; m <= 20; m++) f.beats.push({ receivedAt: at(m) });
    await run(good(), 0);
    expect((await run(good(), 20)).outage).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it("a failed check is stored but never alerts from the server (the workflow sends the down alert)", async () => {
    await run(good(), 0);
    expect((await run(bad(), 5)).alerted).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it("a failing alert sender does not fail the check", async () => {
    alert.mockRejectedValueOnce(new Error("Resend down"));
    await run(good(), 0);
    await expect(run(good({ afterFailure: true }), 10)).resolves.toMatchObject({ stored: true, alerted: true });
  });
});

// ---- the route ----------------------------------------------------------------------------------------------

describe("uptime route", () => {
  beforeEach(() => {
    vi.resetModules();
    getCustomKey.mockReset();
    getCustomKey.mockResolvedValue(null);
    recordUptimeCheckMock.mockReset();
    recordUptimeCheckMock.mockResolvedValue({ stored: true, outage: null, alerted: false });
    vi.doMock("@/lib/monitor/uptime", () => ({ recordUptimeCheck: recordUptimeCheckMock }));
    delete process.env.UPTIME_SECRET;
  });

  async function call(authorization: string | undefined, body: unknown = good()) {
    const { POST } = await import("@/app/api/monitor/uptime/route");
    return POST(new NextRequest("https://bupulse.com/api/monitor/uptime", { method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify(body) }));
  }

  it("500 when no secret is set anywhere", async () => {
    expect((await call("Bearer x")).status).toBe(500);
  });

  it("reads UPTIME_SECRET from the environment, or from Admin -> Services' custom key", async () => {
    process.env.UPTIME_SECRET = "env-secret";
    expect((await call("Bearer env-secret")).status).toBe(200);
    delete process.env.UPTIME_SECRET;
    getCustomKey.mockResolvedValue("saved-secret");
    expect((await call("Bearer saved-secret")).status).toBe(200);
    expect(getCustomKey).toHaveBeenCalledWith("UPTIME_SECRET");
  });

  it("401 for a wrong or missing bearer, 400 for a bad body", async () => {
    process.env.UPTIME_SECRET = "env-secret";
    expect((await call(undefined)).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("Bearer env-secret", { ok: "maybe" })).status).toBe(400);
    expect(recordUptimeCheckMock).not.toHaveBeenCalled();
  });
});

// ---- the GitHub workflow's script ---------------------------------------------------------------------------

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown } | null;
function fakeFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    if (!r) throw new Error("connection refused");
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const runsList = (runs: { id: number; conclusion: string }[]) => ({ status: 200, body: { workflow_runs: runs } });

describe("workflow: one down alert per outage", () => {
  it("alerts only when the previous run succeeded, or when that is unknown", () => {
    expect(shouldAlertDown("success")).toBe(true);
    expect(shouldAlertDown(null)).toBe(true);
    expect(shouldAlertDown("failure")).toBe(false);
  });

  it("previousConclusion skips this run and cancelled runs", async () => {
    const { fn } = fakeFetch(() => runsList([{ id: 7, conclusion: "success" }, { id: 6, conclusion: "cancelled" }, { id: 5, conclusion: "failure" }]));
    expect(await previousConclusion({ repo: "bupulse/app", runId: "7", token: "t" }, fn)).toBe("failure");
    expect(await previousConclusion({ repo: "bupulse/app", runId: "7", token: "" }, fn)).toBeNull();
    const broken = fakeFetch(() => ({ status: 500 }));
    expect(await previousConclusion({ repo: "bupulse/app", runId: "7", token: "t" }, broken.fn)).toBeNull();
  });

  it("down twice, a minute apart, counts as down; one failure then a good answer does not", async () => {
    let n = 0;
    const flaky = fakeFetch((url) => (url.endsWith("/api/status") ? (n++ === 0 ? null : { status: 200, body: { status: "ok", databaseMs: 12 } }) : { status: 200, body: "<html>" }));
    const wait = vi.fn(async () => {});
    const r = await checkWithRetry("https://bupulse.com", { fetchImpl: flaky.fn, wait });
    expect(r).toMatchObject({ ok: true, retried: true, databaseMs: 12 });
    expect(wait).toHaveBeenCalledWith(60_000);
  });

  it("skips a channel whose secret is missing", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200 }));
    expect(await sendDownAlerts({}, { subject: "s", text: "t" }, fn)).toEqual({ telegram: "skipped", email: "skipped" });
    expect(await sendDownAlerts({ RESEND_API_KEY: "re_x" }, { subject: "s", text: "t" }, fn)).toEqual({ telegram: "skipped", email: "sent" });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ from: "BuPulse <register@bupulse.com>", to: ["admin@bupulse.com"] });
  });

  function scenario(previous: string) {
    return fakeFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return runsList([{ id: 2, conclusion: previous }]);
      if (url.startsWith("https://api.telegram.org/") || url.startsWith("https://api.resend.com/")) return { status: 200 };
      return null; // bupulse.com does not answer
    });
  }
  const env = { SITE_URL: "https://bupulse.com", GITHUB_REPOSITORY: "bupulse/app", GITHUB_RUN_ID: "3", GITHUB_TOKEN: "t", TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_CHAT_ID: "42", RESEND_API_KEY: "re_x", UPTIME_SECRET: "u" } as unknown as NodeJS.ProcessEnv;

  it("site down after a good run: alerts on both channels and fails the run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fn, calls } = scenario("success");
    const done = main(env, fn);
    await vi.runAllTimersAsync();
    expect(await done).toBe(1);
    expect(calls.filter((c) => c.url.startsWith("https://api.telegram.org/"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith("https://api.resend.com/"))).toHaveLength(1);
    // The public log never shows a secret.
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/re_x|1:x|Bearer/);
    log.mockRestore();
    vi.useRealTimers();
  });

  it("site still down after a failed run: no second alert", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fn, calls } = scenario("failure");
    const done = main(env, fn);
    await vi.runAllTimersAsync();
    expect(await done).toBe(1);
    expect(calls.some((c) => c.url.startsWith("https://api.telegram.org/") || c.url.startsWith("https://api.resend.com/"))).toBe(false);
    log.mockRestore();
    vi.useRealTimers();
  });

  it("site up after a failed run: records the check with afterFailure so the server sends the back-up alert", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fn, calls } = fakeFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return runsList([{ id: 2, conclusion: "failure" }]);
      if (url.endsWith("/api/status")) return { status: 200, body: { status: "ok", databaseMs: 30, version: "1.2.3" } };
      return { status: 200, body: "ok" };
    });
    expect(await main(env, fn)).toBe(0);
    const post = calls.find((c) => c.url === "https://bupulse.com/api/monitor/uptime");
    expect(post?.init?.headers).toMatchObject({ authorization: "Bearer u" });
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ ok: true, afterFailure: true, databaseMs: 30, retried: false });
    log.mockRestore();
  });
});
