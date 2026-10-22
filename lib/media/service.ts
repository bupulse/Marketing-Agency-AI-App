import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { createSignedUploadUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Prisma } from "@/lib/generated/prisma/client";
import { albumProblem, DESTINATION_REQUIRED, parseDestination, type AlbumKind, type Destination } from "./destinations";
import { logError } from "@/lib/errors";
import {
  assetIdFromPath,
  cleanPhotoName,
  extensionFor,
  fileProblem,
  folderNameProblem,
  galleryPath,
  IMPORT_RATE,
  imageSize,
  inferMimeType,
  isMediaType,
  isOwnGalleryPath,
  isOwnGalleryVideoPath,
  isClipPath,
  GALLERY_VIDEO_BUCKET,
  VIDEO_RESERVATION_MS,
  WEBM_READ_MAX_BYTES,
  POSTER_SERVER_MAX_SIDE,
  isVideoType,
  companyVideoMaxBytes,
  POSTER_MAX_BYTES,
  posterPathFor,
  sniffVideoType,
  storedVideoType,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_MS,
  videoQuotaProblem,
  MEDIA_BULK_MAX,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_FOLDERS,
  MEDIA_RATE,
  COUNTED,
  MIGRATED_SOURCE,
  platformMaxBytes,
  platformNearlyFull,
  platformProblem,
  nameFromFile,
  quotaProblem,
  sniffMediaType,
  UNSUPPORTED_MESSAGE,
  UPLOAD_BATCH_MAX,
  type ImportSource,
  type MediaUsage,
} from "./rules";
import { probeMp4Durations, trustedLengthMs, webmDurationMs, webmInfoDurationMs } from "@/lib/visuals/duration";

/** A problem the user can read and act on. Anything else is an unexpected failure. */
export class MediaError extends Error {}

const BUCKET = "media";
const DOWNLOAD_SECONDS = 60 * 60;

export type MediaItem = {
  id: string;
  name: string;
  path: string;
  url: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  bytes: number;
  folderId: string | null;
  createdAt: Date;
  /** "photo" or "video" (docs/MEDIA.md). */
  kind: string;
  /** A video's length, its poster (the first frame, a small JPEG) and the owner's "What's in this video?". */
  durationMs: number | null;
  posterPath: string | null;
  posterUrl: string | null;
  description: string | null;
};

export type FolderSummary = { id: string; name: string; count: number };
/** A product's or campaign's album, as the gallery lists it. */
export type AlbumSummary = { kind: AlbumKind; id: string; name: string; count: number };
export type GalleryOverview = { folders: FolderSummary[]; albums: AlbumSummary[]; unfiled: number; total: number; uncounted: number; usage: MediaUsage; /** Gallery videos' bytes and their cap. */ videos: { bytes: number; max: number } };

type Row = Omit<MediaItem, "url" | "posterUrl">;

export const SELECT = { id: true, name: true, path: true, width: true, height: true, mimeType: true, bytes: true, folderId: true, createdAt: true, kind: true, durationMs: true, posterPath: true, description: true } as const;

/** The business the signed-in user owns, or null before onboarding. Every gallery call starts here. */
export async function businessIdFor(userId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  return business?.id ?? null;
}

/**
 * The bucket an object path lives in: photos in "media" (the user's session, so the Storage policies apply), Gallery
 * videos and posters (`<userId>/clips/`) in the private gallery-videos bucket, which only the server's key reaches.
 */
async function storage(path?: string) {
  return path && isClipPath(path) ? createAdminClient().storage.from(GALLERY_VIDEO_BUCKET) : (await createClient()).storage.from(BUCKET);
}

/** Signed display URLs for object paths, keyed by path. Pass only paths you already know are the caller's own. */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map();
  const clips = unique.filter(isClipPath);
  const photos = unique.filter((p) => !isClipPath(p));
  const out = new Map<string, string>();
  for (const [list, bucket] of [[photos, await storage()], [clips, await storage(clips[0])]] as const) {
    if (list.length === 0) continue;
    const { data } = await bucket.createSignedUrls(list, DOWNLOAD_SECONDS);
    for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  }
  return out;
}

export async function withUrls(rows: Row[]): Promise<MediaItem[]> {
  const urls = await signedUrls(rows.flatMap((r) => (r.posterPath ? [r.path, r.posterPath] : [r.path])));
  return rows.map((r) => ({ ...r, url: urls.get(r.path) ?? "", posterUrl: r.posterPath ? (urls.get(r.posterPath) ?? null) : null }));
}

async function ownFolder(businessId: string, folderId: string) {
  const folder = await prisma.mediaFolder.findFirst({ where: { id: folderId, businessId }, select: { id: true, name: true } });
  if (!folder) throw new MediaError("We could not find that folder.");
  return folder;
}

/** The product or campaign whose album this is, scoped to the business. */
export async function ownAlbum(businessId: string, kind: AlbumKind, id: string): Promise<{ id: string; name: string; count: number }> {
  const row =
    kind === "product"
      ? await prisma.product.findFirst({ where: { id, businessId }, select: { id: true, name: true, _count: { select: { photos: true } } } })
      : await prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true, name: true, _count: { select: { photos: true } } } });
  if (!row) throw new MediaError(kind === "product" ? "We could not find that product." : "We could not find that campaign.");
  return { id: row.id, name: row.name, count: row._count.photos };
}

/**
 * Checks a destination before photos are added to it: it must be named (DESTINATION_REQUIRED otherwise), belong to the
 * business, and an album must have room for `adding` more photos.
 */
export async function resolveDestination(businessId: string, raw: string | null | undefined, adding = 1): Promise<Destination> {
  const destination = parseDestination(raw);
  if (!destination) throw new MediaError(DESTINATION_REQUIRED);
  if (destination.kind === "folder") await ownFolder(businessId, destination.id);
  else {
    const album = await ownAlbum(businessId, destination.kind, destination.id);
    const problem = albumProblem(album.count, adding);
    if (problem) throw new MediaError(problem);
  }
  return destination;
}

type Tx = Prisma.TransactionClient;

/**
 * Adds photos to an album after the ones already there (photos already in it stay where they are). A per-album
 * advisory lock makes the count and the insert one step, so parallel uploads cannot pass the 30-photo cap together.
 */
export async function linkInTx(tx: Tx, kind: AlbumKind, albumId: string, assetIds: string[]): Promise<number> {
  if (assetIds.length === 0) return 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`album:${kind}:${albumId}`}))`;
  const existing =
    kind === "product"
      ? await tx.productPhoto.findMany({ where: { productId: albumId }, select: { assetId: true, position: true } })
      : await tx.campaignPhoto.findMany({ where: { campaignId: albumId }, select: { assetId: true, position: true } });
  const have = new Set(existing.map((e) => e.assetId));
  const fresh = [...new Set(assetIds)].filter((a) => !have.has(a));
  if (fresh.length === 0) return 0;
  const problem = albumProblem(existing.length, fresh.length);
  if (problem) throw new MediaError(problem);
  let next = existing.reduce((max, e) => Math.max(max, e.position + 1), 0);
  if (kind === "product") await tx.productPhoto.createMany({ data: fresh.map((assetId) => ({ productId: albumId, assetId, position: next++ })), skipDuplicates: true });
  else await tx.campaignPhoto.createMany({ data: fresh.map((assetId) => ({ campaignId: albumId, assetId, position: next++ })), skipDuplicates: true });
  return fresh.length;
}

type UsageDb = Pick<Tx, "mediaAsset"> & Partial<Pick<Tx, "contentVisual" | "voiceClip" | "mediaUploadReservation">>;

/**
 * Rendered content videos (docs/CONTENT_VISUALS.md) live in the same bucket and count like photos, and so does every
 * upload the server allowed and has not confirmed yet (its reservation, 8 MB, until it expires).
 */
async function videoUsage(db: UsageDb, businessId?: string, now = new Date()): Promise<MediaUsage> {
  if (!db.contentVisual) return { count: 0, bytes: 0 };
  const scope = businessId ? { businessId } : {};
  const [stored, reserved] = await Promise.all([
    db.contentVisual.aggregate({ where: { kind: "video", bytes: { gt: 0 }, ...scope }, _count: { _all: true }, _sum: { bytes: true } }),
    db.contentVisual.aggregate({ where: { kind: "video", uploadExpiresAt: { gt: now }, ...scope }, _count: { _all: true }, _sum: { uploadBytes: true } }),
  ]);
  // Voiceovers (docs/VOICE_AND_MUSIC.md) are files in the same bucket too.
  const voice = db.voiceClip ? await db.voiceClip.aggregate({ where: { ...scope, status: "ready" }, _count: { _all: true }, _sum: { bytes: true } }) : null;
  // Gallery video uploads allowed and not confirmed yet (docs/MEDIA.md) count at their announced size until they expire.
  const clips = db.mediaUploadReservation ? await db.mediaUploadReservation.aggregate({ where: { ...scope, expiresAt: { gt: now } }, _count: { _all: true }, _sum: { bytes: true } }) : null;
  return {
    count: (stored?._count?._all ?? 0) + (reserved?._count?._all ?? 0) + (voice?._count?._all ?? 0) + (clips?._count?._all ?? 0),
    bytes: (stored?._sum?.bytes ?? 0) + (reserved?._sum?.uploadBytes ?? 0) + (voice?._sum?.bytes ?? 0) + (clips?._sum?.bytes ?? 0),
  };
}

/** What counts toward the company's quota: every photo except the ones the migration copied from old projects, and every rendered video. */
export async function mediaUsage(businessId: string, db: UsageDb = prisma): Promise<MediaUsage> {
  const [sum, videos] = await Promise.all([db.mediaAsset.aggregate({ where: { businessId, ...COUNTED }, _count: { _all: true }, _sum: { bytes: true } }), videoUsage(db, businessId)]);
  return { count: sum._count._all + videos.count, bytes: (sum._sum.bytes ?? 0) + videos.bytes };
}

/**
 * Bytes of every company's photos and videos together: the shared Storage project (MEDIA_PLATFORM_MAX_BYTES). The
 * rows can miss files nobody recorded (an upload written straight to a folder), so the real object sizes in Storage
 * count too: the larger of the two (plus open reservations) is used.
 */
export async function platformBytes(db: UsageDb = prisma): Promise<number> {
  const [sum, videos, objects] = await Promise.all([db.mediaAsset.aggregate({ _sum: { bytes: true } }), videoUsage(db), storageObjectBytes()]);
  const rows = (sum._sum.bytes ?? 0) + videos.bytes;
  return objects === null ? rows : Math.max(rows, objects);
}

let objectBytesCache: { at: number; bytes: number | null } | null = null;

/**
 * Every object's size in the Storage project, summed per bucket by the database (storage.objects, read with the
 * server's database role). Cached a minute; null where the storage schema cannot be read (tests, local databases).
 */
export async function storageObjectBytes(now = Date.now()): Promise<number | null> {
  if (objectBytesCache && now - objectBytesCache.at < 60_000) return objectBytesCache.bytes;
  let bytes: number | null = null;
  try {
    const rows = await prisma.$queryRaw<{ bucket_id: string; bytes: bigint | number | null }[]>`SELECT bucket_id, SUM(COALESCE((metadata->>'size')::bigint, 0)) AS bytes FROM storage.objects GROUP BY bucket_id`;
    bytes = (rows ?? []).reduce((total, r) => total + Number(r.bytes ?? 0), 0);
  } catch {
    bytes = null;
  }
  objectBytesCache = { at: now, bytes };
  return bytes;
}

/** Forgets the cached Storage total (tests, and right after a large delete). */
export function resetStorageObjectBytes() {
  objectBytesCache = null;
}

let warnedAt = 0;

/**
 * Refuses `adding` bytes when the shared storage would pass its cap, with a message the owner can read. From 80% the
 * admin is told: an ErrorLog warning (at most once an hour per server) and an item in the admin Overview's attention box.
 */
export async function assertPlatformRoom(adding: number, db: UsageDb = prisma, now = Date.now()): Promise<void> {
  const used = await platformBytes(db);
  const max = platformMaxBytes();
  if (platformNearlyFull(used + adding, max) && now - warnedAt > 60 * 60 * 1000) {
    warnedAt = now;
    void logError(new Error(`Photo storage is at ${Math.round(((used + adding) / max) * 100)}% of MEDIA_PLATFORM_MAX_BYTES (${used} of ${max} bytes)`), { source: "media.platform-storage", level: "warn" });
  }
  const problem = platformProblem(used, adding, max);
  if (problem) throw new MediaError(problem);
}

/** Forgets the hourly warning throttle (tests). */
export function resetPlatformWarning() {
  warnedAt = 0;
}

/**
 * Photos copied by the migration without a known size (Storage was not readable then) get it now, on the first gallery
 * read: a few per call, from the object's metadata. Best effort; the size is only shown, never counted.
 */
async function fillMigratedSizes(businessId: string): Promise<void> {
  try {
    const rows = await prisma.mediaAsset.findMany({ where: { businessId, source: MIGRATED_SOURCE, bytes: 0 }, take: 10, select: { id: true, path: true } });
    if (rows.length === 0) return;
    const bucket = await storage();
    for (const row of rows) {
      const info = await bucket.info(row.path);
      const size = info.data?.size;
      if (size && size > 0) await prisma.mediaAsset.updateMany({ where: { id: row.id, bytes: 0 }, data: { bytes: size } });
    }
  } catch {}
}

export async function galleryOverview(businessId: string): Promise<GalleryOverview> {
  const albumWhere = { businessId, status: { not: "ARCHIVED" as const } };
  void fillMigratedSizes(businessId);
  const [folders, counts, usage, all, products, campaigns, videoBytes] = await Promise.all([
    prisma.mediaFolder.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.mediaAsset.groupBy({ by: ["folderId"], where: { businessId }, _count: { _all: true } }),
    mediaUsage(businessId),
    prisma.mediaAsset.count({ where: { businessId } }),
    prisma.product.findMany({ where: albumWhere, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, _count: { select: { photos: true } } } }),
    prisma.campaign.findMany({ where: albumWhere, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, _count: { select: { photos: true } } } }),
    galleryVideoBytes(businessId),
  ]);
  const byFolder = new Map(counts.map((c) => [c.folderId, c._count._all]));
  return {
    folders: folders.map((f) => ({ ...f, count: byFolder.get(f.id) ?? 0 })),
    albums: [
      ...products.map((p) => ({ kind: "product" as const, id: p.id, name: p.name, count: p._count.photos })),
      ...campaigns.map((c) => ({ kind: "campaign" as const, id: c.id, name: c.name, count: c._count.photos })),
    ],
    unfiled: byFolder.get(null) ?? 0,
    total: all,
    // Photos moved from old projects are in the gallery but do not count toward the quota.
    uncounted: Math.max(0, all - usage.count),
    usage,
    videos: { bytes: videoBytes, max: companyVideoMaxBytes() },
  };
}

/** An album's photos in album order (the first is the cover), with signed URLs. */
export async function albumItems(businessId: string, kind: AlbumKind, id: string, search?: string): Promise<MediaItem[]> {
  const q = search?.trim().slice(0, 80);
  const assetWhere = { businessId, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) };
  const rows =
    kind === "product"
      ? await prisma.productPhoto.findMany({ where: { productId: id, asset: assetWhere }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 100, select: { asset: { select: SELECT } } })
      : await prisma.campaignPhoto.findMany({ where: { campaignId: id, asset: assetWhere }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 100, select: { asset: { select: SELECT } } });
  return withUrls(rows.map((r) => r.asset));
}

/**
 * One page of the business's photos, newest first. `folderId` undefined is every photo, null is
 * "Not in a folder", a string is that folder; `album` is a product's or campaign's album, in album order (one page).
 * `cursor` is the last id of the previous page.
 */
export async function listMedia(
  businessId: string,
  opts: { folderId?: string | null; album?: { kind: AlbumKind; id: string }; search?: string; take?: number; cursor?: string | null } = {},
): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  if (opts.album) return { items: await albumItems(businessId, opts.album.kind, opts.album.id, opts.search), nextCursor: null };
  const take = Math.min(Math.max(opts.take ?? 48, 1), 100);
  const search = opts.search?.trim().slice(0, 80);
  const rows = await prisma.mediaAsset.findMany({
    where: {
      businessId,
      ...(opts.folderId !== undefined ? { folderId: opts.folderId } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: SELECT,
  });
  const page = rows.slice(0, take);
  return { items: await withUrls(page), nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null };
}

type NewAsset = Prisma.MediaAssetUncheckedCreateInput;

/**
 * Creates the photo row only if it still fits the quota, and puts it in its destination (a folder, or an album link).
 * The check and the insert run in one transaction under a per-business advisory lock, so parallel uploads and imports
 * cannot all pass a stale count.
 */
async function createWithinQuota(data: NewAsset, destination?: Destination, reservationPath?: string): Promise<Row> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-quota:${data.businessId}`}))`;
    // A video's reservation becomes the row: it stops counting before the real size is checked.
    if (reservationPath) await tx.mediaUploadReservation.deleteMany({ where: { path: reservationPath, businessId: data.businessId } });
    const problem = quotaProblem(await mediaUsage(data.businessId, tx), { count: 1, bytes: data.bytes });
    if (problem) throw new MediaError(problem);
    if (data.kind === "video") {
      const videos = videoQuotaProblem(await galleryVideoBytes(data.businessId, tx), data.bytes);
      if (videos) throw new MediaError(videos);
    }
    await assertPlatformRoom(data.bytes, tx);
    const row = await tx.mediaAsset.create({ data: { ...data, folderId: destination?.kind === "folder" ? destination.id : (data.folderId ?? null) }, select: SELECT });
    if (destination && destination.kind !== "folder") await linkInTx(tx, destination.kind, destination.id, [row.id]);
    return row;
  });
}

/** Bytes of the company's gallery videos (their own cap, MEDIA_COMPANY_VIDEO_MAX_BYTES, inside the 2 GB). */
export async function galleryVideoBytes(businessId: string, db: Pick<Tx, "mediaAsset" | "mediaUploadReservation"> = prisma, now = new Date()): Promise<number> {
  const [stored, reserved] = await Promise.all([
    db.mediaAsset.aggregate({ where: { businessId, kind: "video" }, _sum: { bytes: true } }),
    db.mediaUploadReservation.aggregate({ where: { businessId, expiresAt: { gt: now } }, _sum: { bytes: true } }),
  ]);
  return (stored._sum.bytes ?? 0) + (reserved?._sum?.bytes ?? 0);
}

/** The business's own photos among `paths`, with signed URLs. Paths that are not theirs are left out. */
export async function assetsByPaths(businessId: string, paths: string[]): Promise<MediaItem[]> {
  const unique = [...new Set(paths)].slice(0, MEDIA_BULK_MAX);
  if (unique.length === 0) return [];
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, path: { in: unique } }, select: SELECT });
  return withUrls(rows);
}

/** One of the business's photos by id, or null. */
export async function assetById(businessId: string, id: string): Promise<MediaItem | null> {
  const row = await prisma.mediaAsset.findFirst({ where: { id, businessId }, select: SELECT });
  return row ? (await withUrls([row]))[0] : null;
}

/** A signed upload; a video's also carries its poster's (the first frame, uploaded right after it). */
export type UploadTarget = { ok: true; path: string; token: string; poster?: { path: string; token: string } } | { ok: false; error: string };

/**
 * Checks the destination and each file (type, size, quota) and issues a signed upload URL for the ones that pass.
 * The result lines up with `files`. The browser then uploads straight to Storage and calls finalizeUpload.
 */
export async function prepareUploads(
  { userId, businessId }: { userId: string; businessId: string },
  files: { name: string; type: string; size: number }[],
  destination: string | null,
): Promise<UploadTarget[]> {
  if (files.length === 0 || files.length > UPLOAD_BATCH_MAX) throw new MediaError(`Add up to ${UPLOAD_BATCH_MAX} photos at a time.`);
  await resolveDestination(businessId, destination, files.length);
  await assertPlatformRoom(files.reduce((sum, f) => sum + (Number.isFinite(f.size) && f.size > 0 ? f.size : 0), 0));
  await rateLimit(`media-upload:${userId}`, MEDIA_RATE.uploadBatch);

  const used = await mediaUsage(businessId);
  const running = { count: used.count, bytes: used.bytes };
  let videoBytes = files.some((f) => isVideoType(inferMimeType(f.name, f.type))) ? await galleryVideoBytes(businessId) : 0;
  const results: UploadTarget[] = [];
  for (const file of files) {
    const type = inferMimeType(file.name, file.type);
    const video = isVideoType(type);
    const problem = fileProblem(file) ?? quotaProblem(running, { count: 1, bytes: file.size }) ?? (video ? videoQuotaProblem(videoBytes, file.size) : null);
    if (problem) {
      results.push({ ok: false, error: problem });
      continue;
    }
    try {
      const path = galleryPath(userId, globalThis.crypto.randomUUID(), type);
      // A video's upload token is tied to a reservation: finalize takes only a reserved path, at most its size, and the
      // reservation counts toward the quotas until it is confirmed or expires.
      if (video) await prisma.mediaUploadReservation.create({ data: { businessId, path, bytes: file.size, expiresAt: new Date(Date.now() + VIDEO_RESERVATION_MS) } });
      const target = await createSignedUploadUrl(video ? GALLERY_VIDEO_BUCKET : BUCKET, path);
      const poster = video ? await createSignedUploadUrl(GALLERY_VIDEO_BUCKET, posterPathFor(path)) : null;
      results.push({ ok: true, path: target.path, token: target.token, ...(poster ? { poster: { path: poster.path, token: poster.token } } : {}) });
      running.count += 1;
      running.bytes += file.size;
      if (video) videoBytes += file.size;
    } catch {
      results.push({ ok: false, error: `${file.name} could not be started. Please try again.` });
    }
  }
  void sweepOrphans(userId, businessId);
  return results;
}

function clampSize(value: number | null | undefined): number | null {
  return Number.isInteger(value) && value! > 0 && value! <= 30000 ? value! : null;
}

/** The first bytes of an object, read with a ranged request on a short-lived signed URL; null when unreadable. */
async function readHead(path: string, length = 64): Promise<Uint8Array | null> {
  try {
    const url = (await signedUrls([path])).get(path);
    if (!url) return null;
    const res = await fetch(url, { headers: { Range: `bytes=0-${length - 1}` } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer()).subarray(0, length);
  } catch {
    return null;
  }
}

async function dropObject(path: string) {
  try {
    await (await storage(path)).remove([path]);
  } catch {}
}

/**
 * Turns an uploaded object into a gallery photo, after checking that it exists and that its size
 * and type are allowed and the quota still has room. A rejected upload is removed from Storage.
 */
export async function finalizeUpload(
  { userId, businessId }: { userId: string; businessId: string },
  input: { path: string; name: string; destination: string | null; width?: number | null; height?: number | null },
): Promise<MediaItem> {
  const video = isOwnGalleryVideoPath(userId, input.path);
  if (!video && !isOwnGalleryPath(userId, input.path)) throw new MediaError("That upload could not be used.");
  await rateLimit(`media-finalize:${userId}`, MEDIA_RATE.finalize);
  const existing = await prisma.mediaAsset.findUnique({ where: { path: input.path }, select: { ...SELECT, businessId: true } });
  if (existing) {
    if (existing.businessId !== businessId) throw new MediaError("That upload could not be used.");
    // A retry after the row was saved (a lost answer): make sure it is in its destination too.
    const destination = parseDestination(input.destination);
    if (destination) {
      await resolveDestination(businessId, input.destination, 0);
      if (destination.kind === "folder") {
        if (!existing.folderId) await prisma.mediaAsset.updateMany({ where: { id: existing.id, businessId, folderId: null }, data: { folderId: destination.id } });
      } else await prisma.$transaction((tx) => linkInTx(tx, destination.kind as AlbumKind, destination.id, [existing.id]));
    }
    const fresh = await prisma.mediaAsset.findUnique({ where: { path: input.path }, select: SELECT });
    return (await withUrls([fresh ?? existing]))[0];
  }
  let destination: Destination;
  try {
    destination = await resolveDestination(businessId, input.destination);
  } catch (error) {
    await dropObject(input.path);
    throw error;
  }

  // A video: only a path the server reserved for this company, still open (its token was issued for it).
  const reservation = video ? await prisma.mediaUploadReservation.findUnique({ where: { path: input.path } }) : null;
  if (video && (!reservation || reservation.businessId !== businessId || reservation.expiresAt <= new Date())) {
    await dropObject(input.path);
    await dropObject(posterPathFor(input.path));
    throw new MediaError("That upload could not be used. Please upload the video again.");
  }
  const info = await (await storage(input.path)).info(input.path);
  if (info.error || !info.data) throw new MediaError("We could not find that upload. Please try again.");
  const { size, contentType } = info.data;
  const reject = async (message: string): Promise<never> => {
    await dropObject(input.path);
    if (video) await dropObject(posterPathFor(input.path));
    throw new MediaError(message);
  };
  if (video && reservation) {
    // Sizes and quotas first (cheap), before any of the file is read.
    if (!size || size > VIDEO_MAX_BYTES || size > reservation.bytes) return reject("Each video must be 50 MB or smaller, and the size it was started with.");
    const usage = await mediaUsage(businessId);
    const others = { count: Math.max(0, usage.count - 1), bytes: Math.max(0, usage.bytes - reservation.bytes) };
    const quota = quotaProblem(others, { count: 1, bytes: size }) ?? videoQuotaProblem(Math.max(0, (await galleryVideoBytes(businessId)) - reservation.bytes), size);
    if (quota) return reject(quota);
    let checked: Awaited<ReturnType<typeof checkVideo>>;
    try {
      checked = await checkVideo(input.path, size, contentType);
    } catch (error) {
      if (error instanceof MediaError) return reject(error.message);
      throw error;
    }
    let row: Row;
    try {
      row = await createWithinQuota(
        {
          id: assetIdFromPath(input.path),
          businessId,
          path: input.path,
          name: cleanPhotoName(input.name, "Video"),
          kind: "video",
          mimeType: checked.mimeType,
          bytes: (size ?? 0) + checked.posterBytes,
          width: clampSize(input.width),
          height: clampSize(input.height),
          durationMs: checked.durationMs,
          posterPath: checked.posterPath,
        },
        destination,
        input.path,
      );
    } catch (failure) {
      if (failure instanceof MediaError) {
        await dropObject(input.path);
        await dropObject(posterPathFor(input.path));
      }
      throw failure;
    }
    return (await withUrls([row]))[0];
  }
  if (!contentType || !isMediaType(contentType)) return reject("Use a JPG, PNG or WebP photo.");
  if (extensionFor(contentType) !== input.path.slice(input.path.lastIndexOf(".") + 1)) return reject("That photo could not be used.");
  if (!size || size > MEDIA_MAX_BYTES) return reject("Each photo must be 10 MB or smaller.");
  const problem = quotaProblem(await mediaUsage(businessId), { count: 1, bytes: size });
  if (problem) return reject(problem);
  // The recorded content type comes from the uploader, so check the file's own first bytes too.
  const head = await readHead(input.path);
  const sniffed = head && sniffMediaType(head);
  if (!sniffed || sniffed !== contentType) return reject("That file is not a JPG, PNG or WebP photo.");

  let row: Row;
  try {
    row = await createWithinQuota(
      {
        id: assetIdFromPath(input.path),
        businessId,
        path: input.path,
        name: cleanPhotoName(input.name, nameFromFile(input.path)),
        mimeType: contentType,
        bytes: size,
        width: clampSize(input.width),
        height: clampSize(input.height),
      },
      destination,
    );
  } catch (failure) {
    if (failure instanceof MediaError) await dropObject(input.path);
    throw failure;
  }
  return (await withUrls([row]))[0];
}

/** Bytes [start, start + length) of a stored object, by a ranged request on a short-lived signed URL; null when unreadable. */
async function readRange(path: string, start: number, length: number): Promise<Uint8Array | null> {
  try {
    const url = (await signedUrls([path])).get(path);
    if (!url) return null;
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range sends the whole file: take the asked part.
    return res.status === 206 ? bytes.subarray(0, length) : bytes.subarray(start, start + length);
  } catch {
    return null;
  }
}

/**
 * Checks an uploaded gallery video: its own first bytes (MP4, MOV or WebM) and its real length read from the file
 * (videoLengthMs). Its poster is kept when it is a JPEG of at most 400 KB and 1280 px, else dropped (the gallery then
 * shows a plain video tile). Throws a MediaError to reject.
 */
async function checkVideo(path: string, size: number, contentType: string | undefined): Promise<{ mimeType: "video/mp4" | "video/webm"; durationMs: number; posterPath: string | null; posterBytes: number }> {
  if (contentType && !isVideoType(contentType)) throw new MediaError("Use an MP4, MOV or WebM video.");
  const head = await readHead(path);
  const sniffed = head && sniffVideoType(head);
  if (!sniffed) throw new MediaError("That file is not an MP4, MOV or WebM video.");
  const mimeType = storedVideoType(sniffed);
  if (!path.endsWith(mimeType === "video/webm" ? ".webm" : ".mp4")) throw new MediaError("That video could not be used.");
  const durationMs = await videoLengthMs((start, length) => readRange(path, start, length), size, mimeType);
  const poster = await keptPoster(posterPathFor(path));
  return { mimeType, durationMs, posterPath: poster.bytes > 0 ? poster.path : null, posterBytes: poster.bytes };
}

/** A poster next to a video, kept when it is a JPEG of at most 400 KB and 1280 px; otherwise deleted. `bytes` 0: none kept. */
async function keptPoster(poster: string): Promise<{ path: string; bytes: number }> {
  const info = await (await storage(poster)).info(poster).catch(() => null);
  const posterSize = info?.data?.size ?? 0;
  const posterBytes = posterSize > 0 && posterSize <= POSTER_MAX_BYTES ? await readRange(poster, 0, posterSize) : null;
  const posterDims = posterBytes && sniffMediaType(posterBytes) === "image/jpeg" ? imageSize(posterBytes) : null;
  if (posterDims && posterDims.width <= POSTER_SERVER_MAX_SIDE && posterDims.height <= POSTER_SERVER_MAX_SIDE) return { path: poster, bytes: posterSize };
  if (posterSize > 0) await dropObject(poster);
  return { path: poster, bytes: 0 };
}

type ReadRange = (start: number, length: number) => Promise<Uint8Array | null>;

/**
 * A video's length in whole milliseconds, read from the file (60 s at most): an MP4/MOV's movie and track headers (the
 * longest counts; headers that disagree by more than 10% are refused), a WebM's Info duration within its first 8 MB (a
 * longer file without one, as MediaRecorder writes, cannot be measured cheaply). Throws a MediaError to refuse it.
 */
async function videoLengthMs(read: ReadRange, size: number, mimeType: "video/mp4" | "video/webm"): Promise<number> {
  let durationMs: number | null;
  if (mimeType === "video/mp4") durationMs = trustedLengthMs(await probeMp4Durations(read, size));
  else {
    const bytes = await read(0, Math.min(size, WEBM_READ_MAX_BYTES));
    durationMs = !bytes ? null : size <= WEBM_READ_MAX_BYTES ? webmDurationMs(bytes) : webmInfoDurationMs(bytes);
  }
  if (durationMs === null || !(durationMs > 0)) throw new MediaError("We could not read the video's length. Try saving it again as an MP4.");
  if (durationMs > VIDEO_MAX_MS + 500) throw new MediaError("Videos can be at most 60 seconds long. Trim it on your phone and upload it again.");
  return Math.round(durationMs);
}

/** Removes an upload that never became a photo or video (a failed finalize). Only the caller's own, unrecorded files. */
export async function discardUpload(userId: string, path: string): Promise<void> {
  const video = isOwnGalleryVideoPath(userId, path);
  if (!video && !isOwnGalleryPath(userId, path)) return;
  if (await prisma.mediaAsset.findUnique({ where: { path }, select: { id: true } })) return;
  await dropObject(path);
  if (video) {
    await dropObject(posterPathFor(path));
    await prisma.mediaUploadReservation.deleteMany({ where: { path } });
  }
}

/**
 * Best effort: removes gallery files older than an hour that have no photo row, left behind by
 * closed tabs or lost connections. Runs on a small share of upload requests.
 */
export async function sweepOrphans(userId: string, businessId: string, chance = 0.1): Promise<number> {
  if (Math.random() >= chance) return 0;
  try {
    // Every page of the gallery photo and video folders, compared with the database (lib/media/storage-sweep.ts).
    const { sweepCompanyFiles } = await import("./storage-sweep");
    return await sweepCompanyFiles(userId, businessId);
  } catch {
    return 0;
  }
}

// Folders

async function uniqueFolderName(businessId: string, name: string, exceptId?: string) {
  const clash = await prisma.mediaFolder.findFirst({
    where: { businessId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new MediaError("You already have a folder with that name.");
}

export async function createFolder(businessId: string, rawName: string): Promise<FolderSummary> {
  const problem = folderNameProblem(rawName);
  if (problem) throw new MediaError(problem);
  const name = rawName.trim();
  if ((await prisma.mediaFolder.count({ where: { businessId } })) >= MEDIA_MAX_FOLDERS) throw new MediaError(`You can have up to ${MEDIA_MAX_FOLDERS} folders.`);
  await uniqueFolderName(businessId, name);
  const folder = await prisma.mediaFolder.create({ data: { businessId, name }, select: { id: true, name: true } });
  return { ...folder, count: 0 };
}

export async function renameFolder(businessId: string, folderId: string, rawName: string): Promise<void> {
  const problem = folderNameProblem(rawName);
  if (problem) throw new MediaError(problem);
  const name = rawName.trim();
  await ownFolder(businessId, folderId);
  await uniqueFolderName(businessId, name, folderId);
  await prisma.mediaFolder.updateMany({ where: { id: folderId, businessId }, data: { name } });
}

/** Deletes the folder only. Its photos stay in the gallery, moved to "Not in a folder". */
export async function deleteFolder(businessId: string, folderId: string): Promise<{ moved: number }> {
  await ownFolder(businessId, folderId);
  const [moved] = await prisma.$transaction([
    prisma.mediaAsset.updateMany({ where: { businessId, folderId }, data: { folderId: null } }),
    prisma.mediaFolder.deleteMany({ where: { id: folderId, businessId } }),
  ]);
  return { moved: moved.count };
}

// Photos

export async function renameAsset(businessId: string, id: string, rawName: string): Promise<string> {
  const name = cleanPhotoName(rawName, "");
  if (!name) throw new MediaError("Give the photo a name.");
  const { count } = await prisma.mediaAsset.updateMany({ where: { id, businessId }, data: { name } });
  if (count === 0) throw new MediaError("We could not find that photo.");
  return name;
}

/** The owner's "What's in this video?" (or photo): a line or two the AI writes captions about. Empty clears it. */
export async function setAssetDescription(businessId: string, id: string, raw: string): Promise<string | null> {
  const text = raw.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const { count } = await prisma.mediaAsset.updateMany({ where: { id, businessId }, data: { description: text } });
  if (count === 0) throw new MediaError("We could not find that video.");
  return text;
}

/** Moves photos into a folder, or out of any folder when `folderId` is null. Only the business's own photos move. */
export async function moveAssets(businessId: string, ids: string[], folderId: string | null): Promise<number> {
  if (folderId) await ownFolder(businessId, folderId);
  const { count } = await prisma.mediaAsset.updateMany({ where: { businessId, id: { in: ids.slice(0, MEDIA_BULK_MAX) } }, data: { folderId } });
  return count;
}

/** Deletes photos and their Storage files. Files go first so a Storage failure leaves the photos listed. */
export async function deleteAssets(businessId: string, ids: string[]): Promise<number> {
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, id: { in: ids.slice(0, MEDIA_BULK_MAX) } }, select: { id: true, path: true, posterPath: true } });
  if (rows.length === 0) return 0;
  // Also the JPEG copy the publisher makes for Instagram (lib/publishing/media.ts), if there is one; a video and its
  // poster are in the gallery-videos bucket.
  const photos = rows.filter((r) => !isClipPath(r.path)).flatMap((r) => [r.path, `${r.path}.jpg`]);
  const clips = rows.filter((r) => isClipPath(r.path)).flatMap((r) => [r.path, ...(r.posterPath ? [r.posterPath] : [])]);
  for (const list of [photos, clips]) {
    if (list.length === 0) continue;
    const { error } = await (await storage(list[0])).remove(list);
    if (error) throw error;
  }
  const { count } = await prisma.mediaAsset.deleteMany({ where: { businessId, id: { in: rows.map((r) => r.id) } } });
  return count;
}

// Imports

/**
 * Puts a photo downloaded by the server (Google Drive, Dropbox, Canva, a pasted link) into the gallery, with the same
 * checks as an upload: first bytes, 10 MB, JPEG/PNG/WebP, folder and quota. Not downscaled; larger files
 * are refused with a message that says so.
 */
export async function importAsset(
  { userId, businessId }: { userId: string; businessId: string },
  input: { bytes: Uint8Array; name: string; destination: string | null; source: ImportSource },
): Promise<MediaItem> {
  const label = cleanPhotoName(input.name, "That file");
  const { bytes } = input;
  if (bytes.length === 0) throw new MediaError(`${label} is empty.`);
  if (bytes.length > MEDIA_MAX_BYTES) throw new MediaError(`${label} is over 10 MB. Resize it and try again.`);
  const type = sniffMediaType(bytes);
  if (!type) throw new MediaError(`${label}: ${UNSUPPORTED_MESSAGE}`);
  const destination = await resolveDestination(businessId, input.destination);
  const problem = quotaProblem(await mediaUsage(businessId), { count: 1, bytes: bytes.length });
  if (problem) throw new MediaError(problem);
  await assertPlatformRoom(bytes.length);

  // Written with the service key: the checks above (and the caller's active user) are the app's own, and the path is
  // built here in the company folder. The Storage policies are for the browser's own uploads (signed upload URLs).
  const path = galleryPath(userId, globalThis.crypto.randomUUID(), type);
  const { error } = await createAdminClient().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw error;
  const size = imageSize(bytes);
  try {
    const row = await createWithinQuota(
      {
        id: assetIdFromPath(path),
        businessId,
        path,
        name: nameFromFile(input.name),
        mimeType: type,
        bytes: bytes.length,
        width: clampSize(size?.width),
        height: clampSize(size?.height),
        source: input.source,
      },
      destination,
    );
    return (await withUrls([row]))[0];
  } catch (failure) {
    await dropObject(path);
    throw failure;
  }
}

/** Where the browser uploads an imported video's poster (its first frame), with a signed upload token for that path only. */
export type PosterTarget = { path: string; token: string };

/**
 * Puts a video downloaded by the server (a pasted link) into the gallery, with the same checks as an upload: first
 * bytes (MP4, MOV or WebM), 50 MB, its real length (60 s), the destination, the company quota, the company's video cap
 * and the shared storage. It has no poster yet: the server cannot draw a frame, so the browser loads the video, draws
 * its first frame and uploads it to `poster` (then attachPoster). Until then, or if that fails, the gallery shows a
 * plain video tile.
 */
export async function importVideo(
  { userId, businessId }: { userId: string; businessId: string },
  input: { bytes: Uint8Array; name: string; destination: string | null; source: ImportSource },
): Promise<{ item: MediaItem; poster: PosterTarget | null }> {
  const label = cleanPhotoName(input.name, "That video");
  const { bytes } = input;
  const size = bytes.length;
  if (size === 0) throw new MediaError(`${label} is empty.`);
  if (size > VIDEO_MAX_BYTES) throw new MediaError(`${label} is over 50 MB. Please use a shorter or smaller video.`);
  const sniffed = sniffVideoType(bytes);
  if (!sniffed) throw new MediaError(`${label}: ${UNSUPPORTED_MESSAGE}`);
  const mimeType = storedVideoType(sniffed);
  const destination = await resolveDestination(businessId, input.destination);
  const problem = quotaProblem(await mediaUsage(businessId), { count: 1, bytes: size }) ?? videoQuotaProblem(await galleryVideoBytes(businessId), size);
  if (problem) throw new MediaError(problem);
  await assertPlatformRoom(size);
  const durationMs = await videoLengthMs(async (start, length) => bytes.subarray(start, start + length), size, mimeType);

  // Written with the service key into the private gallery-videos bucket, like the poster later (no Storage policy
  // lets a browser write there). The path is built here in the company folder; a MOV is stored and served as MP4.
  const path = galleryPath(userId, globalThis.crypto.randomUUID(), sniffed);
  const { error } = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
  if (error) throw error;
  let row: Row;
  try {
    row = await createWithinQuota(
      { id: assetIdFromPath(path), businessId, path, name: cleanPhotoName(nameFromFile(input.name), "Video"), kind: "video", mimeType, bytes: size, durationMs, posterPath: null, source: input.source },
      destination,
    );
  } catch (failure) {
    await dropObject(path);
    throw failure;
  }
  const poster = await createSignedUploadUrl(GALLERY_VIDEO_BUCKET, posterPathFor(path)).then(
    (t) => ({ path: t.path, token: t.token }),
    () => null,
  );
  return { item: (await withUrls([row]))[0], poster };
}

/**
 * After an imported video's poster was uploaded (importVideo): keeps it when it is a JPEG of at most 400 KB and 1280 px
 * (its bytes then count with the video's) and records the size the browser read, where none is known yet. Only the
 * company's own videos without a poster.
 */
export async function attachPoster(
  { userId, businessId }: { userId: string; businessId: string },
  input: { id: string; width?: number | null; height?: number | null },
): Promise<MediaItem> {
  await rateLimit(`media-finalize:${userId}`, MEDIA_RATE.finalize);
  const row = await prisma.mediaAsset.findFirst({ where: { id: input.id, businessId, kind: "video" }, select: SELECT });
  if (!row || !isOwnGalleryVideoPath(userId, row.path)) throw new MediaError("We could not find that video.");
  if (row.posterPath) return (await withUrls([row]))[0];
  const poster = await keptPoster(posterPathFor(row.path));
  const width = row.width ?? clampSize(input.width);
  const height = row.height ?? clampSize(input.height);
  await prisma.mediaAsset.updateMany({
    where: { id: row.id, businessId, posterPath: null },
    data: { width, height, ...(poster.bytes > 0 ? { posterPath: poster.path, bytes: { increment: poster.bytes } } : {}) },
  });
  const fresh = await prisma.mediaAsset.findFirst({ where: { id: row.id, businessId }, select: SELECT });
  return (await withUrls([fresh ?? row]))[0];
}

/** Counts one import against the per-user limit. Importers call it before downloading anything. */
export async function limitImport(userId: string): Promise<void> {
  await rateLimit(`media-import:${userId}`, IMPORT_RATE);
}

/** Whether the business has imported at least one photo from `source`. Cheap: one indexed count. */
export async function hasImported(businessId: string, source: ImportSource): Promise<boolean> {
  return (await prisma.mediaAsset.count({ where: { businessId, source } })) > 0;
}
