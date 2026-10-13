import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    mediaFolder: { findFirst: vi.fn() },
    mediaAsset: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
    product: { findFirst: vi.fn() },
    productPhoto: { findMany: vi.fn(), createMany: vi.fn() },
    campaignPhoto: { findMany: vi.fn() },
    campaignProduct: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  rateLimit: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  createSignedUrls: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from: () => ({ info: mocks.info, remove: mocks.remove, download: mocks.download, createSignedUrls: mocks.createSignedUrls }) } }),
}));

import { deleteAssets, discardUpload, finalizeUpload, prepareUploads, setAssetDescription } from "@/lib/media/service";
import { subjectVideos, videoLine } from "@/lib/media/videos";
import {
  aspectOf,
  companyVideoMaxBytes,
  fileProblem,
  formatDuration,
  isOwnGalleryPath,
  isOwnGalleryVideoPath,
  posterPathFor,
  sniffVideoType,
  storedVideoType,
  UPLOAD_ACCEPT,
  videoQuotaProblem,
} from "@/lib/media/rules";
import { probeMp4DurationMs } from "@/lib/visuals/duration";
import { composerMediaFor, mediaForPost, videoFitsNetwork } from "@/lib/visuals/post-media";
import { mp4Bytes, webmBytes } from "../visuals/video-bytes";

const USER = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VIDEO = `${USER}/gallery/${ID}.mp4`;
const POSTER = `${USER}/gallery/${ID}-poster.jpg`;
const ctx = { userId: USER, businessId: "biz1" };
const MB = 1024 * 1024;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** A phone-style MP4/MOV: ftyp, a big mdat, then the moov at the end. */
function phoneVideo(durationMs: number, brand = "isom", mdatBytes = 300_000): Uint8Array {
  const plain = mp4Bytes(durationMs);
  const ftypSize = 16;
  const ftyp = [...be32(ftypSize), ..."ftyp".split("").map((c) => c.charCodeAt(0)), ...brand.split("").map((c) => c.charCodeAt(0)), 0, 0, 2, 0];
  const mdat = new Uint8Array(mdatBytes);
  mdat.set([...be32(mdatBytes), ..."mdat".split("").map((c) => c.charCodeAt(0))]);
  return new Uint8Array([...ftyp, ...mdat, ...plain.subarray(ftypSize)]);
}

/** Storage as fetch sees it: ranged GETs on signed URLs, answered 206 with the asked bytes. */
function serve(files: Record<string, Uint8Array>) {
  const fetchMock = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const path = url.replace("https://signed/", "");
    const file = files[path];
    if (!file) return new Response(null, { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? "");
    if (!m) return new Response(file.slice());
    return new Response(file.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  Reflect.deleteProperty(process.env, "MEDIA_COMPANY_VIDEO_MAX_BYTES");
  mocks.remove.mockResolvedValue({ error: null });
  mocks.createSignedUrls.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })) }));
  mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
  mocks.createSignedUploadUrl.mockImplementation(async (_b: string, path: string) => ({ path, token: "tok", signedUrl: "u" }));
  mocks.prisma.mediaFolder.findFirst.mockResolvedValue({ id: "f1", name: "Shop" });
  mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null);
  mocks.prisma.mediaAsset.create.mockImplementation(async ({ data }) => ({ ...data, folderId: "f1", createdAt: new Date(), description: null }));
});

describe("gallery video rules", () => {
  it("MP4, MOV and WebM up to 50 MB; MOV is stored as MP4; photos keep their 10 MB", () => {
    expect(fileProblem({ name: "shop.mov", type: "", size: 20 * MB })).toBeNull();
    expect(fileProblem({ name: "shop.mp4", type: "video/mp4", size: 51 * MB })).toMatch(/50 MB/);
    expect(fileProblem({ name: "shop.avi", type: "video/x-msvideo", size: MB })).toMatch(/MP4, MOV or WebM/);
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: 11 * MB })).toMatch(/10 MB/);
    expect(storedVideoType("video/quicktime")).toBe("video/mp4");
    expect(UPLOAD_ACCEPT).toContain(".mov");
  });

  it("video and poster paths are the owner's own and never pass as photos (designs never draw a video)", () => {
    expect(isOwnGalleryVideoPath(USER, VIDEO)).toBe(true);
    expect(isOwnGalleryPath(USER, VIDEO)).toBe(false);
    expect(posterPathFor(VIDEO)).toBe(POSTER);
    expect(isOwnGalleryPath(USER, POSTER)).toBe(false);
    expect(isOwnGalleryVideoPath("someone-else", VIDEO)).toBe(false);
  });

  it("sniffs the real type from the first bytes", () => {
    expect(sniffVideoType(phoneVideo(1000))).toBe("video/mp4");
    expect(sniffVideoType(phoneVideo(1000, "qt  "))).toBe("video/quicktime");
    expect(sniffVideoType(webmBytes(1000))).toBe("video/webm");
    expect(sniffVideoType(JPEG)).toBeNull();
  });

  it("company video cap (300 MB by default, configurable), aspect and length labels", () => {
    expect(companyVideoMaxBytes()).toBe(300 * MB);
    expect(companyVideoMaxBytes("104857600")).toBe(100 * MB);
    expect(videoQuotaProblem(290 * MB, 20 * MB)).toMatch(/300 MB/);
    expect(videoQuotaProblem(200 * MB, 20 * MB)).toBeNull();
    expect([aspectOf(1080, 1920), aspectOf(1080, 1080), aspectOf(1920, 1080), aspectOf(null, 1)]).toEqual(["portrait", "square", "landscape", null]);
    expect(formatDuration(42_400)).toBe("0:42");
  });

  it("reads an MP4's length with a few ranged reads, never the media data", async () => {
    const file = phoneVideo(42_000, "isom", 2_000_000);
    const reads: [number, number][] = [];
    const ms = await probeMp4DurationMs(async (start, length) => {
      reads.push([start, length]);
      return file.subarray(start, start + length);
    }, file.length);
    expect(ms).toBe(42_000);
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(reads.every(([, length]) => length < 10_000)).toBe(true);
  });
});

describe("uploading a gallery video", () => {
  it("issues a video and a poster target, inside the video cap", async () => {
    const res = await prepareUploads(ctx, [{ name: "shop.mov", type: "video/quicktime", size: 20 * MB }], "folder:f1");
    expect(res[0]).toMatchObject({ ok: true, poster: { path: expect.stringMatching(/-poster\.jpg$/), token: "tok" } });
    expect(res[0].ok && res[0].path).toMatch(/\.mp4$/);
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { bytes: 290 * MB } });
    expect((await prepareUploads(ctx, [{ name: "b.mp4", type: "video/mp4", size: 20 * MB }], "folder:f1"))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/300 MB/) });
  });

  it("finalize reads the real length from the file and keeps the poster; bytes include the poster", async () => {
    const file = phoneVideo(42_000, "qt  ");
    serve({ [VIDEO]: file, [POSTER]: JPEG });
    mocks.info.mockImplementation(async (path: string) => ({ data: { size: path === VIDEO ? file.length : 30_000, contentType: path === VIDEO ? "video/mp4" : "image/jpeg" }, error: null }));
    const item = await finalizeUpload(ctx, { path: VIDEO, name: "Latte art", destination: "folder:f1", width: 1080, height: 1920 });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ kind: "video", mimeType: "video/mp4", durationMs: 42_000, posterPath: POSTER, bytes: file.length + 30_000, width: 1080, height: 1920 });
    expect(item).toMatchObject({ kind: "video", posterUrl: `https://signed/${POSTER}` });
  });

  it("refuses (and deletes) videos over 60 seconds, unreadable files and non-videos", async () => {
    for (const file of [phoneVideo(75_000), JPEG]) {
      serve({ [VIDEO]: file });
      mocks.info.mockResolvedValue({ data: { size: file.length, contentType: "video/mp4" }, error: null });
      mocks.remove.mockClear();
      await expect(finalizeUpload(ctx, { path: VIDEO, name: "x", destination: "folder:f1" })).rejects.toThrow(/60 seconds|not an MP4/);
      expect(mocks.remove).toHaveBeenCalledWith([VIDEO]);
      expect(mocks.remove).toHaveBeenCalledWith([POSTER]);
    }
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("a WebM is read whole; a bad poster is dropped and the video still saves", async () => {
    const webm = `${USER}/gallery/${ID}.webm`;
    const file = webmBytes(12_000);
    serve({ [webm]: file, [`${USER}/gallery/${ID}-poster.jpg`]: new Uint8Array([1, 2, 3, 4]) });
    mocks.download.mockResolvedValue({ data: new Blob([file.slice().buffer]) });
    mocks.info.mockImplementation(async (path: string) => ({ data: { size: path === webm ? file.length : 4, contentType: "video/webm" }, error: null }));
    await finalizeUpload(ctx, { path: webm, name: "x", destination: "folder:f1" });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ mimeType: "video/webm", durationMs: 12_000, posterPath: null });
    expect(mocks.remove).toHaveBeenCalledWith([`${USER}/gallery/${ID}-poster.jpg`]);
  });

  it("the video cap is checked again under the quota lock", async () => {
    const file = phoneVideo(10_000);
    serve({ [VIDEO]: file });
    mocks.info.mockResolvedValue({ data: { size: 40 * MB, contentType: "video/mp4" }, error: null });
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { bytes: 280 * MB } });
    await expect(finalizeUpload(ctx, { path: VIDEO, name: "x", destination: "folder:f1" })).rejects.toThrow(/300 MB/);
    expect(mocks.prisma.$executeRaw).toHaveBeenCalled();
  });

  it("discard and delete take the poster along", async () => {
    await discardUpload(USER, VIDEO);
    expect(mocks.remove).toHaveBeenCalledWith([POSTER]);
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: ID, path: VIDEO, posterPath: POSTER }]);
    mocks.prisma.mediaAsset.deleteMany.mockResolvedValue({ count: 1 });
    await deleteAssets("biz1", [ID]);
    expect(mocks.remove).toHaveBeenLastCalledWith([VIDEO, `${VIDEO}.jpg`, POSTER]);
  });

  it("the owner's description is cleaned, capped and scoped to the business", async () => {
    mocks.prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    expect(await setAssetDescription("biz1", ID, "  Barista making\n a latte  ")).toBe("Barista making a latte");
    expect(mocks.prisma.mediaAsset.updateMany).toHaveBeenCalledWith({ where: { id: ID, businessId: "biz1" }, data: { description: "Barista making a latte" } });
    expect(await setAssetDescription("biz1", ID, "   ")).toBeNull();
  });
});

describe("album videos for the content pipeline", () => {
  it("lists a product's videos in album order with poster, length, aspect and description", async () => {
    mocks.prisma.productPhoto.findMany.mockResolvedValue([{ asset: { id: ID, path: VIDEO, name: "Latte", mimeType: "video/mp4", durationMs: 42_000, width: 1080, height: 1920, description: "Latte art", posterPath: POSTER } }]);
    const [video] = await subjectVideos("biz1", { kind: "product", id: "p1" }, { signed: true });
    expect(mocks.prisma.productPhoto.findMany.mock.calls[0][0].where).toEqual({ productId: "p1", asset: { businessId: "biz1", kind: "video" } });
    expect(video).toMatchObject({ path: VIDEO, name: "Latte", mimeType: "video/mp4", durationMs: 42_000, aspect: "portrait", description: "Latte art", posterUrl: `https://signed/${POSTER}` });
    expect(videoLine(video)).toBe('The post is the owner\'s own 42-second video: "Latte art". Write about what it shows.');
  });

  it("a campaign without videos uses its first product's", async () => {
    mocks.prisma.campaignPhoto.findMany.mockResolvedValue([]);
    mocks.prisma.campaignProduct.findFirst.mockResolvedValue({ productId: "p1" });
    mocks.prisma.productPhoto.findMany.mockResolvedValue([]);
    await subjectVideos("biz1", { kind: "campaign", id: "c1" });
    expect(mocks.prisma.productPhoto.findMany.mock.calls[0][0].where.productId).toBe("p1");
  });
});

describe("publishing a gallery video", () => {
  const rules = { formats: ["POST"], maxImages: 1, videoOnly: false };
  it("goes the same way as a rendered video; too long for a network, it stays out of it with a trim note", () => {
    expect(mediaForPost({ network: "instagram", format: "SCRIPT", rules, images: [], video: VIDEO, videoMs: 42_000 })).toEqual({ format: "POST", mediaPaths: [VIDEO] });
    const long = mediaForPost({ network: "instagram", format: "SCRIPT", rules, images: [], video: VIDEO, videoMs: 120_000 });
    expect(long.mediaPaths).toEqual([]);
    expect(long.note).toMatch(/Instagram Reels takes \(90 seconds\)/);
    expect(videoFitsNetwork("youtube", 60_000)).toBe(true);
    expect(composerMediaFor("instagram", false, [VIDEO, `${USER}/gallery/x.jpg`], [], new Map([[VIDEO, 120_000]]))).toEqual([`${USER}/gallery/x.jpg`]);
    expect(composerMediaFor("facebook", false, [VIDEO], [], new Map([[VIDEO, 120_000]]))).toEqual([VIDEO]);
  });
});
