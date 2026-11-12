import { beforeEach, describe, expect, it, vi } from "vitest";

// "Upload a video" on the Videos page (lib/video-library/upload.ts): the picked videos are checked (type, 50 MB, how
// many), the Gallery's own upload gives the signed uploads in the "Uploaded videos" folder, and a finished upload is
// confirmed by the Gallery (the object, its size and type, the quotas) before its VideoJob (engine "upload") is made.
// Then it is in the library like a studio video, labelled "Uploaded", and deleting it removes its files.

const h = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  products: [] as { id: string; businessId: string }[],
  prepared: [] as { files: { name: string; type: string; size: number }[]; destination: string }[],
  finalized: [] as Record<string, unknown>[],
  finalizeError: null as Error | null,
  deletedAssets: [] as string[],
  waitingPosts: 0,
  nextId: 1,
}));

const media = vi.hoisted(() => {
  class MediaError extends Error {}
  return { MediaError };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    videoJob: {
      findFirst: vi.fn(async ({ where }) =>
        h.jobs.find((j) => (!where.id || j.id === where.id) && j.businessId === where.businessId && (!where.engine || j.engine === where.engine) && (!where.videoPath || typeof where.videoPath !== "string" || j.videoPath === where.videoPath) && (!where.status || j.status === where.status) && (where.videoPath?.not !== null || j.videoPath)) ?? null,
      ),
      findMany: vi.fn(async ({ where }) =>
        h.jobs.filter((j) => j.businessId === where.businessId && j.status === where.status && j.videoPath && (where.engine === undefined || (typeof where.engine === "string" ? j.engine === where.engine : j.engine !== where.engine.not))),
      ),
      create: vi.fn(async ({ data }) => {
        const row = { id: `job${h.nextId++}`, createdAt: new Date("2026-11-12T08:00:00Z"), product: null, ...data };
        h.jobs.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(h.jobs.find((j) => j.id === where.id)!, data)),
    },
    product: { findFirst: vi.fn(async ({ where }) => h.products.find((p) => p.id === where.id && p.businessId === where.businessId) ?? null) },
    contentVisual: { findMany: vi.fn(async () => []) },
    post: { count: vi.fn(async () => h.waitingPosts) },
    mediaAsset: { findFirst: vi.fn(async ({ where }) => ({ id: `asset-of-${where.path}` })) },
  },
}));
vi.mock("@/lib/media/service", () => ({
  MediaError: media.MediaError,
  prepareUploads: vi.fn(async (_ctx: unknown, files: { name: string; type: string; size: number }[], destination: string) => {
    h.prepared.push({ files, destination });
    return files.map((f, i) => (f.name.startsWith("full") ? { ok: false, error: "Your videos have reached their 100 MB of storage. Delete some videos to add more." } : { ok: true, path: `u1/clips/clip-000${i}.mp4`, token: `t${i}`, poster: { path: `u1/clips/clip-000${i}-poster.jpg`, token: `p${i}` } }));
  }),
  finalizeUpload: vi.fn(async (ctx: { businessId: string }, input: Record<string, unknown>) => {
    if (h.finalizeError) throw h.finalizeError;
    h.finalized.push({ businessId: ctx.businessId, ...input });
    return { id: "a1", name: input.name, path: input.path, kind: "video", mimeType: "video/mp4", bytes: 21_000_000, width: input.width ?? null, height: input.height ?? null, durationMs: 31_400, posterPath: `${String(input.path).replace(".mp4", "")}-poster.jpg`, url: "u", posterUrl: "p" };
  }),
  deleteAssets: vi.fn(async (_b: string, ids: string[]) => (h.deletedAssets.push(...ids), ids.length)),
}));
vi.mock("@/lib/video-studio/library", () => ({ studioFolder: vi.fn(async (_b: string, name: string) => `folder:${name}`) }));
vi.mock("@/lib/video-studio/schedule", () => ({ scheduledPostsOf: vi.fn(async () => new Map()) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrls: async (paths: string[], _s: number, opts?: { download?: boolean }) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}${opts?.download ? "?download" : ""}` })) }) }) },
  }),
}));

import { finishVideoUpload, startVideoUploads } from "@/lib/video-library/upload";
import { deleteStudioVideo, LibraryError, listLibraryVideos } from "@/lib/video-library/service";
import { ratioFor, titleFromFile, uploadTitle, UPLOAD_FOLDER } from "@/lib/video-library/upload-rules";
import { finalizeUpload, prepareUploads } from "@/lib/media/service";

const ctx = { userId: "u1", businessId: "biz1", actorId: "person1" };
const MB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  h.jobs = [];
  h.products = [{ id: "p1", businessId: "biz1" }, { id: "p-other", businessId: "biz2" }];
  h.prepared = [];
  h.finalized = [];
  h.finalizeError = null;
  h.deletedAssets = [];
  h.waitingPosts = 0;
  h.nextId = 1;
});

describe("the rules", () => {
  it("reads the ratio from the video's size, a title from the file name and the card title from the caption", () => {
    expect(ratioFor(1080, 1920)).toBe("9:16");
    expect(ratioFor(720, 1280)).toBe("9:16");
    expect(ratioFor(1080, 1350)).toBe("4:5");
    expect(ratioFor(1000, 1000)).toBe("1:1");
    expect(ratioFor(1920, 1080)).toBe("16:9");
    expect(ratioFor(null, null)).toBe("9:16");
    expect(titleFromFile("leaf-ad_v2.mp4")).toBe("leaf ad v2");
    expect(uploadTitle("")).toBe("Uploaded video");
    expect(uploadTitle("Fresh juice every morning\nCall us")).toBe("Fresh juice every morning");
    expect(uploadTitle("x".repeat(80))).toHaveLength(58);
  });
});

describe("starting uploads", () => {
  it("gives each video a signed upload in the Uploaded videos folder, and each refused file its reason, in order", async () => {
    const slots = await startVideoUploads(ctx, [
      { name: "ad.mp4", type: "video/mp4", size: 20 * MB },
      { name: "photo.jpg", type: "image/jpeg", size: MB },
      { name: "huge.mov", type: "", size: 60 * MB },
      { name: "clip.mov", type: "", size: 12 * MB },
    ]);
    expect(h.prepared).toHaveLength(1);
    expect(h.prepared[0].destination).toBe(`folder:${UPLOAD_FOLDER}`);
    expect(h.prepared[0].files.map((f) => f.name)).toEqual(["ad.mp4", "clip.mov"]);
    expect(slots[0]).toEqual({ ok: true, path: "u1/clips/clip-0000.mp4", token: "t0", poster: { path: "u1/clips/clip-0000-poster.jpg", token: "p0" } });
    expect(slots[1]).toEqual({ ok: false, error: "photo.jpg: use an MP4, MOV or WebM video." });
    expect(slots[2]).toEqual({ ok: false, error: "huge.mov is over 50 MB. Please use a shorter or smaller video." });
    expect(slots[3]).toMatchObject({ ok: true, path: "u1/clips/clip-0001.mp4" });
  });

  it("passes on the company's video cap, and asks nothing of Storage when no file can go", async () => {
    const slots = await startVideoUploads(ctx, [{ name: "full.mp4", type: "video/mp4", size: 20 * MB }]);
    expect(slots[0]).toEqual({ ok: false, error: "Your videos have reached their 100 MB of storage. Delete some videos to add more." });
    vi.clearAllMocks();
    await startVideoUploads(ctx, [{ name: "empty.mp4", type: "video/mp4", size: 0 }]);
    expect(prepareUploads).not.toHaveBeenCalled();
  });

  it("takes 1 to 10 videos at a time", async () => {
    await expect(startVideoUploads(ctx, [])).rejects.toBeInstanceOf(LibraryError);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `v${i}.mp4`, type: "video/mp4", size: MB }));
    await expect(startVideoUploads(ctx, eleven)).rejects.toThrow("Pick up to 10 videos at a time.");
  });
});

describe("finishing an upload", () => {
  it("has the Gallery confirm the file first, then makes a ready, seen, credit-free VideoJob of engine upload", async () => {
    const video = await finishVideoUpload(ctx, { path: "u1/clips/clip-0000.mp4", title: "  Fresh juice every morning ", productId: "p1", width: 1080, height: 1920 });
    expect(finalizeUpload).toHaveBeenCalledTimes(1);
    expect(h.finalized[0]).toMatchObject({ businessId: "biz1", path: "u1/clips/clip-0000.mp4", destination: `folder:${UPLOAD_FOLDER}`, name: "Fresh juice every morning", width: 1080, height: 1920 });
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0]).toMatchObject({ businessId: "biz1", userId: "person1", productId: "p1", engine: "upload", status: "ready", ratio: "9:16", seconds: 31, durationMs: 31_400, caption: "Fresh juice every morning", videoPath: "u1/clips/clip-0000.mp4", posterPath: "u1/clips/clip-0000-poster.jpg", bytes: 21_000_000, credits: 0 });
    expect(h.jobs[0].seenAt).toBeInstanceOf(Date);
    expect(h.jobs[0].readyNoticeAt).toBeInstanceOf(Date);
    expect(video).toMatchObject({ key: "upload:job1", source: "upload", engine: "upload", title: "Fresh juice every morning", videoUrl: "https://signed/u1/clips/clip-0000.mp4", downloadUrl: "https://signed/u1/clips/clip-0000.mp4?download", posterUrl: "https://signed/u1/clips/clip-0000-poster.jpg", isNew: false });
  });

  it("makes no video when the Gallery refuses the file (missing, too big, not a video, over the quota)", async () => {
    h.finalizeError = new media.MediaError("Each video must be 50 MB or smaller, and the size it was started with.");
    await expect(finishVideoUpload(ctx, { path: "u1/clips/clip-0000.mp4", title: "", productId: null, width: null, height: null })).rejects.toThrow("Each video must be 50 MB or smaller");
    expect(h.jobs).toHaveLength(0);
  });

  it("refuses another company's file or product before touching anything", async () => {
    await expect(finishVideoUpload(ctx, { path: "u2/clips/clip-0000.mp4", title: "", productId: null, width: null, height: null })).rejects.toThrow("That upload could not be used.");
    await expect(finishVideoUpload(ctx, { path: "u1/gallery/abcdefgh1.jpg", title: "", productId: null, width: null, height: null })).rejects.toThrow("That upload could not be used.");
    await expect(finishVideoUpload(ctx, { path: "u1/clips/clip-0000.mp4", title: "", productId: "p-other", width: null, height: null })).rejects.toThrow("We could not find that product.");
    expect(finalizeUpload).not.toHaveBeenCalled();
    expect(h.jobs).toHaveLength(0);
  });

  it("gives back the same video on a retry, without a second job", async () => {
    const first = await finishVideoUpload(ctx, { path: "u1/clips/clip-0000.mp4", title: "Ad", productId: null, width: 1920, height: 1080 });
    const again = await finishVideoUpload(ctx, { path: "u1/clips/clip-0000.mp4", title: "Ad", productId: null, width: 1920, height: 1080 });
    expect(again.key).toBe(first.key);
    expect(first.ratio).toBe("16:9");
    expect(h.jobs).toHaveLength(1);
    expect(finalizeUpload).toHaveBeenCalledTimes(1);
  });
});

describe("an uploaded video in the library", () => {
  it("is listed as Uploaded (and filtered apart from studio videos), and deleting it removes its Gallery file", async () => {
    await finishVideoUpload(ctx, { path: "u1/clips/clip-0000.mp4", title: "", productId: null, width: null, height: null });
    h.jobs.push({ id: "s1", businessId: "biz1", status: "ready", engine: "motion", ratio: "9:16", durationMs: 15_000, createdAt: new Date("2026-11-11T08:00:00Z"), videoPath: "u1/clips/s1.mp4", posterPath: null, caption: "", seenAt: null, product: { name: "Galaxy A56" } });
    const all = await listLibraryVideos("biz1");
    expect(all.map((v) => [v.key, v.source, v.title])).toEqual([
      ["upload:job1", "upload", "Uploaded video"],
      ["studio:s1", "studio", "Galaxy A56"],
    ]);
    expect((await listLibraryVideos("biz1", { source: "upload" })).map((v) => v.key)).toEqual(["upload:job1"]);
    expect((await listLibraryVideos("biz1", { source: "studio" })).map((v) => v.key)).toEqual(["studio:s1"]);
    expect(await listLibraryVideos("biz2")).toEqual([]);

    h.waitingPosts = 1;
    await expect(deleteStudioVideo("biz1", "job1")).rejects.toBeInstanceOf(LibraryError);
    h.waitingPosts = 0;
    await expect(deleteStudioVideo("biz2", "job1")).rejects.toThrow("That video is already gone.");
    await deleteStudioVideo("biz1", "job1");
    expect(h.deletedAssets).toEqual(["asset-of-u1/clips/clip-0000.mp4"]);
    expect(h.jobs[0]).toMatchObject({ status: "cancelled", videoPath: null, posterPath: null, bytes: 0 });
  });
});
