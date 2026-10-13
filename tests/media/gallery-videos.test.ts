import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn(), findMany: vi.fn() },
    mediaFolder: { findFirst: vi.fn() },
    mediaAsset: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
    mediaUploadReservation: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
    post: { findMany: vi.fn() },
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
  list: vi.fn(),
  buckets: [] as string[],
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }));
const bucketApi = (name: string) => {
  mocks.buckets.push(name);
  return { info: mocks.info, remove: (paths: string[]) => mocks.remove(paths, name), download: mocks.download, createSignedUrls: mocks.createSignedUrls, list: (prefix: string, opts: unknown) => mocks.list(name, prefix, opts) };
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ storage: { from: bucketApi } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: bucketApi } }) }));

import { deleteAssets, discardUpload, finalizeUpload, prepareUploads, setAssetDescription, storageObjectBytes, resetStorageObjectBytes, platformBytes } from "@/lib/media/service";
import { sweepCompanyFiles, sweepStorage } from "@/lib/media/storage-sweep";
import { bucketForPath } from "@/lib/publishing/schemas";
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
import { probeMp4Durations, trustedLengthMs } from "@/lib/visuals/duration";
import { composerMediaFor, mediaForPost, videoFitsNetwork } from "@/lib/visuals/post-media";
import { webmBytes } from "../visuals/video-bytes";

const USER = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VIDEO = `${USER}/clips/${ID}.mp4`;
const POSTER = `${USER}/clips/${ID}-poster.jpg`;
const ctx = { userId: USER, businessId: "biz1" };
const MB = 1024 * 1024;
/** A JPEG header with a start-of-frame giving its size. */
const jpeg = (width: number, height: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = jpeg(720, 1280);

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [...be32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];
const header = (type: string, ms: number) => box(type, [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(Math.round(ms)), ...new Array(80).fill(0)]);
/** A phone-style MP4/MOV: ftyp, a big mdat, then the moov (movie header and one track) at the end. */
function phoneVideo(durationMs: number, brand = "isom", mdatBytes = 300_000, trackMs = durationMs): Uint8Array {
  const ftyp = box("ftyp", [...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 2, 0]);
  const mdat = new Uint8Array(mdatBytes);
  mdat.set([...be32(mdatBytes), ..."mdat".split("").map((c) => c.charCodeAt(0))]);
  const moov = box("moov", [...header("mvhd", durationMs), ...box("trak", box("mdia", header("mdhd", trackMs)))]);
  return new Uint8Array([...ftyp, ...mdat, ...moov]);
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
  mocks.prisma.mediaUploadReservation.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
  mocks.prisma.mediaUploadReservation.findUnique.mockResolvedValue({ path: VIDEO, businessId: "biz1", bytes: 50 * MB, expiresAt: new Date(Date.now() + 3600_000) });
  mocks.prisma.mediaUploadReservation.findMany.mockResolvedValue([]);
  mocks.prisma.mediaUploadReservation.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.buckets.length = 0;
  resetStorageObjectBytes();
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

  it("video and poster paths are the owner's own, in the private gallery-videos bucket, and never pass as photos", () => {
    expect(bucketForPath(VIDEO)).toBe("gallery-videos");
    expect(bucketForPath(POSTER)).toBe("gallery-videos");
    expect(bucketForPath(`${USER}/gallery/x.jpg`)).toBe("media");
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
    const d = await probeMp4Durations(async (start: number, length: number) => {
      reads.push([start, length]);
      return file.subarray(start, start + length);
    }, file.length);
    expect(d).toEqual({ movieMs: 42_000, trackMs: [42_000] });
    expect(trustedLengthMs(d)).toBe(42_000);
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(reads.every(([, length]) => length < 10_000)).toBe(true);
  });
});

describe("video lengths", () => {
  it("the longest of movie and tracks counts; headers that disagree by more than 10% are refused", () => {
    expect(trustedLengthMs({ movieMs: 20_000, trackMs: [21_000, 19_000] })).toBe(21_000);
    expect(trustedLengthMs({ movieMs: 20_000, trackMs: [70_000] })).toBeNull();
    expect(trustedLengthMs({ movieMs: null, trackMs: [] })).toBeNull();
  });
});

describe("uploading a gallery video", () => {
  it("issues a video and a poster target in the private bucket, tied to a reservation, inside the video cap", async () => {
    const res = await prepareUploads(ctx, [{ name: "shop.mov", type: "video/quicktime", size: 20 * MB }], "folder:f1");
    expect(res[0]).toMatchObject({ ok: true, poster: { path: expect.stringMatching(/-poster\.jpg$/), token: "tok" } });
    expect(res[0].ok && res[0].path).toMatch(new RegExp(`^${USER}/clips/.+\\.mp4$`));
    expect(mocks.createSignedUploadUrl.mock.calls.map((c) => c[0])).toEqual(["gallery-videos", "gallery-videos"]);
    expect(mocks.prisma.mediaUploadReservation.create.mock.calls[0][0].data).toMatchObject({ businessId: "biz1", bytes: 20 * MB });
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { bytes: 290 * MB } });
    expect((await prepareUploads(ctx, [{ name: "b.mp4", type: "video/mp4", size: 20 * MB }], "folder:f1"))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/300 MB/) });
  });

  it("finalize takes only a reserved path of this company, still open, and no bigger than announced", async () => {
    const file = phoneVideo(10_000);
    serve({ [VIDEO]: file });
    mocks.info.mockResolvedValue({ data: { size: file.length, contentType: "video/mp4" }, error: null });
    for (const reservation of [null, { path: VIDEO, businessId: "other", bytes: 50 * MB, expiresAt: new Date(Date.now() + 1000) }, { path: VIDEO, businessId: "biz1", bytes: 50 * MB, expiresAt: new Date(Date.now() - 1000) }]) {
      mocks.prisma.mediaUploadReservation.findUnique.mockResolvedValueOnce(reservation);
      await expect(finalizeUpload(ctx, { path: VIDEO, name: "x", destination: "folder:f1" })).rejects.toThrow(/upload the video again/);
    }
    mocks.prisma.mediaUploadReservation.findUnique.mockResolvedValueOnce({ path: VIDEO, businessId: "biz1", bytes: 100, expiresAt: new Date(Date.now() + 1000) });
    await expect(finalizeUpload(ctx, { path: VIDEO, name: "x", destination: "folder:f1" })).rejects.toThrow(/size it was started with/);
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith(`media-finalize:${USER}`, { limit: 300, windowSeconds: 3600 });
  });

  it("finalize reads the real length from the file and keeps the poster; bytes include the poster", async () => {
    const file = phoneVideo(42_000, "qt  ");
    serve({ [VIDEO]: file, [POSTER]: JPEG });
    mocks.info.mockImplementation(async (path: string) => ({ data: { size: path === VIDEO ? file.length : 30_000, contentType: path === VIDEO ? "video/mp4" : "image/jpeg" }, error: null }));
    const item = await finalizeUpload(ctx, { path: VIDEO, name: "Latte art", destination: "folder:f1", width: 1080, height: 1920 });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ kind: "video", mimeType: "video/mp4", durationMs: 42_000, posterPath: POSTER, bytes: file.length + 30_000, width: 1080, height: 1920 });
    expect(item).toMatchObject({ kind: "video", posterUrl: `https://signed/${POSTER}` });
    // The reservation becomes the row inside the quota lock.
    expect(mocks.prisma.mediaUploadReservation.deleteMany).toHaveBeenCalledWith({ where: { path: VIDEO, businessId: "biz1" } });
  });

  it("refuses (and deletes) videos over 60 seconds, unreadable files and non-videos", async () => {
    for (const file of [phoneVideo(75_000), phoneVideo(20_000, "isom", 1000, 70_000), JPEG]) {
      serve({ [VIDEO]: file });
      mocks.info.mockResolvedValue({ data: { size: file.length, contentType: "video/mp4" }, error: null });
      mocks.remove.mockClear();
      await expect(finalizeUpload(ctx, { path: VIDEO, name: "x", destination: "folder:f1" })).rejects.toThrow(/60 seconds|not an MP4|length/);
      expect(mocks.remove).toHaveBeenCalledWith([VIDEO], "gallery-videos");
      expect(mocks.remove).toHaveBeenCalledWith([POSTER], "gallery-videos");
    }
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("a WebM is read at most 8 MB in (never downloaded whole); a poster that is not a small JPEG is dropped", async () => {
    const webm = `${USER}/clips/${ID}.webm`;
    const file = webmBytes(12_000);
    const fetchMock = serve({ [webm]: file, [`${USER}/clips/${ID}-poster.jpg`]: jpeg(1920, 1080) });
    mocks.prisma.mediaUploadReservation.findUnique.mockResolvedValue({ path: webm, businessId: "biz1", bytes: 50 * MB, expiresAt: new Date(Date.now() + 1000) });
    mocks.info.mockImplementation(async (path: string) => ({ data: { size: path === webm ? file.length : 20, contentType: "video/webm" }, error: null }));
    await finalizeUpload(ctx, { path: webm, name: "x", destination: "folder:f1" });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ mimeType: "video/webm", durationMs: 12_000, posterPath: null });
    expect(mocks.remove).toHaveBeenCalledWith([`${USER}/clips/${ID}-poster.jpg`], "gallery-videos");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => /bytes=\d+-\d+/.test(String((init as { headers?: Record<string, string> })?.headers?.Range)))).toBe(true);
  });

  it("quotas are checked first, before any of the file is read", async () => {
    const fetchMock = serve({ [VIDEO]: phoneVideo(10_000) });
    mocks.info.mockResolvedValue({ data: { size: 40 * MB, contentType: "video/mp4" }, error: null });
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { bytes: 280 * MB } });
    // Its own reservation (40 MB) is counted in the usage and taken out again for the check.
    mocks.prisma.mediaUploadReservation.findUnique.mockResolvedValue({ path: VIDEO, businessId: "biz1", bytes: 40 * MB, expiresAt: new Date(Date.now() + 1000) });
    mocks.prisma.mediaUploadReservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _sum: { bytes: 40 * MB } });
    await expect(finalizeUpload(ctx, { path: VIDEO, name: "x", destination: "folder:f1" })).rejects.toThrow(/300 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discard and delete take the poster (and the reservation) along, each in its bucket", async () => {
    await discardUpload(USER, VIDEO);
    expect(mocks.remove).toHaveBeenCalledWith([POSTER], "gallery-videos");
    expect(mocks.prisma.mediaUploadReservation.deleteMany).toHaveBeenCalledWith({ where: { path: VIDEO } });
    const photo = `${USER}/gallery/${ID}.jpg`;
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: ID, path: VIDEO, posterPath: POSTER }, { id: "p", path: photo, posterPath: null }]);
    mocks.prisma.mediaAsset.deleteMany.mockResolvedValue({ count: 2 });
    await deleteAssets("biz1", [ID, "p"]);
    expect(mocks.remove).toHaveBeenCalledWith([photo, `${photo}.jpg`], "media");
    expect(mocks.remove).toHaveBeenCalledWith([VIDEO, POSTER], "gallery-videos");
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

describe("unrecorded files", () => {
  const hourAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const fresh = new Date().toISOString();
  const page = (names: string[], created = hourAgo) => ({ data: names.map((name) => ({ id: name, name, created_at: created })), error: null });

  it("each company's gallery, videos and stray folders are read page by page and compared with the database", async () => {
    const many = Array.from({ length: 1000 }, (_, i) => `old-${String(i).padStart(4, "0")}.jpg`);
    mocks.list.mockImplementation(async (bucket: string, prefix: string, opts: { offset: number }) => {
      if (bucket === "media" && prefix === `${USER}/gallery`) return opts.offset === 0 ? page(many) : page(["kept.jpg", "kept.jpg.jpg", "new.jpg"].slice(0, 2).concat([]), hourAgo);
      if (bucket === "gallery-videos" && prefix === `${USER}/clips`) return page([`${ID}.mp4`, `${ID}-poster.jpg`, "lost.mp4"]);
      if (bucket === "media" && prefix === USER) return { data: [{ id: null, name: "gallery" }, { id: null, name: "videos" }, { id: null, name: "junk" }, { id: "x", name: "loose.bin", created_at: hourAgo }], error: null };
      if (bucket === "media" && prefix === `${USER}/junk`) return page(["big.bin"]);
      return { data: [], error: null };
    });
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([{ path: `${USER}/gallery/kept.jpg`, posterPath: null }, { path: VIDEO, posterPath: POSTER }]);
    const removed = await sweepCompanyFiles(USER, "biz1", { strangers: true });
    const calls = mocks.remove.mock.calls as [string[], string][];
    const gone = (bucket: string) => calls.filter(([, b]) => b === bucket).flatMap(([p]) => p);
    expect(gone("media")).toContain(`${USER}/gallery/old-0999.jpg`);
    expect(gone("media")).not.toContain(`${USER}/gallery/kept.jpg`);
    expect(gone("media")).not.toContain(`${USER}/gallery/kept.jpg.jpg`);
    expect(gone("gallery-videos")).toEqual([`${USER}/clips/lost.mp4`]);
    expect(gone("media")).toEqual(expect.arrayContaining([`${USER}/junk/big.bin`, `${USER}/loose.bin`]));
    expect(gone("media").some((p) => p.startsWith(`${USER}/videos/`))).toBe(false);
    expect(removed).toBe(1000 + 1 + 2);
  });

  it("files younger than an hour and files of open uploads or waiting posts stay", async () => {
    mocks.list.mockImplementation(async (bucket: string, prefix: string) => {
      if (prefix === `${USER}/gallery`) return page(["new.jpg"], fresh);
      if (prefix === `${USER}/clips`) return page(["open.mp4", "posted.mp4"]);
      return { data: [], error: null };
    });
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([]);
    mocks.prisma.mediaUploadReservation.findMany.mockResolvedValue([{ path: `${USER}/clips/open.mp4` }]);
    mocks.prisma.post.findMany.mockResolvedValue([{ mediaPaths: [`${USER}/clips/posted.mp4`] }]);
    expect(await sweepCompanyFiles(USER, "biz1")).toBe(0);
  });

  it("the daily sweep drops expired reservations and walks every company, the owner's and each team member's folders", async () => {
    const MEMBER = "22222222-2222-2222-2222-222222222222";
    mocks.prisma.mediaUploadReservation.deleteMany.mockResolvedValue({ count: 2 });
    mocks.prisma.business.findMany.mockResolvedValueOnce([{ id: "biz1", userId: USER, memberships: [{ userId: USER }, { userId: MEMBER }] }]);
    mocks.list.mockResolvedValue({ data: [], error: null });
    expect(await sweepStorage()).toMatchObject({ companies: 1, reservations: 2, partial: false });
    const prefixes = mocks.list.mock.calls.map((c) => c[1]);
    expect(prefixes).toEqual(expect.arrayContaining([`${USER}/gallery`, `${USER}/clips`, USER, `${MEMBER}/gallery`, `${MEMBER}/clips`, MEMBER]));
    expect(prefixes.filter((p) => p === USER)).toHaveLength(1);
  });

  it("nested folders are followed (bounded depth): files deep in a stray or gallery folder go too", async () => {
    mocks.list.mockImplementation(async (bucket: string, prefix: string) => {
      const folder = (name: string) => ({ id: null, name });
      if (bucket === "media" && prefix === USER) return { data: [folder("junk")], error: null };
      if (prefix === `${USER}/junk`) return { data: [folder("a")], error: null };
      if (prefix === `${USER}/junk/a`) return { data: [folder("b"), { id: "1", name: "deep.bin", created_at: hourAgo }], error: null };
      if (prefix === `${USER}/junk/a/b`) return page(["deeper.bin"]);
      if (prefix === `${USER}/gallery`) return { data: [folder("x")], error: null };
      if (prefix === `${USER}/gallery/x`) return page(["hidden.jpg"]);
      // Past the depth limit nothing is listed.
      if (prefix.split("/").length > 7) throw new Error("too deep");
      return { data: [folder("z")], error: null };
    });
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([]);
    await sweepCompanyFiles(USER, "biz1", { strangers: true });
    const gone = (mocks.remove.mock.calls as [string[], string][]).flatMap(([p]) => p);
    expect(gone).toEqual(expect.arrayContaining([`${USER}/junk/a/deep.bin`, `${USER}/junk/a/b/deeper.bin`, `${USER}/gallery/x/hidden.jpg`]));
  });

  it("the platform guard counts the real object sizes in Storage, not just rows", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ bucket_id: "media", bytes: BigInt(600 * MB) }, { bucket_id: "gallery-videos", bytes: BigInt(200 * MB) }]);
    (mocks.prisma as unknown as { $queryRaw: unknown }).$queryRaw = queryRaw;
    expect(await storageObjectBytes()).toBe(800 * MB);
    expect(await platformBytes(mocks.prisma as never)).toBe(800 * MB);
    resetStorageObjectBytes();
    queryRaw.mockRejectedValueOnce(new Error("no storage schema"));
    expect(await storageObjectBytes()).toBeNull();
  });
});

describe("the gallery-videos bucket migration", () => {
  it("a private 50 MB bucket for videos and posters, media back to 10 MB, no session overwrite in media", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("prisma/migrations/20261017140000_gallery_videos_bucket/migration.sql", "utf8");
    expect(sql).toContain("UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'media'");
    expect(sql).toContain("VALUES ('gallery-videos', 'gallery-videos', false, 52428800, ARRAY['video/mp4', 'video/webm', 'image/jpeg'])");
    expect(sql).toMatch(/folder text := \$f\$bucket_id IN \('brand', 'designs'\)/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*gallery-videos/);
    expect(sql).toContain('REVOKE ALL ON TABLE "MediaUploadReservation" FROM PUBLIC, anon, authenticated, service_role;');
  });
});
