import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    connection: { findMany: vi.fn() },
    post: { findMany: vi.fn(), count: vi.fn() },
    chatSession: { count: vi.fn() },
    lead: { groupBy: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/publishing/media", () => ({ signPaths: vi.fn(async () => new Map()) }));

import { TIP_MIN, addDays, bestPosts, periodKeys, splitPeriods, startOfLocalDay, changePct, computeTips, pagePath, parseRange, rate, topPages, totalsOf, trend, type PostRow } from "@/lib/analytics/compute";
import { loadClientAnalytics } from "@/lib/analytics/service";

const NOW = new Date("2026-10-08T12:00:00Z");
let n = 0;
function post(o: Partial<PostRow> & { reach?: number | null; eng?: number } = {}): PostRow {
  const { reach = 100, eng = 10, ...rest } = o;
  return {
    id: `p${n++}`,
    network: "instagram",
    format: "POST",
    publishedAt: new Date("2026-10-06T10:00:00Z"),
    reminderOnly: false,
    mediaPaths: [],
    permalink: null,
    text: "x",
    metrics: reach === null ? null : { views: null, reach, likes: eng, comments: 0, saves: 0, shares: 0 },
    ...rest,
  };
}

describe("aggregation maths", () => {
  it("rate and change never divide by zero", () => {
    expect(rate(5, 0)).toBeNull();
    expect(rate(5, 100)).toBe(0.05);
    expect(changePct(10, 0)).toBeNull();
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(50, 100)).toBe(-50);
    expect(changePct(0, 100)).toBe(-100);
  });

  it("sums engagement, falls back to views for reach, ignores unmeasured posts", () => {
    const viewsOnly = post();
    viewsOnly.metrics = { views: 200, reach: null, likes: 1, comments: 2, saves: 3, shares: 4 };
    const t = totalsOf([post({ reach: 100, eng: 10 }), viewsOnly, post({ reach: null })]);
    expect(t).toMatchObject({ posts: 3, measured: 2, reach: 300, engagement: 20 });
    expect(t.rate).toBeCloseTo(20 / 300);
    expect(totalsOf([]).rate).toBeNull();
    expect(totalsOf([post({ reach: 0, eng: 0 })]).rate).toBeNull();
  });

  it("ranks best posts by rate and skips posts without reach", () => {
    const a = post({ reach: 100, eng: 5 });
    const b = post({ reach: 50, eng: 10 });
    const c = post({ reach: null });
    expect(bestPosts([a, b, c], 5).map((x) => x.post.id)).toEqual([b.id, a.id]);
  });

  it("buckets the trend and reports empty days", () => {
    const pts = trend([post({ reach: 100, eng: 10 })], 7, 1, NOW, "UTC");
    expect(pts).toHaveLength(7);
    expect(pts.reduce((s, p) => s + p.reach, 0)).toBe(100);
    expect(pts[6].reach).toBe(0);
    expect(trend([], 90, 7, NOW, "UTC")).toHaveLength(13);
  });

  it("parses ranges safely", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("abc")).toBe(30);
    expect(parseRange(["90"])).toBe(90);
    expect(parseRange(undefined)).toBe(30);
  });

  it("groups lead pages by path", () => {
    expect(pagePath("https://a.com/pricing/?x=1")).toBe("/pricing");
    expect(pagePath("https://a.com")).toBe("/");
    expect(pagePath(null)).toBeNull();
    expect(topPages([{ url: "https://a.com/pricing", count: 1 }, { url: "https://a.com/pricing#x", count: 1 }, { url: "https://a.com/", count: 1 }, { url: null, count: 5 }])).toEqual([
      { path: "/pricing", count: 2 },
      { path: "/", count: 1 },
    ]);
  });
});

describe("calendar days and DST", () => {
  it("adds calendar days without skipping or repeating across a clock change", () => {
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-10-31", -7)).toBe("2026-10-24");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("builds 7 distinct consecutive London dates over the October clock change", () => {
    const keys = periodKeys(new Date("2026-10-28T12:00:00Z"), 7, "Europe/London");
    expect(keys).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(new Set(keys).size).toBe(7);
    expect(periodKeys(new Date("2026-10-26T00:30:00Z"), 3, "Europe/London")).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  it("starts a local day at the right instant either side of the change", () => {
    expect(startOfLocalDay("2026-10-24", "Europe/London").toISOString()).toBe("2026-10-23T23:00:00.000Z");
    expect(startOfLocalDay("2026-10-26", "Europe/London").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(startOfLocalDay("2026-10-08", "Africa/Kigali").toISOString()).toBe("2026-10-07T22:00:00.000Z");
  });

  it("cards and chart count the same posts, including the first and last local day", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const first = post({ publishedAt: new Date("2026-10-21T23:30:00Z"), eng: 5 }); // 22 Oct 00:30 BST: first day
    const dstDay = post({ publishedAt: new Date("2026-10-25T01:30:00Z"), eng: 7 }); // 25 Oct, clock-change day
    const before = post({ publishedAt: new Date("2026-10-21T22:30:00Z") }); // 21 Oct 23:30 BST: previous period
    const { current, previous } = splitPeriods([first, dstDay, before], 7, now, "Europe/London");
    expect(current.map((p) => p.id)).toEqual([first.id, dstDay.id]);
    expect(previous.map((p) => p.id)).toEqual([before.id]);
    const pts = trend(current, 7, 1, now, "Europe/London");
    expect(pts.reduce((s, p) => s + p.posts, 0)).toBe(current.length);
    expect(pts.reduce((s, p) => s + p.engagement, 0)).toBe(totalsOf(current).engagement);
    expect(pts[0].posts).toBe(1);
    expect(pts[3].posts).toBe(1);
  });
});

describe("tip thresholds", () => {
  it("shows nothing under the minimum sample", () => {
    const few = [
      ...Array.from({ length: TIP_MIN.group - 1 }, () => post({ format: "CAROUSEL", eng: 50 })),
      ...Array.from({ length: TIP_MIN.group - 1 }, () => post({ format: "POST", eng: 5 })),
    ];
    expect(computeTips(few, [], 0, "UTC")).toEqual([]);
    expect(computeTips([], [{ path: "/pricing", count: 4 }], 4, "UTC")).toEqual([]);
  });

  it("shows a format tip with the real ratio once there is enough data", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => post({ format: "CAROUSEL", eng: 20 })),
      ...Array.from({ length: 3 }, () => post({ format: "POST", eng: 10 })),
    ];
    const tips = computeTips(rows, [], 0, "UTC");
    expect(tips.find((t) => t.id === "format")?.text).toContain("2×");
  });

  it("stays quiet when the difference is small", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => post({ format: "CAROUSEL", eng: 11 })),
      ...Array.from({ length: 4 }, () => post({ format: "POST", eng: 10 })),
    ];
    expect(computeTips(rows, [], 0, "UTC").find((t) => t.id === "format")).toBeUndefined();
  });

  it("lead-page tip needs enough leads and a clear leader", () => {
    expect(computeTips([], [{ path: "/pricing", count: 3 }], 4, "UTC")).toEqual([]);
    expect(computeTips([], [{ path: "/pricing", count: 4 }, { path: "/", count: 2 }], 6, "UTC")[0].text).toContain("/pricing (4 of 6)");
    expect(computeTips([], [{ path: "/a", count: 3 }, { path: "/b", count: 3 }, { path: "/c", count: 3 }, { path: "/d", count: 3 }], 12, "UTC")).toEqual([]);
  });
});

describe("business scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.business.findUnique.mockResolvedValue({ timezone: "UTC" });
    mocks.prisma.connection.findMany.mockResolvedValue([]);
    mocks.prisma.post.findMany.mockResolvedValue([]);
    mocks.prisma.post.count.mockResolvedValue(0);
    mocks.prisma.chatSession.count.mockResolvedValue(0);
    mocks.prisma.lead.groupBy.mockResolvedValue([]);
    mocks.prisma.lead.count.mockResolvedValue(0);
  });

  it("every query is filtered by the caller's business", async () => {
    await loadClientAnalytics("biz-A", 30, NOW);
    const wheres = [
      mocks.prisma.connection.findMany.mock.calls[0][0].where,
      mocks.prisma.post.findMany.mock.calls[0][0].where,
      mocks.prisma.post.count.mock.calls[0][0].where,
      ...mocks.prisma.chatSession.count.mock.calls.map((c) => c[0].where),
      mocks.prisma.lead.groupBy.mock.calls[0][0].where,
      ...mocks.prisma.lead.count.mock.calls.map((c) => c[0].where),
    ];
    expect(wheres.length).toBe(8);
    expect(mocks.prisma.lead.groupBy).toHaveBeenCalledTimes(1);
    for (const w of wheres) expect(w.businessId).toBe("biz-A");
    expect(mocks.prisma.business.findUnique.mock.calls[0][0].where).toEqual({ id: "biz-A" });
  });

  it("computes the period comparison from the rows returned", async () => {
    mocks.prisma.connection.findMany.mockResolvedValue([{ provider: "instagram", postingMode: "AUTO", status: "ACTIVE" }]);
    const mk = (id: string, at: string, likes: number) => ({
      id, network: "instagram", format: "POST", publishedAt: new Date(at), mediaPaths: [], permalink: null, text: "t",
      connection: { postingMode: "AUTO" }, metrics: [{ views: null, reach: 100, likes, comments: 0, saves: 0, shares: 0 }],
    });
    mocks.prisma.post.findMany.mockResolvedValue([mk("now", "2026-10-05T10:00:00Z", 20), mk("old", "2026-09-05T10:00:00Z", 10)]);
    const data = await loadClientAnalytics("biz-A", 30, NOW);
    expect(data.cards.posts).toEqual({ value: 1, change: 0 });
    expect(data.cards.engagement).toEqual({ value: 20, change: 100 });
    expect(data.cards.reach.change).toBe(0);
    expect(data.hasChannels).toBe(true);
  });
});
