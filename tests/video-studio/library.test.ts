import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const prisma = vi.hoisted(() => ({
  videoJob: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  mediaFolder: { findUnique: vi.fn() },
  musicTrack: { findUnique: vi.fn() },
}));
const music = vi.hoisted(() => ({
  activeTracks: vi.fn(async () => [
    { id: "t1", title: "Kigali Sunrise", moods: ["upbeat"], attribution: "", licence: "Original — generated with ElevenLabs Music for BuPulse (commercial use, paid plan)", path: "t1.mp3", url: "https://pub.test/music/t1.mp3" },
    { id: "t2", title: "Night Market", moods: ["afro"], attribution: "Music by A. Artist (CC BY 4.0)", licence: "CC BY 4.0", path: "t2.mp3", url: "https://pub.test/music/t2.mp3" },
  ]),
}));
vi.mock("@/lib/music/service", () => music);
const media = vi.hoisted(() => {
  class MediaError extends Error {}
  return {
    MediaError,
    signedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed.test/${p}`]))),
    createFolder: vi.fn(async () => ({ id: "f-new", name: "Video Studio", count: 0 })),
    prepareUploads: vi.fn(async () => [{ ok: true, path: "u1/clips/x.mp4", token: "t", poster: { path: "u1/clips/x-poster.jpg", token: "tp" } }]),
    finalizeUpload: vi.fn(async (_ctx: unknown, input: { path: string }) => ({ id: "a1", name: "n", path: input.path, url: `https://signed.test/${input.path}`, width: 1080, height: 1920, mimeType: "video/mp4", bytes: 5_000_000, folderId: "f1", createdAt: new Date(), kind: "video", durationMs: 15_000, posterPath: "u1/clips/x-poster.jpg", posterUrl: "https://signed.test/poster", description: null })),
  };
});
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/media/service", () => media);
vi.mock("@/lib/admin/switch", () => ({ assertServiceEnabled: vi.fn(), ServiceDisabledError: class extends Error {} }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: vi.fn() }));
vi.mock("@/lib/usage", () => ({ consumeUsage: vi.fn(), refundUsage: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/video-studio/brief", () => ({
  loadBriefFacts: vi.fn(async () => ({ productId: "p1", business: { name: "Nova Phones Kigali", phone: "+250 788 300 400", language: "English", country: "Rwanda" }, product: { name: "Samsung Galaxy A56", price: "420,000 RWF", usps: ["Genuine"] } })),
}));

import { jobForDrawing, listStudioJobs, openingLines, prepareJobVideo, saveJobVideo, STUDIO_FOLDER, studioTracks } from "@/lib/video-studio/library";
import { VideoStudioError } from "@/lib/video-studio/jobs";

const SPEC = { ratio: "9:16", scenes: [{ seconds: 5, layers: [] }] };
const row = (over: Record<string, unknown> = {}) => ({ id: "j1", status: "designed", engine: "motion", spec: SPEC, caption: "c", hashtags: ["kigali"], warnings: [], score: null, captionScore: null, credits: 35, error: null, parentId: null, productId: "p1", templateId: "product-hero", platform: "tiktok", ratio: "9:16", seconds: 15, videoPath: null, posterPath: null, createdAt: new Date("2026-10-17T10:00:00Z"), ...over });
const ctx = { userId: "u1", businessId: "b1" };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.videoJob.findFirst.mockResolvedValue({ id: "j1", status: "designed", spec: SPEC, productId: "p1", brief: { photos: [{ path: "u1/gallery/a.jpg" }, { path: "u1/gallery/b.jpg" }] } });
  prisma.mediaFolder.findUnique.mockResolvedValue(null);
});

describe("the Create page's library", () => {
  it("lists the company's Motion jobs, newest first, with signed links to finished MP4s", async () => {
    prisma.videoJob.findMany.mockResolvedValue([row({ id: "j2", status: "ready", videoPath: "u1/clips/v.mp4", posterPath: "u1/clips/v-poster.jpg" }), row()]);
    const jobs = await listStudioJobs("b1");
    expect(prisma.videoJob.findMany.mock.calls[0][0]).toMatchObject({ where: { businessId: "b1", engine: "motion" }, orderBy: { createdAt: "desc" } });
    expect(jobs[0]).toMatchObject({ id: "j2", status: "ready", videoUrl: "https://signed.test/u1/clips/v.mp4", posterUrl: "https://signed.test/u1/clips/v-poster.jpg", productId: "p1", templateId: "product-hero" });
    expect(jobs[1]).toMatchObject({ id: "j1", videoUrl: null, posterUrl: null, createdAt: "2026-10-17T10:00:00.000Z" });
  });

  it("opening lines come from the Brain for the product (YouTube is the Brain's Shorts)", async () => {
    const lines = await openingLines("b1", { productId: "p1", templateId: "product-hero", seconds: 15, platform: "youtube" });
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatchObject({ hookId: expect.any(String), line: expect.any(String) });
  });

  it("gives the browser the spec and its photos in the designer's order, with the cut-outs that exist", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([{ path: "u1/gallery/b.jpg", cutoutPath: "u1/gallery/b-cutout.png" }, { path: "u1/gallery/a.jpg", cutoutPath: null }]);
    const out = await jobForDrawing("b1", "j1");
    expect(prisma.videoJob.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: "j1", businessId: "b1", engine: "motion" } });
    expect(out.photoUrls).toEqual(["https://signed.test/u1/gallery/a.jpg", "https://signed.test/u1/gallery/b.jpg"]);
    expect(out.cutoutUrls).toEqual([null, "https://signed.test/u1/gallery/b-cutout.png"]);
    expect(out.spec).toEqual(SPEC);
  });

  it("refuses a job of another company or one not designed yet", async () => {
    prisma.videoJob.findFirst.mockResolvedValueOnce(null);
    await expect(jobForDrawing("b1", "nope")).rejects.toBeInstanceOf(VideoStudioError);
    prisma.videoJob.findFirst.mockResolvedValueOnce({ id: "j1", status: "designing", spec: null, brief: {} });
    await expect(prepareJobVideo(ctx, "j1", { bytes: 100 })).rejects.toBeInstanceOf(VideoStudioError);
    expect(media.prepareUploads).not.toHaveBeenCalled();
  });

  it("uploads the MP4 through the Gallery's checks into the Video Studio folder (made once, then reused)", async () => {
    const first = await prepareJobVideo(ctx, "j1", { bytes: 5_000_000 });
    expect(media.createFolder).toHaveBeenCalledWith("b1", STUDIO_FOLDER);
    expect(first.destination).toBe("folder:f-new");
    expect(media.prepareUploads).toHaveBeenCalledWith(ctx, [{ name: "video-j1.mp4", type: "video/mp4", size: 5_000_000 }], "folder:f-new");
    expect(first.target).toMatchObject({ ok: true, path: "u1/clips/x.mp4" });
    prisma.mediaFolder.findUnique.mockResolvedValue({ id: "f1" });
    expect((await prepareJobVideo(ctx, "j1", { bytes: 5_000_000 })).destination).toBe("folder:f1");
    expect(media.createFolder).toHaveBeenCalledTimes(1);
  });

  it("a Gallery refusal (quota, size) comes back as its own message", async () => {
    media.prepareUploads.mockResolvedValueOnce([{ ok: false, error: "Your gallery is full." }] as never);
    await expect(prepareJobVideo(ctx, "j1", { bytes: 5_000_000 })).rejects.toThrow("Your gallery is full.");
  });

  it("confirms the upload in the Gallery, then the job is ready with the file's real size and length", async () => {
    prisma.videoJob.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));
    const out = await saveJobVideo(ctx, "j1", { path: "u1/clips/x.mp4", destination: "folder:f1", name: "Samsung Galaxy A56 - Product hero", width: 1080, height: 1920 });
    expect(media.finalizeUpload).toHaveBeenCalledWith(ctx, { path: "u1/clips/x.mp4", name: "Samsung Galaxy A56 - Product hero", destination: "folder:f1", width: 1080, height: 1920 });
    expect(prisma.videoJob.update.mock.calls[0][0]).toMatchObject({ where: { id: "j1" }, data: { status: "ready", videoPath: "u1/clips/x.mp4", posterPath: "u1/clips/x-poster.jpg", bytes: 5_000_000, durationMs: 15_000 } });
    expect(out.job).toMatchObject({ status: "ready", videoUrl: "https://signed.test/u1/clips/x.mp4", posterUrl: "https://signed.test/poster" });
  });

  it("music: the library's tracks with their public files, and a credit only where the licence asks for one", async () => {
    expect(await studioTracks()).toEqual([
      { id: "t1", title: "Kigali Sunrise", moods: ["upbeat"], url: "https://pub.test/music/t1.mp3", attribution: null },
      { id: "t2", title: "Night Market", moods: ["afro"], url: "https://pub.test/music/t2.mp3", attribution: "Music by A. Artist (CC BY 4.0)" },
    ]);
    music.activeTracks.mockRejectedValueOnce(new Error("db down"));
    expect(await studioTracks()).toEqual([]);
  });

  it("the track mixed into the MP4 is read from the library and kept on the job, with its credit line", async () => {
    prisma.videoJob.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data }));
    prisma.musicTrack.findUnique.mockResolvedValue({ id: "t2", title: "Night Market", attribution: "Music by A. Artist (CC BY 4.0)", licence: "CC BY 4.0" });
    const out = await saveJobVideo(ctx, "j1", { path: "u1/clips/x.mp4", destination: "folder:f1", name: "n", width: 1080, height: 1920, musicTrackId: "t2" });
    expect(prisma.videoJob.update.mock.calls[0][0].data.music).toEqual({ trackId: "t2", title: "Night Market", attribution: "Music by A. Artist (CC BY 4.0)", owned: false });
    expect(out.job.music).toEqual({ trackId: "t2", title: "Night Market", credit: "Music by A. Artist (CC BY 4.0)" });
    // No music (or a track that is gone): the column is cleared.
    prisma.musicTrack.findUnique.mockResolvedValue(null);
    const none = await saveJobVideo(ctx, "j1", { path: "u1/clips/x.mp4", destination: "folder:f1", name: "n", width: 1080, height: 1920, musicTrackId: "gone" });
    expect(none.job.music).toBeNull();
  });

  it("does not put a photo on a job as its video", async () => {
    media.finalizeUpload.mockResolvedValueOnce({ kind: "photo" } as never);
    await expect(saveJobVideo(ctx, "j1", { path: "u1/gallery/p.jpg", destination: "folder:f1", name: "n", width: null, height: null })).rejects.toThrow("not a video");
    expect(prisma.videoJob.update).not.toHaveBeenCalled();
  });
});
