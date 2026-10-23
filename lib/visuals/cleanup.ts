// Storage clean-up for content videos (docs/CONTENT_VISUALS.md): a video file is deleted 30 days after the last post
// that used it was published. The posts and the ContentVisual stay; the visual says the video was removed. Videos no
// post has used yet are kept. Run daily by /api/cron/media-cleanup.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { readItems, WAITING_STATUSES } from "./service";
import { clipPathsOf } from "./clip-scenes";
import { readVideoPlan } from "./video-plan";

import { VIDEO_REMOVED_NOTE, VIDEO_RETENTION_DAYS } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;

/**
 * Pure: may this video file go? Only when posts used it, none is still waiting to go out, and the last one was
 * published at least 30 days ago. Failed or cancelled posts do not keep it.
 */
export function videoExpired(posts: { status: string; publishedAt: Date | null }[], now: Date): boolean {
  if (posts.some((p) => (WAITING_STATUSES as readonly string[]).includes(p.status))) return false;
  const published = posts.flatMap((p) => (p.publishedAt ? [p.publishedAt.getTime()] : []));
  if (published.length === 0) return false;
  return Math.max(...published) <= now.getTime() - VIDEO_RETENTION_DAYS * DAY_MS;
}

export interface CleanupResult {
  checked: number;
  removed: number;
  freedBytes: number;
}

/** Deletes the files of videos whose posts went out 30 or more days ago. Pages through every stored video; idempotent. */
export async function purgePublishedVideos(now = new Date(), options: { budgetMs?: number } = {}): Promise<CleanupResult> {
  const started = Date.now();
  const budget = options.budgetMs ?? 45_000;
  const result: CleanupResult = { checked: 0, removed: 0, freedBytes: 0 };
  const cutoff = new Date(now.getTime() - VIDEO_RETENTION_DAYS * DAY_MS);
  let cursor: string | null = null;
  for (;;) {
    // A video rendered after the cutoff cannot have been posted before it.
    const rows: { id: string; businessId: string; items: Prisma.JsonValue; plan: Prisma.JsonValue; bytes: number }[] = await prisma.contentVisual.findMany({
      where: { kind: "video", bytes: { gt: 0 }, renderedAt: { lte: cutoff }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, businessId: true, items: true, plan: true, bytes: true },
    });
    if (rows.length === 0) return result;
    for (const row of rows) {
      cursor = row.id;
      result.checked += 1;
      const paths = readItems(row.items).map((i) => i.path);
      if (paths.length === 0) continue;
      const posts = await prisma.post.findMany({ where: { businessId: row.businessId, mediaPaths: { hasSome: paths } }, select: { status: true, publishedAt: true } });
      if (!videoExpired(posts, now)) continue;
      // The video's AI clips (lib/visuals/ai-clips.ts) go with it.
      const { error } = await createAdminClient().storage.from("media").remove([...paths, ...clipPathsOf(readVideoPlan(row.plan))]);
      if (error) {
        await logError(new Error(`Could not remove an expired video: ${error.message}`), { source: "visuals.cleanup", level: "warn", businessId: row.businessId });
        continue;
      }
      await prisma.contentVisual.updateMany({ where: { id: row.id, bytes: { gt: 0 } }, data: { items: [], bytes: 0, error: VIDEO_REMOVED_NOTE } });
      result.removed += 1;
      result.freedBytes += row.bytes;
    }
    if (rows.length < PAGE || Date.now() - started > budget) return result;
  }
}

/** A file in a user's videos folder is left alone for this long: it may be an upload still on its way. */
export const ORPHAN_AGE_MS = 60 * 60 * 1000;
const ORPHAN_USERS_PER_RUN = 200;

export interface UploadCleanupResult {
  reservations: number;
  orphans: number;
}

/**
 * Uploads that were allowed but never confirmed: expired reservations are let go (and their file deleted unless it
 * became the video), and files in `<userId>/videos/` that no visual or waiting post refers to are deleted once they
 * are an hour old. So a closed tab or a browser that skipped the confirmation cannot fill the storage.
 */
export async function purgeAbandonedUploads(now = new Date()): Promise<UploadCleanupResult> {
  const result: UploadCleanupResult = { reservations: 0, orphans: 0 };
  const bucket = createAdminClient().storage.from("media");

  const expired = await prisma.contentVisual.findMany({ where: { uploadExpiresAt: { lte: now } }, take: 500, select: { id: true, uploadPath: true, items: true } });
  for (const row of expired) {
    const kept = readItems(row.items).some((i) => i.path === row.uploadPath);
    if (row.uploadPath && !kept) await bucket.remove([row.uploadPath]).catch(() => {});
    await prisma.contentVisual.updateMany({ where: { id: row.id, uploadExpiresAt: { lte: now } }, data: { uploadPath: null, uploadBytes: 0, uploadExpiresAt: null } });
    result.reservations += 1;
  }

  const businesses = await prisma.contentVisual.findMany({ where: { kind: "video" }, distinct: ["businessId"], take: ORPHAN_USERS_PER_RUN, select: { businessId: true, business: { select: { userId: true } } } });
  for (const { businessId, business } of businesses) {
    const folder = `${business.userId}/videos`;
    const { data: files, error } = await bucket.list(folder, { limit: 1000 });
    if (error || !files?.length) continue;
    const old = files.filter((f) => f.id && f.created_at && now.getTime() - new Date(f.created_at).getTime() > ORPHAN_AGE_MS).map((f) => `${folder}/${f.name}`);
    if (old.length === 0) continue;
    const visuals = await prisma.contentVisual.findMany({ where: { businessId, kind: "video" }, select: { items: true, uploadPath: true, uploadExpiresAt: true } });
    const known = new Set(visuals.flatMap((v) => [...readItems(v.items).map((i) => i.path), ...(v.uploadPath && v.uploadExpiresAt && v.uploadExpiresAt > now ? [v.uploadPath] : [])]));
    const candidates = old.filter((p) => !known.has(p));
    if (candidates.length === 0) continue;
    // A post that has not gone out yet keeps its file whatever happened to the visual.
    const waiting = await prisma.post.findMany({ where: { businessId, mediaPaths: { hasSome: candidates }, status: { in: [...WAITING_STATUSES] } }, select: { mediaPaths: true } });
    const held = new Set(waiting.flatMap((p) => p.mediaPaths));
    const orphans = candidates.filter((p) => !held.has(p));
    if (orphans.length === 0) continue;
    const { error: removeError } = await bucket.remove(orphans);
    if (removeError) await logError(new Error(`Could not remove orphan videos: ${removeError.message}`), { source: "visuals.cleanup.orphans", level: "warn", businessId });
    else result.orphans += orphans.length;
  }
  return result;
}
