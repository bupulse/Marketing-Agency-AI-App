// Files in Storage that no row records are never counted toward a quota, so they are swept (docs/MEDIA.md): every
// company's gallery folder in "media", its Gallery videos in "gallery-videos", and any folder under its "media" folder
// that the app never writes (a browser may write its own folder directly), for the owner and every team member, nested
// folders included (bounded depth and pages). Lists are read page by page and compared
// with the database; only files older than an hour go (an upload may be on its way). Best effort, idempotent.
import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { GALLERY_VIDEO_BUCKET, posterPathFor } from "./rules";

const PAGE = 1000;
const ORPHAN_AGE_MS = 60 * 60 * 1000;
/** Folders the app writes under `<userId>/` in "media"; anything else there is not ours. */
const APP_FOLDERS = new Set(["gallery", "videos", "projects"]);
/** Statuses whose posts still need their files (they have not gone out). */
const WAITING = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING"] as const;

type Bucket = ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>;
type Entry = { path: string; createdAt: number | null; folder: boolean };

/** Every entry directly in `prefix`, page by page (files and sub-folders). */
export async function listAll(bucket: Bucket, prefix: string, maxPages = 50): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset: page * PAGE, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const o of data ?? []) out.push({ path: `${prefix}/${o.name}`, createdAt: o.created_at ? new Date(o.created_at).getTime() : null, folder: !o.id });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Folders are followed this deep below the starting folder, and at most this many list pages per tree. */
export const MAX_DEPTH = 4;
const MAX_TREE_PAGES = 200;

/** Every file under `prefix`, nested folders included (bounded: MAX_DEPTH levels, MAX_TREE_PAGES list pages). */
export async function listTree(bucket: Bucket, prefix: string, depth = MAX_DEPTH, budget = { pages: MAX_TREE_PAGES }): Promise<Entry[]> {
  if (budget.pages <= 0) return [];
  const entries = await listAll(bucket, prefix, Math.min(50, budget.pages));
  budget.pages -= Math.max(1, Math.ceil(entries.length / PAGE));
  const files = entries.filter((e) => !e.folder);
  if (depth <= 0) return files;
  for (const folder of entries.filter((e) => e.folder)) files.push(...(await listTree(bucket, folder.path, depth - 1, budget)));
  return files;
}

const old = (entries: Entry[], now: number) => entries.filter((e) => !e.folder && e.createdAt !== null && now - e.createdAt > ORPHAN_AGE_MS).map((e) => e.path);

/**
 * The paths among `paths` some row still needs: a photo or video (and its poster and Instagram copy), an open upload, a
 * waiting post, a link-in-bio copy.
 */
async function recorded(businessId: string, paths: string[], now: Date): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const bases = [...new Set(paths.map((p) => p.replace(/\.jpg$/, "")).concat(paths.map((p) => p.replace(/-poster\.jpg$/, ""))))];
  // The link-in-bio page's small copies (lib/bio/service.ts) live in <userId>/bio/, so only that folder needs the look-up.
  const bio = paths.filter((p) => p.includes("/bio/"));
  const [assets, reservations, posts, bioPages, bioItems] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { businessId, OR: [{ path: { in: [...paths, ...bases] } }, { posterPath: { in: paths } }] }, select: { path: true, posterPath: true } }),
    prisma.mediaUploadReservation.findMany({ where: { businessId, expiresAt: { gt: now }, path: { in: [...paths, ...bases] } }, select: { path: true } }),
    prisma.post.findMany({ where: { businessId, mediaPaths: { hasSome: paths }, status: { in: [...WAITING] } }, select: { mediaPaths: true } }),
    bio.length ? prisma.bioPage.findMany({ where: { businessId, logoPath: { in: bio } }, select: { logoPath: true } }) : [],
    bio.length ? prisma.bioPageItem.findMany({ where: { businessId, photoPath: { in: bio } }, select: { photoPath: true } }) : [],
  ]);
  const keep = new Set<string>();
  for (const a of assets) {
    keep.add(a.path);
    keep.add(`${a.path}.jpg`);
    if (a.posterPath) keep.add(a.posterPath);
  }
  for (const r of reservations) {
    keep.add(r.path);
    keep.add(posterPathFor(r.path));
  }
  for (const p of posts) for (const m of p.mediaPaths) keep.add(m);
  for (const p of [...bioPages.map((b) => b.logoPath), ...bioItems.map((i) => i.photoPath)]) if (p) keep.add(p);
  return keep;
}

async function removeAll(bucket: Bucket, paths: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await bucket.remove(paths.slice(i, i + PAGE));
    if (error) throw error;
    removed += Math.min(PAGE, paths.length - i);
  }
  return removed;
}

/**
 * One company's unrecorded files older than an hour: its gallery photos folder, its Gallery videos folder and (with
 * `strangers`) any folder under `<userId>/` in "media" the app never writes. Returns how many files went.
 */
export async function sweepCompanyFiles(userId: string, businessId: string, options: { strangers?: boolean; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const admin = createAdminClient().storage;
  const media = admin.from("media");
  const clips = admin.from(GALLERY_VIDEO_BUCKET);
  let removed = 0;
  for (const [bucket, folder] of [
    [media, `${userId}/gallery`],
    [clips, `${userId}/clips`],
  ] as const) {
    const candidates = old(await listTree(bucket, folder), now.getTime());
    const keep = await recorded(businessId, candidates, now);
    removed += await removeAll(bucket, candidates.filter((p) => !keep.has(p)));
  }
  if (options.strangers) {
    const top = await listAll(media, userId);
    const strange = [...old(top, now.getTime())];
    for (const entry of top.filter((e) => e.folder && !APP_FOLDERS.has(e.path.slice(userId.length + 1)))) {
      strange.push(...old(await listTree(media, entry.path), now.getTime()));
    }
    const keep = await recorded(businessId, strange, now);
    removed += await removeAll(media, strange.filter((p) => !keep.has(p)));
  }
  return removed;
}

export type StorageSweepResult = { companies: number; removed: number; reservations: number; failed: number; partial: boolean };

/**
 * The daily sweep (media-cleanup cron): expired Gallery video reservations go, then every company's folders are
 * compared with the database, a batch at a time, until the time budget is spent (the next run continues from the start;
 * work already done is not redone, since its files are gone).
 */
export async function sweepStorage(now = new Date(), budgetMs = 80_000): Promise<StorageSweepResult> {
  const started = Date.now();
  const result: StorageSweepResult = { companies: 0, removed: 0, reservations: 0, failed: 0, partial: false };
  result.reservations = (await prisma.mediaUploadReservation.deleteMany({ where: { expiresAt: { lte: now } } })).count;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.business.findMany({
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, userId: true, memberships: { select: { userId: true } } },
    });
    for (const business of batch) {
      if (Date.now() - started > budgetMs) {
        result.partial = true;
        return result;
      }
      try {
        // The owner's folder and every team member's own folder (the Storage policies let each write their own).
        for (const userId of new Set([business.userId, ...(business.memberships ?? []).map((m) => m.userId)])) {
          result.removed += await sweepCompanyFiles(userId, business.id, { strangers: true, now });
        }
        result.companies += 1;
      } catch (error) {
        result.failed += 1;
        await logError(error, { source: "media.storage-sweep", level: "warn", businessId: business.id });
      }
    }
    if (batch.length < 100) return result;
    cursor = batch[batch.length - 1].id;
  }
}
