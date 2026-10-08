import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { createSignedUploadUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
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
  MEDIA_BULK_MAX,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_FOLDERS,
  MEDIA_RATE,
  nameFromFile,
  quotaProblem,
  sniffMediaType,
  UNSUPPORTED_MESSAGE,
  UPLOAD_BATCH_MAX,
  type ImportSource,
  type MediaUsage,
} from "./rules";

/** A problem the user can read and act on. Anything else is an unexpected failure. */
export class MediaError extends Error {}

const BUCKET = "media";
const DOWNLOAD_SECONDS = 60 * 60;
const ORPHAN_AGE_MS = 60 * 60 * 1000;

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
};

export type FolderSummary = { id: string; name: string; count: number };
export type GalleryOverview = { folders: FolderSummary[]; unfiled: number; total: number; usage: MediaUsage };

type Row = Omit<MediaItem, "url">;

const SELECT = { id: true, name: true, path: true, width: true, height: true, mimeType: true, bytes: true, folderId: true, createdAt: true } as const;

/** The business the signed-in user owns, or null before onboarding. Every gallery call starts here. */
export async function businessIdFor(userId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  return business?.id ?? null;
}

async function storage() {
  return (await createClient()).storage.from(BUCKET);
}

/** Signed display URLs for object paths, keyed by path. Pass only paths you already know are the caller's own. */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map();
  const { data } = await (await storage()).createSignedUrls(unique, DOWNLOAD_SECONDS);
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}

async function withUrls(rows: Row[]): Promise<MediaItem[]> {
  const urls = await signedUrls(rows.map((r) => r.path));
  return rows.map((r) => ({ ...r, url: urls.get(r.path) ?? "" }));
}

async function ownFolder(businessId: string, folderId: string) {
  const folder = await prisma.mediaFolder.findFirst({ where: { id: folderId, businessId }, select: { id: true, name: true } });
  if (!folder) throw new MediaError("We could not find that folder.");
  return folder;
}

export async function mediaUsage(businessId: string): Promise<MediaUsage> {
  const sum = await prisma.mediaAsset.aggregate({ where: { businessId }, _count: { _all: true }, _sum: { bytes: true } });
  return { count: sum._count._all, bytes: sum._sum.bytes ?? 0 };
}

export async function galleryOverview(businessId: string): Promise<GalleryOverview> {
  const [folders, counts, usage] = await Promise.all([
    prisma.mediaFolder.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.mediaAsset.groupBy({ by: ["folderId"], where: { businessId }, _count: { _all: true } }),
    mediaUsage(businessId),
  ]);
  const byFolder = new Map(counts.map((c) => [c.folderId, c._count._all]));
  return {
    folders: folders.map((f) => ({ ...f, count: byFolder.get(f.id) ?? 0 })),
    unfiled: byFolder.get(null) ?? 0,
    total: usage.count,
    usage,
  };
}

/**
 * One page of the business's photos, newest first. `folderId` undefined is every photo, null is
 * "Not in a folder", a string is that folder. `cursor` is the last id of the previous page.
 */
export async function listMedia(
  businessId: string,
  opts: { folderId?: string | null; search?: string; take?: number; cursor?: string | null } = {},
): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
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

type NewAsset = Parameters<typeof prisma.mediaAsset.create>[0]["data"] & { businessId: string; bytes: number };

/**
 * Creates the photo row only if it still fits the quota. The check and the insert run in one transaction
 * under a per-business advisory lock, so parallel uploads and imports cannot all pass a stale count.
 */
async function createWithinQuota(data: NewAsset): Promise<Row> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-quota:${data.businessId}`}))`;
    const sum = await tx.mediaAsset.aggregate({ where: { businessId: data.businessId }, _count: { _all: true }, _sum: { bytes: true } });
    const problem = quotaProblem({ count: sum._count._all, bytes: sum._sum.bytes ?? 0 }, { count: 1, bytes: data.bytes });
    if (problem) throw new MediaError(problem);
    return tx.mediaAsset.create({ data, select: SELECT });
  });
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

export type UploadTarget = { ok: true; path: string; token: string } | { ok: false; error: string };

/**
 * Checks each file (type, size, quota, folder) and issues a signed upload URL for the ones that pass.
 * The result lines up with `files`. The browser then uploads straight to Storage and calls finalizeUpload.
 */
export async function prepareUploads(
  { userId, businessId }: { userId: string; businessId: string },
  files: { name: string; type: string; size: number }[],
  folderId: string | null,
): Promise<UploadTarget[]> {
  if (files.length === 0 || files.length > UPLOAD_BATCH_MAX) throw new MediaError(`Add up to ${UPLOAD_BATCH_MAX} photos at a time.`);
  await rateLimit(`media-upload:${userId}`, MEDIA_RATE.uploadBatch);
  if (folderId) await ownFolder(businessId, folderId);

  const used = await mediaUsage(businessId);
  const running = { count: used.count, bytes: used.bytes };
  const results: UploadTarget[] = [];
  for (const file of files) {
    const type = inferMimeType(file.name, file.type);
    const problem = fileProblem(file) ?? quotaProblem(running, { count: 1, bytes: file.size });
    if (problem) {
      results.push({ ok: false, error: problem });
      continue;
    }
    try {
      const path = galleryPath(userId, globalThis.crypto.randomUUID(), type);
      const target = await createSignedUploadUrl(BUCKET, path);
      results.push({ ok: true, path: target.path, token: target.token });
      running.count += 1;
      running.bytes += file.size;
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
    await (await storage()).remove([path]);
  } catch {}
}

/**
 * Turns an uploaded object into a gallery photo, after checking that it exists and that its size
 * and type are allowed and the quota still has room. A rejected upload is removed from Storage.
 */
export async function finalizeUpload(
  { userId, businessId }: { userId: string; businessId: string },
  input: { path: string; name: string; folderId: string | null; width?: number | null; height?: number | null },
): Promise<MediaItem> {
  if (!isOwnGalleryPath(userId, input.path)) throw new MediaError("That upload could not be used.");
  const existing = await prisma.mediaAsset.findUnique({ where: { path: input.path }, select: { ...SELECT, businessId: true } });
  if (existing) {
    if (existing.businessId !== businessId) throw new MediaError("That upload could not be used.");
    return (await withUrls([existing]))[0];
  }
  if (input.folderId) {
    try {
      await ownFolder(businessId, input.folderId);
    } catch (error) {
      await dropObject(input.path);
      throw error;
    }
  }

  const info = await (await storage()).info(input.path);
  if (info.error || !info.data) throw new MediaError("We could not find that upload. Please try again.");
  const { size, contentType } = info.data;
  const reject = async (message: string): Promise<never> => {
    await dropObject(input.path);
    throw new MediaError(message);
  };
  if (!contentType || !isMediaType(contentType)) return reject("Use a JPG, PNG or WebP photo.");
  if (extensionFor(contentType) !== input.path.slice(input.path.lastIndexOf(".") + 1)) return reject("That photo could not be used.");
  if (!size || size > MEDIA_MAX_BYTES) return reject("Each photo must be 10 MB or smaller.");
  // The recorded content type comes from the uploader, so check the file's own first bytes too.
  const head = await readHead(input.path);
  const sniffed = head && sniffMediaType(head);
  if (!sniffed || sniffed !== contentType) return reject("That file is not a JPG, PNG or WebP photo.");
  const problem = quotaProblem(await mediaUsage(businessId), { count: 1, bytes: size });
  if (problem) return reject(problem);

  let row: Row;
  try {
    row = await createWithinQuota({
      id: assetIdFromPath(input.path),
      businessId,
      folderId: input.folderId,
      path: input.path,
      name: cleanPhotoName(input.name, nameFromFile(input.path)),
      mimeType: contentType,
      bytes: size,
      width: clampSize(input.width),
      height: clampSize(input.height),
    });
  } catch (failure) {
    if (failure instanceof MediaError) await dropObject(input.path);
    throw failure;
  }
  return (await withUrls([row]))[0];
}

/** Removes an upload that never became a photo (a failed finalize). Only the caller's own, unrecorded files. */
export async function discardUpload(userId: string, path: string): Promise<void> {
  if (!isOwnGalleryPath(userId, path)) return;
  if (await prisma.mediaAsset.findUnique({ where: { path }, select: { id: true } })) return;
  await dropObject(path);
}

/**
 * Best effort: removes gallery files older than an hour that have no photo row, left behind by
 * closed tabs or lost connections. Runs on a small share of upload requests.
 */
export async function sweepOrphans(userId: string, businessId: string, chance = 0.1): Promise<number> {
  if (Math.random() >= chance) return 0;
  try {
    const bucket = await storage();
    const { data } = await bucket.list(`${userId}/gallery`, { limit: 200, sortBy: { column: "created_at", order: "asc" } });
    const old = (data ?? []).filter((o) => o.id && Date.now() - new Date(o.created_at ?? Date.now()).getTime() > ORPHAN_AGE_MS);
    if (old.length === 0) return 0;
    const paths = old.map((o) => `${userId}/gallery/${o.name}`);
    const known = new Set((await prisma.mediaAsset.findMany({ where: { businessId, path: { in: paths } }, select: { path: true } })).map((r) => r.path));
    const orphans = paths.filter((p) => !known.has(p));
    if (orphans.length > 0) await bucket.remove(orphans);
    return orphans.length;
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

/** Moves photos into a folder, or out of any folder when `folderId` is null. Only the business's own photos move. */
export async function moveAssets(businessId: string, ids: string[], folderId: string | null): Promise<number> {
  if (folderId) await ownFolder(businessId, folderId);
  const { count } = await prisma.mediaAsset.updateMany({ where: { businessId, id: { in: ids.slice(0, MEDIA_BULK_MAX) } }, data: { folderId } });
  return count;
}

/** Deletes photos and their Storage files. Files go first so a Storage failure leaves the photos listed. */
export async function deleteAssets(businessId: string, ids: string[]): Promise<number> {
  const rows = await prisma.mediaAsset.findMany({ where: { businessId, id: { in: ids.slice(0, MEDIA_BULK_MAX) } }, select: { id: true, path: true } });
  if (rows.length === 0) return 0;
  // Also the JPEG copy the publisher makes for Instagram (lib/publishing/media.ts), if there is one.
  const { error } = await (await storage()).remove(rows.flatMap((r) => [r.path, `${r.path}.jpg`]));
  if (error) throw error;
  const { count } = await prisma.mediaAsset.deleteMany({ where: { businessId, id: { in: rows.map((r) => r.id) } } });
  return count;
}

// Imports

/**
 * Puts a photo downloaded by the server (Google Drive, Dropbox, Canva) into the gallery, with the same
 * checks as an upload: first bytes, 10 MB, JPEG/PNG/WebP, folder and quota. Not downscaled; larger files
 * are refused with a message that says so.
 */
export async function importAsset(
  { userId, businessId }: { userId: string; businessId: string },
  input: { bytes: Uint8Array; name: string; folderId: string | null; source: ImportSource },
): Promise<MediaItem> {
  const label = cleanPhotoName(input.name, "That file");
  const { bytes } = input;
  if (bytes.length === 0) throw new MediaError(`${label} is empty.`);
  if (bytes.length > MEDIA_MAX_BYTES) throw new MediaError(`${label} is over 10 MB. Resize it and try again.`);
  const type = sniffMediaType(bytes);
  if (!type) throw new MediaError(`${label}: ${UNSUPPORTED_MESSAGE}`);
  if (input.folderId) await ownFolder(businessId, input.folderId);
  const problem = quotaProblem(await mediaUsage(businessId), { count: 1, bytes: bytes.length });
  if (problem) throw new MediaError(problem);

  const path = galleryPath(userId, globalThis.crypto.randomUUID(), type);
  const { error } = await (await storage()).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw error;
  const size = imageSize(bytes);
  try {
    const row = await createWithinQuota({
      id: assetIdFromPath(path),
      businessId,
      folderId: input.folderId,
      path,
      name: nameFromFile(input.name),
      mimeType: type,
      bytes: bytes.length,
      width: clampSize(size?.width),
      height: clampSize(size?.height),
      source: input.source,
    });
    return (await withUrls([row]))[0];
  } catch (failure) {
    await dropObject(path);
    throw failure;
  }
}

/** Counts one import against the per-user limit. Importers call it before downloading anything. */
export async function limitImport(userId: string): Promise<void> {
  await rateLimit(`media-import:${userId}`, IMPORT_RATE);
}

/** Whether the business has imported at least one photo from `source`. Cheap: one indexed count. */
export async function hasImported(businessId: string, source: ImportSource): Promise<boolean> {
  return (await prisma.mediaAsset.count({ where: { businessId, source } })) > 0;
}
