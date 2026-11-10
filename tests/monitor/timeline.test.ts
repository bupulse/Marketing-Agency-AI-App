import { describe, expect, it } from "vitest";
import { barState, dailyBars, hourlyBars } from "@/lib/monitor/timeline";

const NOW = new Date("2026-11-10T12:20:00Z"); // 14:20 in Kigali
const SINCE = new Date("2026-11-01T00:00:00Z");

describe("hourlyBars: the last 24 hours, one bar per hour", () => {
  it("24 bars ending with the hour going on now, checks counted in their hour", () => {
    const checks = [
      { checkedAt: new Date("2026-11-10T12:05:00Z"), ok: true, pages: [{ path: "/", status: 200, ms: 600 }, { path: "/pricing", status: 200, ms: 1000 }] },
      { checkedAt: new Date("2026-11-10T12:10:00Z"), ok: false, pages: [{ path: "/", status: 502, ms: 90 }] },
      { checkedAt: new Date("2026-11-10T11:30:00Z"), ok: true, pages: [] },
    ];
    const bars = hourlyBars(checks, [], SINCE, NOW);
    expect(bars).toHaveLength(24);
    expect(bars[23]).toEqual({ start: "2026-11-10T12:00:00.000Z", checks: 2, failed: 1, avgMs: 800, uptime: 100 });
    expect(bars[22]).toMatchObject({ start: "2026-11-10T11:00:00.000Z", checks: 1, failed: 0, avgMs: null });
    expect(bars[0].start).toBe("2026-11-09T13:00:00.000Z");
  });

  it("an outage takes its share of the hour; before monitoring started there is no uptime", () => {
    const spans = [{ startedAt: new Date("2026-11-10T10:00:00Z"), endedAt: new Date("2026-11-10T10:30:00Z") }];
    const bars = hourlyBars([], spans, new Date("2026-11-10T09:00:00Z"), NOW);
    expect(bars.find((b) => b.start === "2026-11-10T10:00:00.000Z")?.uptime).toBe(50);
    expect(bars.find((b) => b.start === "2026-11-10T08:00:00.000Z")?.uptime).toBeNull();
  });
});

describe("dailyBars: the last 30 Kigali days", () => {
  it("30 bars from Kigali midnight, today last, an ongoing outage counted to now", () => {
    const spans = [{ startedAt: new Date("2026-11-10T11:20:00Z"), endedAt: null }];
    const bars = dailyBars(spans, SINCE, NOW);
    expect(bars).toHaveLength(30);
    expect(bars[29].day).toBe("2026-11-09T22:00:00.000Z");
    // Today so far: 14 h 20 min since midnight, 60 minutes down.
    expect(bars[29].uptime).toBe(93);
    expect(bars[28].uptime).toBe(100);
    expect(bars[0].uptime).toBeNull();
  });
});

describe("barState", () => {
  it("no data, all good, some trouble, mostly down", () => {
    expect(barState({ uptime: null })).toBe("none");
    expect(barState({ uptime: 100, failed: 0 })).toBe("good");
    expect(barState({ uptime: 100, failed: 1 })).toBe("partial");
    expect(barState({ uptime: 97 })).toBe("partial");
    expect(barState({ uptime: 40 })).toBe("down");
  });
});
