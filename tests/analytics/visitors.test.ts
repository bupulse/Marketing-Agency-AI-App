import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countryName, dayMethod, durationLabel, funnelSteps, groupSeries, lastOldMethodDay, oldMethodNote, parseVisitorPeriod, recentMonths, sourceLabel, weekStart,
  type DayPoint,
} from "@/lib/analytics/visitors-shared";

const NOW = new Date("2026-11-09T10:00:00Z");

describe("parseVisitorPeriod", () => {
  it("reads the presets in UTC days", () => {
    expect(parseVisitorPeriod({ p: "today" }, NOW)).toMatchObject({ key: "today", from: "2026-11-09", to: "2026-11-09", by: "day" });
    expect(parseVisitorPeriod({ p: "7d" }, NOW)).toMatchObject({ key: "7d", from: "2026-11-03", to: "2026-11-09" });
    expect(parseVisitorPeriod({ p: "30d" }, NOW)).toMatchObject({ key: "30d", from: "2026-10-11", to: "2026-11-09" });
    expect(parseVisitorPeriod({ p: "month" }, NOW)).toMatchObject({ key: "month", from: "2026-11-01", to: "2026-11-09" });
    expect(parseVisitorPeriod({}, NOW)).toMatchObject({ key: "7d", from: "2026-11-03" });
    expect(parseVisitorPeriod({ p: "nonsense" }, NOW).key).toBe("7d");
  });

  it("reads a whole month from the list, but never one in the future or too old", () => {
    expect(parseVisitorPeriod({ m: "2026-10" }, NOW)).toMatchObject({ key: "by-month", month: "2026-10", from: "2026-10-01", to: "2026-10-31", label: "October 2026" });
    expect(parseVisitorPeriod({ m: "2026-02" }, NOW)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(parseVisitorPeriod({ m: "2026-11" }, NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-09" });
    expect(parseVisitorPeriod({ m: "2026-12" }, NOW).key).toBe("7d");
    expect(parseVisitorPeriod({ m: "2020-01" }, NOW).key).toBe("7d");
    expect(recentMonths(NOW, 3)).toEqual(["2026-11", "2026-10", "2026-09"]);
  });

  it("reads the date picker: swaps reversed dates, clamps to today and to 400 days, ignores bad dates", () => {
    expect(parseVisitorPeriod({ from: "2026-10-20", to: "2026-10-01" }, NOW)).toMatchObject({ key: "custom", from: "2026-10-01", to: "2026-10-20" });
    expect(parseVisitorPeriod({ from: "2026-11-01", to: "2027-01-01" }, NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-09" });
    expect(parseVisitorPeriod({ from: "2020-01-01", to: "2026-11-09" }, NOW)).toMatchObject({ from: "2025-10-06", to: "2026-11-09", by: "month" });
    expect(parseVisitorPeriod({ from: "2026-02-31", to: "x" }, NOW).key).toBe("7d");
    expect(parseVisitorPeriod({ from: ["2026-11-01", "2026-01-01"] }, NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-09" });
  });

  it("groups by day up to two months, then by week, then by month, unless asked", () => {
    expect(parseVisitorPeriod({ p: "30d" }, NOW).by).toBe("day");
    expect(parseVisitorPeriod({ from: "2026-07-01", to: "2026-11-09" }, NOW).by).toBe("week");
    expect(parseVisitorPeriod({ p: "30d", by: "week" }, NOW).by).toBe("week");
    expect(parseVisitorPeriod({ p: "30d", by: "year" }, NOW).by).toBe("day");
  });
});

describe("counting method", () => {
  it("tells new, old and switch days apart from the roll-up", () => {
    expect(dayMethod(0, undefined)).toBe("none");
    expect(dayMethod(10, undefined)).toBe("old"); // rolled before visits_v2 existed
    expect(dayMethod(10, 0)).toBe("old");
    expect(dayMethod(10, 4)).toBe("mixed");
    expect(dayMethod(10, 10)).toBe("new");
  });

  it("finds the last old-method day and words the note", () => {
    const days = [
      { date: "2026-11-07", method: "old" as const },
      { date: "2026-11-08", method: "mixed" as const },
      { date: "2026-11-09", method: "new" as const },
    ];
    expect(lastOldMethodDay(days)).toBe("2026-11-08");
    expect(lastOldMethodDay([{ date: "2026-11-09", method: "new" }, { date: "2026-11-10", method: "none" }])).toBeNull();
    expect(oldMethodNote("2026-11-08")).toContain("8 Nov 2026");
    expect(oldMethodNote("2026-11-08")).toContain("old method");
    expect(oldMethodNote(null)).toBeNull();
  });
});

describe("groupSeries", () => {
  const points: DayPoint[] = [
    { date: "2026-11-01", visitors: 5, views: 9, method: "old" }, // a Sunday
    { date: "2026-11-02", visitors: 3, views: 4, method: "new" },
    { date: "2026-11-04", visitors: 2, views: 2, method: "new" },
  ];

  it("fills every day of the period, with zeros for days without visits", () => {
    const s = groupSeries(points, "2026-11-01", "2026-11-04", "day");
    expect(s.map((p) => [p.key, p.visitors, p.views, p.oldMethod])).toEqual([
      ["2026-11-01", 5, 9, true],
      ["2026-11-02", 3, 4, false],
      ["2026-11-03", 0, 0, false],
      ["2026-11-04", 2, 2, false],
    ]);
    expect(s[0].label).toBe("1 Nov");
  });

  it("sums days into Monday-to-Sunday weeks and calendar months, marking any old day", () => {
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    const weeks = groupSeries(points, "2026-11-01", "2026-11-04", "week");
    expect(weeks.map((w) => ({ key: w.key, from: w.from, to: w.to, visitors: w.visitors, old: w.oldMethod }))).toEqual([
      { key: "2026-10-26", from: "2026-11-01", to: "2026-11-01", visitors: 5, old: true },
      { key: "2026-11-02", from: "2026-11-02", to: "2026-11-04", visitors: 5, old: false },
    ]);
    const months = groupSeries(points, "2026-10-30", "2026-11-04", "month");
    expect(months.map((m) => [m.key, m.visitors, m.views, m.label])).toEqual([["2026-10", 0, 0, "Oct 2026"], ["2026-11", 10, 15, "Nov 2026"]]);
  });
});

describe("funnel and labels", () => {
  it("gives each step its share of the step before", () => {
    const steps = funnelSteps({ visitors: 200, quotes: 10, chats: 5, signups: 4, paid: 1 });
    expect(steps.map((s) => [s.key, s.count, s.ofPreviousPct])).toEqual([
      ["visitors", 200, null], ["quotes", 10, 5], ["chats", 5, 50], ["signups", 4, 80], ["paid", 1, 25],
    ]);
    expect(funnelSteps({ visitors: 0, quotes: 0, chats: 0, signups: 0, paid: 0 })[1].ofPreviousPct).toBeNull();
  });

  it("names sources, countries and durations for people", () => {
    expect(sourceLabel("google")).toBe("Google");
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
    expect(sourceLabel("direct")).toMatch(/^Direct/);
    expect(sourceLabel("newsletter")).toBe("newsletter");
    expect(countryName("RW")).toBe("Rwanda");
    expect(countryName("")).toBe("Unknown");
    expect(durationLabel(null)).toBe("–");
    expect(durationLabel(44_600)).toBe("45 s");
    expect(durationLabel(200_000)).toBe("3 min 20 s");
    expect(durationLabel(120_000)).toBe("2 min");
  });
});

// --- The server query: shapes, with the database and the roll-up mocked ---------------------------------------------

const raw = vi.fn();
const counts = { contactRequest: vi.fn(), supportConversation: vi.fn(), user: vi.fn() };
const metrics = vi.fn();
const live = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => raw(sql.join("?"), values),
    contactRequest: { count: (a: unknown) => counts.contactRequest(a) },
    supportConversation: { count: (a: unknown) => counts.supportConversation(a) },
    user: { count: (a: unknown) => counts.user(a) },
  },
}));
vi.mock("@/lib/analytics/queries", () => ({ getMetrics: (...a: unknown[]) => metrics(...a) }));
vi.mock("@/lib/analytics/rollup", () => ({ PAGE_VIEW_DAYS: 90 }));
vi.mock("@/lib/support/live", () => ({ liveVisitors: () => live() }));

describe("getVisitorAnalytics", () => {
  beforeEach(() => {
    metrics.mockReset().mockResolvedValue({
      visits: [{ date: "2026-11-08", dimension: "", value: 30 }, { date: "2026-11-09", dimension: "", value: 12 }],
      unique_visitors: [{ date: "2026-11-08", dimension: "", value: 10 }, { date: "2026-11-09", dimension: "", value: 6 }],
      visits_v2: [{ date: "2026-11-08", dimension: "", value: 18 }, { date: "2026-11-09", dimension: "", value: 12 }],
    });
    raw.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("with_city")) return [{ visitors: BigInt(16), with_city: BigInt(12), avg_ms: 41_234.5 }];
      if (sql.includes("DISTINCT ON")) return [{ key: "google", visitors: BigInt(9), views: BigInt(20) }, { key: "direct", visitors: BigInt(7), views: BigInt(22) }];
      if (sql.includes('"city", "country"')) return [{ city: "Kigali", country: "RW", visitors: BigInt(11), views: BigInt(30) }];
      if (sql.includes('"country" AS key')) return [{ key: "RW", visitors: BigInt(14), views: BigInt(38) }, { key: null, visitors: BigInt(2), views: BigInt(4) }];
      if (sql.includes('SELECT "path"')) return [{ path: "/pricing", views: BigInt(20), visitors: BigInt(9), avg_ms: 61_000.4, timed: BigInt(15) }, { path: "/", views: BigInt(22), visitors: BigInt(16), avg_ms: null, timed: BigInt(0) }];
      if (sql.includes("'upgrade'")) return [{ c: BigInt(1) }];
      return [];
    });
    counts.contactRequest.mockReset().mockResolvedValue(3);
    counts.supportConversation.mockReset().mockResolvedValue(2);
    counts.user.mockReset().mockResolvedValue(2);
    live.mockReset().mockResolvedValue({ items: [{}, {}, {}] });
  });

  it("returns totals from the roll-up and breakdowns from the page views, as plain numbers", async () => {
    const { getVisitorAnalytics } = await import("@/lib/analytics/visitors");
    const d = await getVisitorAnalytics({ from: "2026-11-08", to: "2026-11-09", by: "day" }, NOW);
    expect(metrics).toHaveBeenCalledWith({ from: "2026-11-08", to: "2026-11-09" }, ["visits", "unique_visitors", "visits_v2"]);
    expect(d.totals).toEqual({ visitors: 16, views: 42, avgMs: 41_234.5, visitorsWithCity: 12, rawVisitors: 16 });
    expect(d.series.map((p) => [p.key, p.visitors, p.views, p.oldMethod])).toEqual([["2026-11-08", 10, 30, true], ["2026-11-09", 6, 12, false]]);
    expect(d.lastOldDay).toBe("2026-11-08");
    expect(d.breakdownFrom).toBeNull();
    expect(d.countries).toEqual([{ key: "RW", visitors: 14, views: 38 }, { key: "", visitors: 2, views: 4 }]);
    expect(d.cities).toEqual([{ city: "Kigali", country: "RW", visitors: 11, views: 30 }]);
    expect(d.sources).toEqual([{ key: "google", visitors: 9, views: 20 }, { key: "direct", visitors: 7, views: 22 }]);
    expect(d.pages).toEqual([{ path: "/pricing", views: 20, visitors: 9, avgMs: 61_000, timedViews: 15 }, { path: "/", views: 22, visitors: 16, avgMs: null, timedViews: 0 }]);
    expect(d.funnel.map((s) => [s.key, s.count])).toEqual([["visitors", 16], ["quotes", 3], ["chats", 2], ["signups", 2], ["paid", 1]]);
    expect(d.liveNow).toBe(3);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d); // no BigInt or Date left
  });

  it("counts quotes, website chats and sign-ups in whole UTC days", async () => {
    const { getVisitorAnalytics } = await import("@/lib/analytics/visitors");
    await getVisitorAnalytics({ from: "2026-11-08", to: "2026-11-09", by: "day" }, NOW);
    const range = { gte: new Date("2026-11-08T00:00:00Z"), lt: new Date("2026-11-10T00:00:00Z") };
    expect(counts.contactRequest).toHaveBeenCalledWith({ where: { kind: "quote", createdAt: range } });
    expect(counts.supportConversation).toHaveBeenCalledWith({ where: { surface: "public", createdAt: range } });
    expect(counts.user).toHaveBeenCalledWith({ where: { createdAt: range } });
  });

  it("says where the breakdowns start when the period reaches past the 90 days of page views, and survives a live-count failure", async () => {
    live.mockRejectedValue(new Error("down"));
    const { getVisitorAnalytics } = await import("@/lib/analytics/visitors");
    const d = await getVisitorAnalytics({ from: "2026-06-01", to: "2026-11-09", by: "month" }, NOW);
    expect(d.breakdownFrom).toBe("2026-08-11");
    expect(d.liveNow).toBeNull();
    expect(d.series.map((p) => p.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    const firstRaw = raw.mock.calls[0][1] as unknown[];
    expect(firstRaw[0]).toEqual(new Date(NOW.getTime() - 90 * 86_400_000));
  });
});
