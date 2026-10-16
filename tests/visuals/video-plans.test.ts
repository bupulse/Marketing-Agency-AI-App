import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Owner decisions of 12 October 2026: which plans have video, the video add-on, the 30-day clean-up of published
// videos, and video files leaving with their product, campaign or content.

const mocks = vi.hoisted(() => ({
  prisma: {
    contentVisual: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    post: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  remove: vi.fn(),
  list: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ remove: mocks.remove, list: mocks.list }) } }) }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: vi.fn(), featureStatus: vi.fn() }));

import { ADDONS, quoteOffer, type AddonPriceRow, type OfferBase } from "@/lib/offers/shared";
import { SEED_PLANS, TRIAL_VIDEOS, VIDEO_PLAN_VIDEOS, videosPerDayLimit } from "@/lib/plans";
import { purgeAbandonedUploads, purgePublishedVideos, videoExpired } from "@/lib/visuals/cleanup";
import { releaseContentVisuals, releaseSubjectVideos } from "@/lib/visuals/service";
import { VIDEO_REMOVED_NOTE } from "@/lib/visuals/types";

const SQL = readFileSync("prisma/migrations/20261015090000_content_visuals/migration.sql", "utf8").replace(/--[^\n]*/g, "");
const now = new Date("2026-12-01T03:19:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000);

describe("video by plan", () => {
  it("Rwanda Business and Pro (East Africa, Global) get 120 videos a month (4 a day); the trial one 30 s sample; Starter and Standard nothing", () => {
    expect(VIDEO_PLAN_VIDEOS).toBe(4 * 30);
    expect(TRIAL_VIDEOS).toBe(1);
    expect(SQL).toMatch(/SET "featureKeys" = "featureKeys" \|\| '\["video"\]'::jsonb\s+WHERE \("key" IN \('BUSINESS', 'PRO'\) OR "isTrial" = true\)/);
    // First in seconds (20261015090000_content_visuals), then in videos (20261018120000_videos_per_month).
    expect(SQL).toMatch(/'\{videoSeconds\}', '240'::jsonb\)\s+WHERE "key" IN \('BUSINESS', 'PRO'\)/);
    expect(SQL).toMatch(/'\{videoSeconds\}', '30'::jsonb\)\s+WHERE "isTrial" = true/);
    expect(SQL).not.toMatch(/'STARTER'|'STANDARD'/);
    expect(SEED_PLANS.PRO).toMatchObject({ limits: { videos: 120 } });
    expect(videosPerDayLimit(SEED_PLANS.PRO.limits)).toBe(4);
    expect(videosPerDayLimit(SEED_PLANS.TRIAL.limits)).toBe(1);
    expect(SEED_PLANS.PRO.features).toContain("video");
    expect(SEED_PLANS.TRIAL).toMatchObject({ limits: { videos: 1 } });
    expect(SEED_PLANS.TRIAL.features).toContain("video");
    expect(SEED_PLANS.STANDARD.features).not.toContain("video");
    expect(SEED_PLANS.STANDARD.limits.videos).toBe(0);
  });

  it("video is an add-on at 10,000 RWF a month in Rwanda, and brings 120 videos a month when added to a plan without it", () => {
    expect(ADDONS.find((a) => a.key === "video")).toMatchObject({ kind: "feature", feature: "video" });
    expect(SQL).toMatch(/\('addon_rw_video', 'video', 'RW', 'RWF', 10000, 'migration', CURRENT_TIMESTAMP\)/);
    expect(SQL).toContain('ON CONFLICT ("addonKey", "regionKey") DO NOTHING');

    const prices: AddonPriceRow[] = [{ addonKey: "video", regionKey: "RW", currency: "RWF", monthlyMinor: 10000 }];
    const starter: OfferBase = { key: "STARTER", name: "Starter", monthlyMinor: 15000, yearlyMinor: 150000, features: ["content", "designs", "calendar", "gallery"], limits: { text: 60, image: 30, chat: 0, videos: 0, voiceCharacters: 0, seats: 1 } };
    const q = quoteOffer({ base: starter, features: ["video"], limits: { text: 60, image: 30, chat: 0, seats: 1 }, interval: "MONTH", currency: "RWF", regionKey: "RW", prices });
    expect(q.added).toEqual(["video"]);
    expect(q.limits.videos).toBe(120);
    expect(q.lines.find((l) => l.key === "video")).toMatchObject({ totalMinor: 10000 });
    const without = quoteOffer({ base: starter, features: [], limits: { text: 60, image: 30, chat: 0, seats: 1 }, interval: "MONTH", currency: "RWF", regionKey: "RW", prices });
    expect(without.limits.videos).toBe(0);
  });
});

describe("30-day clean-up of published videos", () => {
  const published = (d: number) => ({ status: "PUBLISHED", publishedAt: daysAgo(d) });

  it("only when every post went out and the last one 30 or more days ago; unposted videos stay", () => {
    expect(videoExpired([published(31)], now)).toBe(true);
    expect(videoExpired([published(30)], now)).toBe(true);
    expect(videoExpired([published(29)], now)).toBe(false);
    expect(videoExpired([published(40), published(10)], now)).toBe(false);
    expect(videoExpired([published(40), { status: "SCHEDULED", publishedAt: null }], now)).toBe(false);
    expect(videoExpired([published(40), { status: "FAILED", publishedAt: null }], now)).toBe(true);
    expect(videoExpired([], now)).toBe(false);
    expect(videoExpired([{ status: "DRAFT", publishedAt: null }], now)).toBe(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.prisma.contentVisual.updateMany.mockResolvedValue({ count: 1 });
  });

  it("deletes the expired files, keeps the posts and marks the visual; the rest are untouched", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValueOnce([
      { id: "a", businessId: "b1", items: [{ path: "u/videos/a-1111.mp4" }], bytes: 5_000_000 },
      { id: "b", businessId: "b1", items: [{ path: "u/videos/b-1111.mp4" }], bytes: 4_000_000 },
      { id: "c", businessId: "b1", items: [{ path: "u/videos/c-1111.mp4" }], bytes: 3_000_000 },
    ]);
    mocks.prisma.post.findMany.mockImplementation(async ({ where }: { where: { mediaPaths: { hasSome: string[] } } }) => {
      const path = where.mediaPaths.hasSome[0];
      if (path.includes("/a-")) return [published(35)];
      if (path.includes("/b-")) return [published(5)];
      return []; // never posted
    });
    const r = await purgePublishedVideos(now);
    expect(r).toEqual({ checked: 3, removed: 1, freedBytes: 5_000_000 });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(["u/videos/a-1111.mp4"]);
    expect(mocks.prisma.contentVisual.updateMany).toHaveBeenCalledWith({ where: { id: "a", bytes: { gt: 0 } }, data: { items: [], bytes: 0, error: VIDEO_REMOVED_NOTE } });
    const query = mocks.prisma.contentVisual.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ kind: "video", bytes: { gt: 0 }, renderedAt: { lte: daysAgo(30) } });
  });

  it("a file Storage would not delete is kept and the visual is not marked", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValueOnce([{ id: "a", businessId: "b1", items: [{ path: "u/videos/a-1111.mp4" }], bytes: 1 }]);
    mocks.prisma.post.findMany.mockResolvedValue([published(60)]);
    mocks.remove.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    expect(await purgePublishedVideos(now)).toMatchObject({ removed: 0 });
    expect(mocks.prisma.contentVisual.updateMany).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("video files leave with their product, campaign or content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.prisma.contentVisual.update.mockResolvedValue({});
    mocks.prisma.contentVisual.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deleting a product removes its content's video files", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", items: [{ path: "u/videos/v1-1111.mp4" }] }]);
    mocks.prisma.post.findFirst.mockResolvedValue(null);
    await releaseSubjectVideos("b1", { productId: "p1" });
    expect(mocks.prisma.contentVisual.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", kind: "video", content: { productId: "p1" } });
    expect(mocks.remove).toHaveBeenCalledWith(["u/videos/v1-1111.mp4"]);
  });

  it("a post still waiting to go out keeps its video: the visual moves to the post's group for the 30-day clean-up", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", kind: "video", plan: {}, items: [{ path: "u/videos/v1-1111.mp4" }] }]);
    mocks.prisma.post.findFirst.mockResolvedValue({ id: "post1", groupId: "g1" });
    await releaseContentVisuals({ userId: "u", businessId: "b1" }, ["c1"]);
    expect(mocks.prisma.post.findFirst.mock.calls[0][0].where).toMatchObject({ businessId: "b1", mediaPaths: { has: "u/videos/v1-1111.mp4" }, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING"] } });
    expect(mocks.prisma.contentVisual.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { contentId: null, groupId: "g1" } });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.prisma.contentVisual.deleteMany).not.toHaveBeenCalled();
  });

  it("pruned content versions take their videos with them when no post waits for them", async () => {
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ id: "v1", kind: "video", plan: {}, items: [{ path: "u/videos/v1-1111.mp4" }] }]);
    mocks.prisma.post.findFirst.mockResolvedValue(null);
    await releaseContentVisuals({ userId: "u", businessId: "b1" }, ["c1"]);
    expect(mocks.remove).toHaveBeenCalledWith(["u/videos/v1-1111.mp4"]);
    expect(mocks.prisma.contentVisual.deleteMany).toHaveBeenCalledWith({ where: { id: "v1", businessId: "b1" } });
  });
});

describe("uploads that were never confirmed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.prisma.contentVisual.updateMany.mockResolvedValue({ count: 1 });
  });

  it("expired reservations are let go and their unconfirmed file deleted; a file that became the video stays", async () => {
    mocks.prisma.contentVisual.findMany
      .mockResolvedValueOnce([
        { id: "a", uploadPath: "u/videos/a-1111.mp4", items: [] },
        { id: "b", uploadPath: "u/videos/b-2222.mp4", items: [{ path: "u/videos/b-2222.mp4" }] },
      ])
      .mockResolvedValueOnce([]);
    const r = await purgeAbandonedUploads(now);
    expect(r).toEqual({ reservations: 2, orphans: 0 });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(["u/videos/a-1111.mp4"]);
    expect(mocks.prisma.contentVisual.updateMany).toHaveBeenCalledWith({ where: { id: "a", uploadExpiresAt: { lte: now } }, data: { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } });
  });

  it("files in a user's videos folder that nothing refers to are deleted after an hour", async () => {
    const old = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    const fresh = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    mocks.prisma.contentVisual.findMany
      .mockResolvedValueOnce([]) // no expired reservations
      .mockResolvedValueOnce([{ businessId: "b1", business: { userId: "u" } }])
      .mockResolvedValueOnce([
        { items: [{ path: "u/videos/kept-1111.mp4" }], uploadPath: null, uploadExpiresAt: null },
        { items: [], uploadPath: "u/videos/uploading-2222.mp4", uploadExpiresAt: new Date(now.getTime() + 60_000) },
      ]);
    mocks.list.mockResolvedValue({
      data: [
        { id: "1", name: "kept-1111.mp4", created_at: old },
        { id: "2", name: "uploading-2222.mp4", created_at: old },
        { id: "3", name: "orphan-3333.mp4", created_at: old },
        { id: "4", name: "waiting-4444.mp4", created_at: old },
        { id: "5", name: "new-5555.mp4", created_at: fresh },
      ],
      error: null,
    });
    mocks.prisma.post.findMany.mockResolvedValue([{ mediaPaths: ["u/videos/waiting-4444.mp4"] }]);
    const r = await purgeAbandonedUploads(now);
    expect(mocks.list).toHaveBeenCalledWith("u/videos", { limit: 1000 });
    expect(mocks.remove).toHaveBeenCalledWith(["u/videos/orphan-3333.mp4"]);
    expect(r.orphans).toBe(1);
  });
});
