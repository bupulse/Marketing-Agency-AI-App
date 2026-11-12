import { beforeEach, describe, expect, it, vi } from "vitest";

// The repair of waiting posts with no picture although their pictures are ready (lib/visuals/reattach.ts): which posts
// are picked, and that they are filled through the normal attach (attachToContent / attachToGroup, limited to them).
const mocks = vi.hoisted(() => ({
  prisma: { post: { findMany: vi.fn() }, contentVisual: { findMany: vi.fn() } },
  logError: vi.fn(),
  attachToContent: vi.fn(),
  attachToGroup: vi.fn(),
  readyMedia: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/visuals/service", async (original) => ({
  ...(await original<typeof import("@/lib/visuals/service")>()),
  attachToContent: mocks.attachToContent,
  attachToGroup: mocks.attachToGroup,
  readyMedia: mocks.readyMedia,
}));

import { applyRepairs, findRepairs, healWaitingPosts, keysOf, mediaKey, pickRepairs, resetHealClock, type RepairPost } from "@/lib/visuals/reattach";

const post = (over: Partial<RepairPost> = {}): RepairPost => ({
  id: "p1",
  businessId: "biz1",
  network: "facebook",
  format: "POST",
  mediaPaths: [],
  status: "PENDING_APPROVAL",
  lastError: null,
  text: "Fresh today at the shop",
  source: "DAILY",
  contentId: "c1",
  groupId: "pack1",
  ownerEditedAt: null,
  lockedAt: null,
  ...over,
});
const picture = { images: ["u/designs/a.jpg"], video: null, videoCredit: null };
const carousel = { images: ["u/designs/a.jpg", "u/designs/b.jpg"], video: null, videoCredit: null };
const reel = { images: [], video: "u/videos/r.mp4", videoCredit: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetHealClock();
});

describe("pickRepairs (which posts get their ready pictures)", () => {
  it("an old Daily post: its own content's picture (the 11 November case: LinkedIn, Facebook, Instagram)", () => {
    const posts = [post({ id: "li", network: "linkedin", contentId: "c-li" }), post({ id: "fb", contentId: "c-fb" }), post({ id: "ig", network: "instagram", contentId: "c-ig" })];
    const media = new Map([
      [mediaKey("biz1", { contentId: "c-li" }), picture],
      [mediaKey("biz1", { contentId: "c-fb" }), picture],
      [mediaKey("biz1", { contentId: "c-ig" }), carousel],
    ]);
    const repairs = pickRepairs(posts, media);
    expect(repairs.map((r) => [r.post.id, r.key, r.change.format, r.change.mediaPaths])).toEqual([
      ["li", { contentId: "c-li" }, "POST", ["u/designs/a.jpg"]],
      ["fb", { contentId: "c-fb" }, "POST", ["u/designs/a.jpg"]],
      ["ig", { contentId: "c-ig" }, "CAROUSEL", ["u/designs/a.jpg", "u/designs/b.jpg"]],
    ]);
  });

  it("a day's set post takes its group's pictures; its content comes first when it has its own", () => {
    const media = new Map([[mediaKey("biz1", { groupId: "set1" }), carousel]]);
    expect(pickRepairs([post({ groupId: "set1" })], media)[0].key).toEqual({ groupId: "set1" });
    media.set(mediaKey("biz1", { contentId: "c1" }), picture);
    expect(pickRepairs([post({ groupId: "set1" })], media)[0].key).toEqual({ contentId: "c1" });
  });

  it("Autopilot posts only by their group (attachToContent never touches them)", () => {
    expect(keysOf(post({ source: "AUTOPILOT" }))).toEqual([{ groupId: "pack1" }]);
    expect(keysOf(post({ source: "STUDIO", groupId: null }))).toEqual([{ contentId: "c1" }]);
    const media = new Map([[mediaKey("biz1", { contentId: "c1" }), picture]]);
    expect(pickRepairs([post({ source: "AUTOPILOT" })], media)).toEqual([]);
    media.set(mediaKey("biz1", { groupId: "pack1" }), picture);
    expect(pickRepairs([post({ source: "AUTOPILOT" })], media)).toHaveLength(1);
  });

  it("never: posted, scheduled, owner-edited, being published, the owner's own posts, posts that have media", () => {
    const media = new Map([[mediaKey("biz1", { contentId: "c1" }), picture], [mediaKey("biz1", { groupId: "pack1" }), picture]]);
    const never = [
      post({ status: "SCHEDULED" }),
      post({ status: "PUBLISHED" }),
      post({ status: "PUBLISHING" }),
      post({ status: "FAILED" }),
      post({ ownerEditedAt: new Date() }),
      post({ lockedAt: new Date() }),
      post({ source: "MANUAL" }),
      post({ mediaPaths: ["u/gallery/mine.jpg"] }),
    ];
    expect(pickRepairs(never, media)).toEqual([]);
    expect(pickRepairs([post({ status: "DRAFT" })], media)).toHaveLength(1);
  });

  it("only when the attach would really give it something: a video idea needs the video, an article nothing", () => {
    const pics = new Map([[mediaKey("biz1", { contentId: "c1" }), picture]]);
    expect(pickRepairs([post({ network: "tiktok", format: "SCRIPT" }), post({ network: "linkedin", format: "ARTICLE" })], pics)).toEqual([]);
    const video = new Map([[mediaKey("biz1", { contentId: "c1" }), reel]]);
    const [r] = pickRepairs([post({ network: "instagram", format: "SCRIPT" })], video);
    expect(r.change).toMatchObject({ format: "POST", mediaPaths: ["u/videos/r.mp4"] });
    // Nothing ready, or a key of another company: nothing.
    expect(pickRepairs([post()], new Map([[mediaKey("biz2", { contentId: "c1" }), picture]]))).toEqual([]);
  });
});

describe("findRepairs (reads only)", () => {
  it("reads waiting picture-less posts from Studio, Daily and Autopilot, then the media of keys with anything ready", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post({ id: "fb", contentId: "c-fb" }), post({ id: "ig", network: "instagram", contentId: "c-ig" })]);
    mocks.prisma.contentVisual.findMany.mockResolvedValue([{ businessId: "biz1", contentId: "c-fb", groupId: null }]);
    mocks.readyMedia.mockResolvedValue(picture);
    const repairs = await findRepairs({ businessId: "biz1" });
    const where = mocks.prisma.post.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      businessId: "biz1",
      status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      source: { in: ["STUDIO", "DAILY", "AUTOPILOT"] },
      ownerEditedAt: null,
      lockedAt: null,
      mediaPaths: { isEmpty: true },
    });
    expect(mocks.readyMedia).toHaveBeenCalledTimes(1);
    expect(mocks.readyMedia).toHaveBeenCalledWith("biz1", { contentId: "c-fb" });
    expect(repairs.map((r) => r.post.id)).toEqual(["fb"]);
  });

  it("no candidate posts: one read only", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([]);
    expect(await findRepairs()).toEqual([]);
    expect(mocks.prisma.contentVisual.findMany).not.toHaveBeenCalled();
  });
});

describe("applyRepairs (through the normal attach)", () => {
  it("one attach per content or group, limited to the picked posts, then counts what now has media", async () => {
    const media = new Map([[mediaKey("biz1", { contentId: "c1" }), picture], [mediaKey("biz1", { groupId: "set1" }), carousel]]);
    const repairs = pickRepairs([post({ id: "a" }), post({ id: "b" }), post({ id: "c", contentId: "c9", groupId: "set1" })], media);
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: "a", mediaPaths: ["u/designs/a.jpg"] },
      { id: "b", mediaPaths: [] },
      { id: "c", mediaPaths: ["u/designs/a.jpg", "u/designs/b.jpg"] },
    ]);
    const result = await applyRepairs(repairs);
    expect(mocks.attachToContent).toHaveBeenCalledWith("biz1", "c1", { onlyPosts: ["a", "b"] });
    expect(mocks.attachToGroup).toHaveBeenCalledWith("biz1", "set1", { onlyPosts: ["c"] });
    expect(result).toEqual({ candidates: 3, attached: 2, unchanged: 1, failed: 0 });
  });

  it("a failed attach is counted and logged, the others go on", async () => {
    const media = new Map([[mediaKey("biz1", { contentId: "c1" }), picture], [mediaKey("biz1", { contentId: "c2" }), picture]]);
    const repairs = pickRepairs([post({ id: "a" }), post({ id: "b", contentId: "c2" })], media);
    mocks.attachToContent.mockRejectedValueOnce(new Error("db down"));
    mocks.prisma.post.findMany.mockResolvedValue([{ id: "a", mediaPaths: [] }, { id: "b", mediaPaths: ["u/designs/a.jpg"] }]);
    expect(await applyRepairs(repairs)).toEqual({ candidates: 2, attached: 1, unchanged: 0, failed: 1 });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});

describe("healWaitingPosts (the job loop's safety net)", () => {
  it("looks at the last 3 days at most every 10 minutes", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([]);
    const now = new Date("2026-11-12T08:00:00Z");
    expect(await healWaitingPosts(now)).toEqual({ candidates: 0, attached: 0, unchanged: 0, failed: 0 });
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: new Date("2026-11-09T08:00:00Z") });
    expect(await healWaitingPosts(new Date(now.getTime() + 5 * 60_000))).toBeNull();
    expect(await healWaitingPosts(new Date(now.getTime() + 10 * 60_000))).not.toBeNull();
    expect(mocks.prisma.post.findMany).toHaveBeenCalledTimes(2);
  });

  it("never throws", async () => {
    mocks.prisma.post.findMany.mockRejectedValue(new Error("db down"));
    expect(await healWaitingPosts(new Date())).toBeNull();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
