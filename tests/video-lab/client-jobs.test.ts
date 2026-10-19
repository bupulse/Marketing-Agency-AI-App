import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  videoJob: { findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { CLIENT_JOB_ID, ClientJobError, designInput, labJob } from "@/video-lab/client-jobs";

const me = { userId: "person-1", businessId: "biz-1", companyUserId: "owner-1", role: "MEMBER" };
const PARENT = "c" + "a".repeat(24);

beforeEach(() => vi.clearAllMocks());

describe("a client's design request", () => {
  it("turns the page's request into a design for their own business, with sensible limits", async () => {
    const input = await designInput(me, { productId: "p-1", styleId: "product-hero", hookId: "auto", ratio: "9:16", seconds: 99, versions: 9, purpose: "post", platform: "tiktok", note: "  Make it bright  ", businessId: "SOMEONE-ELSE" });
    expect(input).toMatchObject({ productId: "p-1", templateId: "product-hero", ratio: "9:16", seconds: 30, versions: 4, purpose: "post", platform: "tiktok", note: "Make it bright", mode: "reference", parentId: null });
    expect(input.photoPaths).toBeUndefined();
  });

  it("reads photo ids as the business's own Gallery photos, in the page's order", async () => {
    db.mediaAsset.findMany.mockResolvedValue([{ id: "ph-2", path: "u/b.jpg" }, { id: "ph-1", path: "u/a.jpg" }]);
    const input = await designInput(me, { productId: "p-1", photoIds: ["ph-1", "ph-2", "ph-x"] });
    expect(input.photoPaths).toEqual(["u/a.jpg", "u/b.jpg"]);
    expect(db.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz-1", kind: "photo" }) }));
  });

  it("refuses photo ids that are not the business's", async () => {
    db.mediaAsset.findMany.mockResolvedValue([]);
    await expect(designInput(me, { productId: "p-1", photoIds: ["ph-9"] })).rejects.toThrow(ClientJobError);
  });

  it("edits and extends only a video of their own business", async () => {
    db.videoJob.findFirst.mockResolvedValue(null);
    await expect(designInput(me, { mode: "edit", baseJobId: PARENT, note: "x", productId: "p" })).rejects.toMatchObject({ status: 404 });
    expect(db.videoJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz-1", engine: "motion" }) }));
    await expect(designInput(me, { mode: "edit", baseJobId: "20261019-1a2b3c4d", note: "x", productId: "p" })).rejects.toMatchObject({ status: 404 });
    await expect(designInput(me, { mode: "edit", baseJobId: PARENT, note: "", productId: "p" })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps an edit's photos and ratio from its parent (the page's photo ids are ignored)", async () => {
    const spec = { ratio: "9:16", scenes: [{ seconds: 10 }] };
    db.videoJob.findFirst.mockResolvedValue({ id: PARENT, spec });
    const input = await designInput(me, { mode: "extend", baseJobId: PARENT, productId: "p", seconds: 8, photoIds: ["ph-1"] });
    expect(input).toMatchObject({ mode: "extend", parentId: PARENT, versions: 1 });
    expect(input.photoPaths).toBeUndefined();
  });
});

describe("a VideoJob as the Create page reads it", () => {
  const row = {
    id: PARENT, status: "designed", mode: "reference", spec: { ratio: "9:16", scenes: [] }, brief: { photos: [{ path: "u/a.jpg" }, { path: "u/gone.jpg" }], note: "n", purpose: "post", fixedLens: true },
    caption: "c", hashtags: ["x"], warnings: [], score: { score: 80 }, captionScore: { score: 70, missed: ["price"] }, error: null, parentId: null, productId: "p-1", templateId: "product-hero", hookId: "auto",
    platform: null, ratio: "9:16", seconds: 15, videoPath: null, posterPath: null, bytes: 0, durationMs: null, quality: null, credits: 35, createdAt: new Date("2026-10-19T08:00:00Z"), updatedAt: new Date("2026-10-19T08:01:00Z"),
    product: { name: "Dress" }, business: { name: "Shop" },
  };
  const ids = new Map([["u/a.jpg", "asset-1"]]);

  it("looks like the owner's local job: photo ids for drawing, caption check, no video yet", () => {
    const j = labJob(row as never, ids);
    expect(j).toMatchObject({ id: PARENT, engine: "claude", productName: "Dress", styleId: "product-hero", photoIds: ["asset-1"], status: "designed", video: null, purpose: "post", fixedLens: true, captionScore: 70, captionMissed: ["price"] });
    expect(j.spec).toEqual(row.spec);
  });

  it("shows a saved MP4 as a video and leaves the design out of a list", () => {
    const j = labJob({ ...row, status: "ready", videoPath: "u/clips/v.mp4", bytes: 123 } as never, ids, false);
    expect(j.video).toMatchObject({ bytes: 123 });
    expect(j.status).toBe("designed");
    expect(j.spec).toBeNull();
  });

  it("keeps failed and still-designing jobs as they are", () => {
    expect(labJob({ ...row, status: "failed", error: "no" } as never, ids).status).toBe("failed");
    expect(labJob({ ...row, status: "designing" } as never, ids).status).toBe("designing");
  });

  it("knows a real job id from the owner's local test ids", () => {
    expect(CLIENT_JOB_ID.test(PARENT)).toBe(true);
    expect(CLIENT_JOB_ID.test("20261019-1a2b3c4d")).toBe(false);
  });
});
