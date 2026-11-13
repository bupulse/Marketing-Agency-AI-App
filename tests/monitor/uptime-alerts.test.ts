import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/monitor/alerts", () => ({ sendBackUpAlert: vi.fn() }));
const { getCustomKey, recordUptimeCheckMock } = vi.hoisted(() => ({ getCustomKey: vi.fn(), recordUptimeCheckMock: vi.fn() }));
vi.mock("@/lib/admin/service-keys", () => ({ getCustomKey }));

import { recordUptimeCheck } from "@/lib/monitor/uptime";
import type { UptimeCheckInput } from "@/lib/monitor/uptime-rules";
import { checkWithRetry, main, markDown, previousState, sendDownAlerts, shouldAlertDown } from "@/scripts/monitor/uptime-check.mjs";

// ---- an in-memory stand-in for the three tables -------------------------------------------------------------

type Check = { checkedAt: Date; ok: boolean; afterFailure: boolean };
type Range = { gt?: Date; lt?: Date; lte?: Date; gte?: Date };
const inRange = (d: Date, r: Range = {}) => (!r.gt || d > r.gt) && (!r.lt || d < r.lt) && (!r.lte || d <= r.lte) && (!r.gte || d >= r.gte);

function fakeDb() {
  const checks: Check[] = [];
  const incidents: { id: string; startedAt: Date; endedAt?: Date; alertedAt?: Date | null }[] = [];
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
      findFirst: async ({ where }: { where: { endedAt: Date } }) => incidents.find((i) => i.endedAt && +i.endedAt === +where.endedAt) ?? null,
      create: async ({ data }: { data: { startedAt: Date; endedAt: Date } }) => {
        if (incidents.some((i) => +i.startedAt === +data.startedAt)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { id: `inc${incidents.length + 1}`, startedAt: data.startedAt, endedAt: data.endedAt };
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

  it("an outage the PC's minute-by-minute watch already told about is recorded but sends no second back-up message", async () => {
    const covers = vi.fn(async () => true);
    const r = (input: UptimeCheckInput, min: number) => recordUptimeCheck(input, at(min), { db: f.db as never, alert: alert as never, random: () => 1, watchCovers: covers });
    await r(good(), 0);
    await r(bad(), 5);
    const back = await r(good({ afterFailure: true }), 20);
    expect(back.outage?.minutes).toBe(20);
    expect(back.alerted).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    expect(f.incidents).toHaveLength(1);
    expect(covers).toHaveBeenCalledWith(expect.objectContaining({ startedAt: at(0), endedAt: at(20) }), at(20));
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

  it("the PC's own check closed the outage first: the workflow's late \"after a failure\" records nothing more", async () => {
    await run(good(), 0);
    await run(bad(), 7); // the PC's check: down (the workflow could not post its failed run)
    const pcBack = await run(good({ afterFailure: true }), 12); // the PC's next check: back up
    expect(pcBack.outage).toEqual({ startedAt: at(0), endedAt: at(12), minutes: 12, reason: "failed-check" });
    const late = await run(good({ afterFailure: true }), 15); // the workflow's run after its own down run
    expect(late.outage).toBeNull();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(f.incidents).toHaveLength(1);
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
    delete process.env.CRON_SECRET;
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

  it("also takes the server PC's CRON_SECRET (its own 5-minute check), and only that or UPTIME_SECRET", async () => {
    process.env.CRON_SECRET = "pc-secret";
    expect((await call("Bearer pc-secret")).status).toBe(200);
    expect((await call("Bearer other")).status).toBe(401);
    process.env.UPTIME_SECRET = "env-secret";
    expect((await call("Bearer env-secret")).status).toBe(200);
    expect((await call("Bearer pc-secret")).status).toBe(200);
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


/** GitHub's API: the runs list, then the previous run's artifacts ("site-down" when that run found the site down). */
function github(url: string, previous: { id: number; conclusion: string; down: boolean }[]) {
  if (url.includes("/actions/workflows/")) return { status: 200, body: { workflow_runs: previous.map(({ id, conclusion }) => ({ id, conclusion })) } };
  const m = /\/actions\/runs\/(\d+)\/artifacts\?name=site-down$/.exec(url);
  if (m) {
    const run = previous.find((r) => String(r.id) === m[1]);
    return { status: 200, body: { artifacts: run?.down ? [{ name: "site-down", expired: false }] : [] } };
  }
  return { status: 404 };
}

describe("workflow: one down alert per outage, runs stay green", () => {
  it("alerts unless the previous run found the site down; unknown counts as up", () => {
    expect(shouldAlertDown("up")).toBe(true);
    expect(shouldAlertDown(null)).toBe(true);
    expect(shouldAlertDown("down")).toBe(false);
  });

  it("previousState reads the previous run's site-down artifact, skipping this run and cancelled runs", async () => {
    const runs = [{ id: 7, conclusion: "success", down: false }, { id: 6, conclusion: "cancelled", down: false }, { id: 5, conclusion: "success", down: true }];
    const { fn, calls } = fakeFetch((url) => github(url, runs));
    expect(await previousState({ repo: "bupulse/app", runId: "7", token: "t" }, fn)).toBe("down");
    expect(calls.at(-1)?.url).toBe("https://api.github.com/repos/bupulse/app/actions/runs/5/artifacts?name=site-down");
    expect(await previousState({ repo: "bupulse/app", runId: "8", token: "t" }, fn)).toBe("up");
    expect(await previousState({ repo: "bupulse/app", runId: "7", token: "" }, fn)).toBeNull();
    // An expired artifact (a run more than a day old) does not count.
    const old = fakeFetch((url) => (url.includes("/artifacts") ? { status: 200, body: { artifacts: [{ name: "site-down", expired: true }] } } : github(url, [{ id: 1, conclusion: "success", down: true }])));
    expect(await previousState({ repo: "bupulse/app", runId: "2", token: "t" }, old.fn)).toBe("up");
    const broken = fakeFetch(() => ({ status: 500 }));
    expect(await previousState({ repo: "bupulse/app", runId: "7", token: "t" }, broken.fn)).toBeNull();
    const none = fakeFetch((url) => github(url, []));
    expect(await previousState({ repo: "bupulse/app", runId: "7", token: "t" }, none.fn)).toBeNull();
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

  it("markDown writes nothing outside GitHub Actions", async () => {
    await expect(markDown({})).resolves.toBeUndefined();
  });

  function siteDown(previousDown: boolean) {
    return fakeFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return github(url, [{ id: 2, conclusion: "success", down: previousDown }]);
      if (url.startsWith("https://api.telegram.org/") || url.startsWith("https://api.resend.com/")) return { status: 200 };
      return null; // bupulse.com does not answer
    });
  }
  const env = { SITE_URL: "https://bupulse.com", GITHUB_REPOSITORY: "bupulse/app", GITHUB_RUN_ID: "3", GITHUB_TOKEN: "t", TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_CHAT_ID: "42", RESEND_API_KEY: "re_x", UPTIME_SECRET: "u", UPTIME_DOWN_ALERT: "on" } as unknown as NodeJS.ProcessEnv;

  async function runMain(fn: typeof fetch, extra: Record<string, string | undefined> = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mark = vi.fn(async () => {});
    const done = main({ ...env, ...extra } as NodeJS.ProcessEnv, fn, { mark });
    await vi.runAllTimersAsync();
    const code = await done;
    const printed = log.mock.calls.flat().join(" ");
    log.mockRestore();
    vi.useRealTimers();
    return { code, mark, printed };
  }

  it("first down run: alerts on both channels, leaves the site-down marker, and the run stays green", async () => {
    const { fn, calls } = siteDown(false);
    const { code, mark, printed } = await runMain(fn);
    expect(code).toBe(0);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.url.startsWith("https://api.telegram.org/"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith("https://api.resend.com/"))).toHaveLength(1);
    // The public log never shows a secret.
    expect(printed).not.toMatch(/re_x|1:x|Bearer/);
  });

  it("GitHub's down alert is off unless UPTIME_DOWN_ALERT is on (the server PC sends it); the marker is still left", async () => {
    const { fn, calls } = siteDown(false);
    const { code, mark, printed } = await runMain(fn, { UPTIME_DOWN_ALERT: undefined });
    expect(code).toBe(0);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.startsWith("https://api.telegram.org/") || c.url.startsWith("https://api.resend.com/"))).toBe(false);
    expect(printed).toContain("switched off");
  });

  it("still down (the previous run left site-down): no second alert, marker left again, still green", async () => {
    const { fn, calls } = siteDown(true);
    const { code, mark } = await runMain(fn);
    expect(code).toBe(0);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.startsWith("https://api.telegram.org/") || c.url.startsWith("https://api.resend.com/"))).toBe(false);
  });

  it("back up after a down run: no marker, and the check tells the server afterFailure so it sends the back-up alert", async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return github(url, [{ id: 2, conclusion: "success", down: true }]);
      if (url.endsWith("/api/status")) return { status: 200, body: { status: "ok", databaseMs: 30, version: "1.2.3" } };
      return { status: 200, body: "ok" };
    });
    const { code, mark } = await runMain(fn);
    expect(code).toBe(0);
    expect(mark).not.toHaveBeenCalled();
    const post = calls.find((c) => c.url === "https://bupulse.com/api/monitor/uptime");
    expect(post?.init?.headers).toMatchObject({ authorization: "Bearer u" });
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ ok: true, afterFailure: true, databaseMs: 30, retried: false });
  });

  it("up after an up run: afterFailure is false", async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return github(url, [{ id: 2, conclusion: "success", down: false }]);
      if (url.endsWith("/api/status")) return { status: 200, body: { status: "ok" } };
      return { status: 200, body: "ok" };
    });
    await runMain(fn);
    const post = calls.find((c) => c.url === "https://bupulse.com/api/monitor/uptime");
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ ok: true, afterFailure: false });
  });
});
