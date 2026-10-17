import { beforeEach, describe, expect, it, vi } from "vitest";

type Outcome = Record<string, unknown> & { id: string; postId: string | null; postedAt: Date; stats24h: unknown; stats7d: unknown };
const db = vi.hoisted(() => ({ outcomes: [] as Outcome[], metrics: new Map<string, Record<string, number | null>>(), job: null as Record<string, unknown> | null }));
const isNull = (v: unknown) => v === null || v === undefined;
const prisma = vi.hoisted(() => ({
  videoJob: { findFirst: vi.fn(async ({ where }: { where: { videoPath: string } }) => (db.job && db.job.videoPath === where.videoPath ? db.job : null)) },
  videoOutcome: {
    createMany: vi.fn(async ({ data }: { data: Outcome[] }) => {
      let count = 0;
      for (const d of data) {
        if (db.outcomes.some((o) => o.postId === d.postId)) continue;
        db.outcomes.push({ ...d, id: `o${db.outcomes.length + 1}`, stats24h: null, stats7d: null });
        count++;
      }
      return { count };
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> & { postedAt: { lte: Date } } }) => {
      const field = "stats24h" in where ? "stats24h" : "stats7d";
      return db.outcomes.filter((o) => isNull(o[field]) && o.postId && o.postedAt <= where.postedAt.lte).map((o) => ({ id: o.id, postId: o.postId }));
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown> & { id: string }; data: Record<string, unknown> }) => {
      const field = "stats24h" in where ? "stats24h" : "stats7d";
      const o = db.outcomes.find((x) => x.id === where.id);
      if (!o || !isNull(o[field])) return { count: 0 };
      Object.assign(o, data);
      return { count: 1 };
    }),
  },
  postMetrics: { findFirst: vi.fn(async ({ where }: { where: { postId: string } }) => db.metrics.get(where.postId) ?? null) },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));

import { fillOutcomeStats, recordStudioOutcome } from "@/lib/video-studio/outcomes";

const NOW = new Date("2026-10-30T12:00:00Z");
const post = (over: Record<string, unknown> = {}) => ({ id: "post1", businessId: "b1", network: "youtube", mediaPaths: ["u1/clips/v.mp4"], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  db.outcomes = [];
  db.metrics.clear();
  db.job = { id: "j1", videoPath: "u1/clips/v.mp4", templateId: "product-hero", hookId: "price-banner", seconds: 15, captionScore: { score: 86, formulaId: "price-place-route" }, brief: { business: { name: "Nova Phones Kigali", description: "Phones and accessories", language: "English" }, product: { name: "Samsung Galaxy A56", summary: "A 5G phone" } } };
});

describe("Video Studio outcomes", () => {
  it("a published post of a studio MP4 records its outcome once, with the Brain's names (YouTube is Shorts)", async () => {
    expect(await recordStudioOutcome(post(), new Date("2026-10-20T08:00:00Z"))).toBe(true);
    expect(await recordStudioOutcome(post(), new Date("2026-10-20T08:00:00Z"))).toBe(false);
    expect(db.outcomes).toHaveLength(1);
    expect(db.outcomes[0]).toMatchObject({ videoJobId: "j1", postId: "post1", businessId: "b1", platform: "shorts", templateId: "product-hero", hookId: "price-banner", seconds: 15, language: "English", captionFormulaId: "price-place-route" });
    expect(typeof db.outcomes[0].sector).toBe("string");
    // A design made before the formula was kept: no formula.
    db.job = { ...db.job!, captionScore: { score: 80 } };
    await recordStudioOutcome(post({ id: "post2" }), new Date("2026-10-20T09:00:00Z"));
    expect(db.outcomes[1].captionFormulaId).toBeNull();
  });

  it("ignores posts that are not studio videos (no video, another file, LinkedIn) and never throws", async () => {
    expect(await recordStudioOutcome(post({ mediaPaths: ["u1/gallery/a.jpg"] }), NOW)).toBe(false);
    expect(await recordStudioOutcome(post({ mediaPaths: ["u1/clips/other.mp4"] }), NOW)).toBe(false);
    expect(await recordStudioOutcome(post({ network: "linkedin" }), NOW)).toBe(false);
    prisma.videoJob.findFirst.mockRejectedValueOnce(new Error("db down"));
    expect(await recordStudioOutcome(post(), NOW)).toBe(false);
    expect(db.outcomes).toHaveLength(0);
  });

  it("fills the numbers after 24 hours and after 7 days from the post's latest metrics, once each", async () => {
    await recordStudioOutcome(post({ id: "old" }), new Date("2026-10-20T08:00:00Z"));
    await recordStudioOutcome(post({ id: "new" }), new Date("2026-10-29T08:00:00Z"));
    await recordStudioOutcome(post({ id: "fresh" }), new Date("2026-10-30T08:00:00Z"));
    db.metrics.set("old", { views: 900, reach: 700, likes: 40, comments: 5, saves: 3, shares: 2 });
    db.metrics.set("new", { views: 120, reach: null, likes: 8, comments: 1, saves: null, shares: 0 });
    expect(await fillOutcomeStats(NOW)).toEqual({ day: 2, week: 1 });
    const by = (id: string) => db.outcomes.find((o) => o.postId === id)!;
    expect(by("old")).toMatchObject({ stats24h: { views: 900, likes: 40 }, stats7d: { views: 900 } });
    expect(by("new")).toMatchObject({ stats24h: { views: 120, reach: null }, stats7d: null });
    expect(by("fresh")).toMatchObject({ stats24h: null });
    expect(await fillOutcomeStats(NOW)).toEqual({ day: 0, week: 0 });
  });
});
