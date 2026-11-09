import { describe, expect, it } from "vitest";
import { durationWords, gapOutage, kigaliMidnight, kigaliTime, longestGapMs, parseUptimeCheck, siteState, uptimePercent } from "@/lib/monitor/uptime-rules";

const T0 = new Date("2026-11-09T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const quiet = { failedChecks: 0, pcSilent: false };

describe("gapOutage: outages from the gaps between good checks", () => {
  it("checks every 5 minutes: no outage", () => {
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(5), afterFailure: false }, quiet)).toBeNull();
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(12), afterFailure: false }, quiet)).toBeNull();
  });

  it("the very first check has nothing before it", () => {
    expect(gapOutage(null, { checkedAt: at(0), afterFailure: true }, quiet)).toBeNull();
  });

  it("a gap over 12 minutes with a failed check in it is an outage from the last good check to the next", () => {
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(25), afterFailure: false }, { failedChecks: 2, pcSilent: false })).toEqual({ startedAt: at(0), endedAt: at(25), minutes: 25, reason: "failed-check" });
  });

  it("the check after a run that found the site down always closes an outage, even a short one (the down alert needs its back-up alert)", () => {
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(10), afterFailure: true }, quiet)).toEqual({ startedAt: at(0), endedAt: at(10), minutes: 10, reason: "failed-check" });
  });

  it("a gap with the server PC silent inside it is an outage", () => {
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(18), afterFailure: false }, { failedChecks: 0, pcSilent: true })?.reason).toBe("pc-silent");
  });

  it("a gap of 12 to 30 minutes with nothing else wrong is GitHub running late, not an outage", () => {
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(20), afterFailure: false }, quiet)).toBeNull();
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(29), afterFailure: false }, quiet)).toBeNull();
  });

  it("30 minutes or more without a good check counts on its own", () => {
    expect(gapOutage({ checkedAt: at(0) }, { checkedAt: at(45), afterFailure: false }, quiet)).toEqual({ startedAt: at(0), endedAt: at(45), minutes: 45, reason: "long-gap" });
  });
});

describe("longestGapMs", () => {
  it("measures between the edges and each time inside", () => {
    expect(longestGapMs([at(1), at(2), at(3)], at(0), at(4))).toBe(60_000);
    expect(longestGapMs([at(1), at(9)], at(0), at(10))).toBe(8 * 60_000);
    expect(longestGapMs([], at(0), at(10))).toBe(10 * 60_000);
    // Times outside the window are ignored.
    expect(longestGapMs([at(-5), at(15)], at(0), at(10))).toBe(10 * 60_000);
  });
});

describe("siteState", () => {
  const now = at(60);
  it("never, up, late, down", () => {
    expect(siteState({ lastCheck: null, lastOkAt: null, pcSilent: false }, now)).toEqual({ kind: "never" });
    expect(siteState({ lastCheck: { checkedAt: at(57), ok: true }, lastOkAt: at(57), pcSilent: false }, now).kind).toBe("up");
    expect(siteState({ lastCheck: { checkedAt: at(40), ok: true }, lastOkAt: at(40), pcSilent: false }, now)).toEqual({ kind: "late", lastCheckAt: at(40), minutes: 20 });
    expect(siteState({ lastCheck: { checkedAt: at(40), ok: true }, lastOkAt: at(40), pcSilent: true }, now)).toMatchObject({ kind: "down", since: at(40), minutes: 20 });
    expect(siteState({ lastCheck: { checkedAt: at(20), ok: true }, lastOkAt: at(20), pcSilent: false }, now)).toMatchObject({ kind: "down", minutes: 40 });
  });

  it("a failed last check is down from the last good one", () => {
    expect(siteState({ lastCheck: { checkedAt: at(58), ok: false }, lastOkAt: at(50), pcSilent: false }, now)).toEqual({ kind: "down", since: at(50), minutes: 10, lastCheckAt: at(58) });
  });
});

describe("uptimePercent", () => {
  const day = { from: new Date("2026-11-08T00:00:00Z"), to: new Date("2026-11-09T00:00:00Z") };
  it("100% without outages, null before monitoring started", () => {
    expect(uptimePercent([], day, new Date("2026-11-01T00:00:00Z"))).toBe(100);
    expect(uptimePercent([], day, null)).toBeNull();
    expect(uptimePercent([], day, new Date("2026-11-10T00:00:00Z"))).toBeNull();
  });

  it("subtracts outages inside the window, clipped, overlaps counted once", () => {
    const outages = [
      { startedAt: new Date("2026-11-07T23:00:00Z"), endedAt: new Date("2026-11-08T01:00:00Z") }, // 1 h inside
      { startedAt: new Date("2026-11-08T12:00:00Z"), endedAt: new Date("2026-11-08T13:00:00Z") },
      { startedAt: new Date("2026-11-08T12:30:00Z"), endedAt: new Date("2026-11-08T13:12:00Z") }, // overlaps: +12 min
    ];
    // 2 h 12 min down of 24 h = 90.83% (rounded down to one decimal).
    expect(uptimePercent(outages, day, new Date("2026-11-01T00:00:00Z"))).toBe(90.8);
  });

  it("an outage going on now counts to the end of the window; only time since monitoring started counts", () => {
    expect(uptimePercent([{ startedAt: new Date("2026-11-08T18:00:00Z"), endedAt: null }], day, new Date("2026-11-08T12:00:00Z"))).toBe(50);
  });
});

describe("words and Kigali time", () => {
  it("durationWords", () => {
    expect(durationWords(1)).toBe("1 minute");
    expect(durationWords(45)).toBe("45 minutes");
    expect(durationWords(60)).toBe("1 hour");
    expect(durationWords(65)).toBe("1 hour 5 minutes");
    expect(durationWords(60 * 24 * 2 + 180)).toBe("2 days 3 hours");
  });

  it("Kigali is UTC+2", () => {
    expect(kigaliTime(new Date("2026-11-09T12:05:00Z"))).toBe("9 Nov, 14:05");
    expect(kigaliMidnight(new Date("2026-11-09T12:00:00Z")).toISOString()).toBe("2026-11-08T22:00:00.000Z");
    expect(kigaliMidnight(new Date("2026-11-09T23:00:00Z")).toISOString()).toBe("2026-11-09T22:00:00.000Z");
  });
});

describe("parseUptimeCheck", () => {
  it("keeps known pages and sane numbers only", () => {
    const r = parseUptimeCheck({
      ok: true,
      statusCode: 200,
      statusMs: 312.6,
      databaseMs: 41,
      version: "1.4.2<script>",
      pages: [{ path: "/", status: 200, ms: 800 }, { path: "/admin", status: 200, ms: 1 }, { path: "/pricing", status: null, ms: -5 }, { path: "/", status: 500, ms: 1 }],
      retried: "yes",
      afterFailure: true,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toEqual({
      ok: true,
      statusCode: 200,
      statusMs: 313,
      databaseMs: 41,
      version: "1.4.2script",
      pages: [{ path: "/", status: 200, ms: 800 }, { path: "/pricing", status: null, ms: null }],
      retried: false,
      afterFailure: true,
    });
  });

  it("needs ok", () => {
    expect(parseUptimeCheck({}).ok).toBe(false);
    expect(parseUptimeCheck({ ok: "true" }).ok).toBe(false);
  });
});
