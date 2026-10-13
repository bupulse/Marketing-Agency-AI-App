// Storage clean-up for content videos (docs/CONTENT_VISUALS.md): a video file is deleted 30 days after the last post
// that used it was published. The posts and the ContentVisual stay; the visual says the video was removed. Videos no
// post has used yet are kept. Run daily by /api/cron/media-cleanup.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { readItems, WAITING_STATUSES } from "./service";

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
    const rows: { id: string; businessId: string; items: Prisma.JsonValue; bytes: number }[] = await prisma.contentVisual.findMany({
      where: { kind: "video", bytes: { gt: 0 }, renderedAt: { lte: cutoff }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, businessId: true, items: true, bytes: true },
    });
    if (rows.length === 0) return result;
    for (const row of rows) {
      cursor = row.id;
      result.checked += 1;
      const paths = readItems(row.items).map((i) => i.path);
      if (paths.length === 0) continue;
      const posts = await prisma.post.findMany({ where: { businessId: row.businessId, mediaPaths: { hasSome: paths } }, select: { status: true, publishedAt: true } });
      if (!videoExpired(posts, now)) continue;
      const { error } = await createAdminClient().storage.from("media").remove(paths);
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
