import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/monitor/alerts", () => ({ sendOwnerAlert: vi.fn(), sendBackUpAlert: vi.fn() }));
const { recordWatchReportMock } = vi.hoisted(() => ({ recordWatchReportMock: vi.fn() }));

import { afterSend, delivered, downCause, EMPTY_WATCH, nextWatch, parseWatchReport, watchCovers, watchText, type WatchReport, type WatchState } from "@/lib/monitor/watch-rules";
import { recordWatchReport, WATCH_SETTING } from "@/lib/monitor/watch";

const T0 = new Date("2026-11-13T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const up: WatchReport = { publicOk: true, publicStatus: 200, localOk: true, tunnelReady: true, maintenance: false, localDownSince: null };
const down = (extra: Partial<WatchReport> = {}): WatchReport => ({ ...up, publicOk: false, publicStatus: 502, tunnelReady: false, ...extra });

/** Runs reports one a minute from minute 0 and returns what would have been sent (every send delivered). */
function play(reports: (WatchReport | null)[], start: WatchState = EMPTY_WATCH) {
  let s = start;
  const sent: { min: number; kind: string; minutes?: number; downWasSent?: boolean }[] = [];
  reports.forEach((r, min) => {
    if (!r) return; // no report that minute (the server could not take it)
    const n = nextWatch(s, r, at(min));
    s = n.state;
    if (n.send) {
      sent.push({ min, kind: n.send.kind, ...(n.send.kind === "down" ? { minutes: n.send.minutes } : { minutes: n.send.outage.minutes, downWasSent: n.send.downWasSent }) });
      s = afterSend(s, n.send, at(min));
    }
  });
  return { sent, state: s };
}

describe("the PC's down watch: one down and one back-up message per outage", () => {
  it("all good: nothing", () => {
    expect(play([up, up, up, up]).sent).toEqual([]);
  });

  it("down 2 minutes (third failed check in a row): one down message, then one back-up message", () => {
    const { sent } = play([up, down(), down(), down(), down(), down(), up, up]);
    expect(sent).toEqual([
      { min: 3, kind: "down", minutes: 2 },
      { min: 6, kind: "up", minutes: 5, downWasSent: true },
    ]);
  });

  it("a blip under 2 minutes sends nothing", () => {
    expect(play([up, down(), down(), up, up]).sent).toEqual([]);
  });

  it("a long outage still sends only one down message", () => {
    const { sent } = play([up, ...Array(30).fill(down()), up]);
    expect(sent.map((s) => s.kind)).toEqual(["down", "up"]);
  });

  it("a down message that could not be delivered is tried again next minute", () => {
    let s = EMPTY_WATCH;
    for (const min of [0, 1, 2]) s = nextWatch(s, down(), at(min)).state;
    const third = nextWatch(s, down(), at(3));
    expect(third.send?.kind).toBe("down");
    // Not delivered: the state is kept without "down sent".
    const fourth = nextWatch(third.state, down(), at(4));
    expect(fourth.send?.kind).toBe("down");
    expect(delivered({ email: "failed", telegram: "failed" })).toBe(false);
    expect(delivered({ email: "skipped", telegram: "failed" })).toBe(false);
    expect(delivered({ email: "failed", telegram: "sent" })).toBe(true);
    // Nothing set up: not retried every minute for ever.
    expect(delivered({ email: "skipped", telegram: "skipped" })).toBe(true);
  });

  it("the server was down (it could not take reports): down since the supervisor says, one back-up message after", () => {
    const { sent } = play([up, null, null, null, { ...up, localDownSince: at(1) }]);
    expect(sent).toEqual([{ min: 4, kind: "up", minutes: 3, downWasSent: false }]);
  });

  it("the server is still failing when it can report again: the down message goes at once", () => {
    const { sent } = play([up, null, null, null, down({ localDownSince: at(1) })]);
    expect(sent).toEqual([{ min: 4, kind: "down", minutes: 3 }]);
  });

  it("an update (maintenance) never starts an outage", () => {
    const m = down({ maintenance: true });
    expect(play([up, m, m, m, m, m, up]).sent).toEqual([]);
    // Even with the supervisor naming a time the server was down.
    expect(play([up, null, null, null, { ...up, maintenance: true, localDownSince: at(1) }]).sent).toEqual([]);
  });

  it("an outage already told about stays open through an update until the site answers", () => {
    const { sent } = play([up, down(), down(), down(), down({ maintenance: true }), up]);
    expect(sent.map((s) => s.kind)).toEqual(["down", "up"]);
  });
});

describe("watch words and causes", () => {
  it("names what most likely broke", () => {
    expect(downCause({ localOk: false, tunnelReady: true, publicStatus: 502 })).toBe("server");
    expect(downCause({ localOk: true, tunnelReady: false, publicStatus: 530 })).toBe("tunnel");
    expect(downCause({ localOk: true, tunnelReady: true, publicStatus: 503 })).toBe("database");
    expect(downCause({ localOk: true, tunnelReady: true, publicStatus: null })).toBe("outside");
  });

  it("says when it went down and that one more message follows", () => {
    const t = watchText({ kind: "down", since: new Date("2026-11-13T12:05:00Z"), minutes: 2, cause: "tunnel" });
    expect(t.line).toContain("since 13 Nov, 14:05 (Kigali time)");
    expect(t.line).toContain("one more message when it is back");
    const b = watchText({ kind: "up", outage: { startedAt: new Date("2026-11-13T12:05:00Z"), endedAt: new Date("2026-11-13T12:20:00Z"), minutes: 15 }, downWasSent: true });
    expect(b.subject).toBe("bupulse.com is back up (down about 15 minutes)");
  });
});

describe("parseWatchReport", () => {
  it("takes the supervisor's report and refuses junk", () => {
    expect(parseWatchReport(null).ok).toBe(false);
    expect(parseWatchReport({ publicOk: "yes" }).ok).toBe(false);
    const r = parseWatchReport({ publicOk: false, publicStatus: 502, localOk: true, tunnelReady: false, maintenance: false, localDownSince: at(-3).toISOString() }, at(0));
    expect(r).toEqual({ ok: true, value: { publicOk: false, publicStatus: 502, localOk: true, tunnelReady: false, maintenance: false, localDownSince: at(-3) } });
  });

  it("ignores a down-since in the future or more than a day old (a wrong clock must not invent an outage)", () => {
    expect(parseWatchReport({ publicOk: true, localDownSince: at(5).toISOString() }, at(0))).toMatchObject({ value: { localDownSince: null } });
    expect(parseWatchReport({ publicOk: true, localDownSince: at(-2000).toISOString() }, at(0))).toMatchObject({ value: { localDownSince: null } });
  });
});

describe("watchCovers: no second back-up message from the uptime record", () => {
  const outage = { startedAt: at(10), endedAt: at(20) };
  it("covers an outage the watch saw from its start, while it still reports", () => {
    expect(watchCovers({ ...EMPTY_WATCH, aliveSince: at(0).toISOString(), lastReportAt: at(21).toISOString() }, outage, at(22))).toBe(true);
  });
  it("does not cover it when the watch started later (the PC was off) or has gone quiet", () => {
    expect(watchCovers({ ...EMPTY_WATCH, aliveSince: at(15).toISOString(), lastReportAt: at(21).toISOString() }, outage, at(22))).toBe(false);
    expect(watchCovers({ ...EMPTY_WATCH, aliveSince: at(0).toISOString(), lastReportAt: at(10).toISOString() }, outage, at(22))).toBe(false);
    expect(watchCovers(EMPTY_WATCH, outage, at(22))).toBe(false);
  });
  it("a gap of more than 10 minutes between reports starts aliveSince again", () => {
    let s = nextWatch(EMPTY_WATCH, up, at(0)).state;
    s = nextWatch(s, up, at(1)).state;
    expect(s.aliveSince).toBe(at(0).toISOString());
    s = nextWatch(s, up, at(30)).state;
    expect(s.aliveSince).toBe(at(30).toISOString());
  });
});

describe("recordWatchReport: stored state and delivery", () => {
  function fakeDb() {
    const rows = new Map<string, unknown>();
    return {
      rows,
      db: {
        adminSetting: {
          findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
          upsert: async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
            rows.set(where.key, rows.has(where.key) ? update.value : create.value);
            return {};
          },
        },
      },
    };
  }

  it("sends one down message across minutes and remembers it", async () => {
    const f = fakeDb();
    const send = vi.fn(async () => ({ email: "sent" as const, telegram: "sent" as const }));
    for (const min of [0, 1, 2, 3, 4, 5]) await recordWatchReport(down(), at(min), { db: f.db as never, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ emoji: "🔴", subject: "bupulse.com is down" });
    expect((f.rows.get(WATCH_SETTING) as WatchState).downAlertedAt).toBe(at(2).toISOString());
    await recordWatchReport(up, at(6), { db: f.db as never, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1] as unknown[])[0]).toMatchObject({ emoji: "✅" });
    expect((f.rows.get(WATCH_SETTING) as WatchState).lastOutage).toEqual({ startedAt: at(0).toISOString(), endedAt: at(6).toISOString(), minutes: 6 });
  });

  it("tries again next minute when every channel failed", async () => {
    const f = fakeDb();
    const send = vi.fn(async () => ({ email: "failed" as const, telegram: "failed" as const }));
    for (const min of [0, 1, 2, 3]) await recordWatchReport(down(), at(min), { db: f.db as never, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect((f.rows.get(WATCH_SETTING) as WatchState).downAlertedAt).toBeNull();
  });
});

describe("watch route", () => {
  beforeEach(() => {
    vi.resetModules();
    recordWatchReportMock.mockReset();
    recordWatchReportMock.mockResolvedValue({ sent: null, outcomes: null });
    vi.doMock("@/lib/monitor/watch", () => ({ recordWatchReport: recordWatchReportMock }));
    process.env.CRON_SECRET = "pc-secret";
  });
  const post = (auth: string | null, body: unknown) =>
    new NextRequest("http://127.0.0.1:3002/api/monitor/watch", { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });

  it("only the PC's secret may post", async () => {
    const { POST } = await import("@/app/api/monitor/watch/route");
    expect((await POST(post(null, { publicOk: true }))).status).toBe(401);
    expect((await POST(post("Bearer wrong", { publicOk: true }))).status).toBe(401);
    expect(recordWatchReportMock).not.toHaveBeenCalled();
    const ok = await POST(post("Bearer pc-secret", { publicOk: false, publicStatus: 502 }));
    expect(ok.status).toBe(200);
    expect(recordWatchReportMock).toHaveBeenCalledWith(expect.objectContaining({ publicOk: false, publicStatus: 502 }));
  });

  it("refuses a bad body", async () => {
    const { POST } = await import("@/app/api/monitor/watch/route");
    expect((await POST(post("Bearer pc-secret", { publicOk: "maybe" }))).status).toBe(400);
  });
});
