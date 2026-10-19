import "server-only";
import { prisma } from "@/lib/db";
import { deleteAssets } from "@/lib/media/service";
import { bucketForPath } from "@/lib/publishing/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { readItems } from "@/lib/visuals/service";
import { scheduledPostsOf } from "@/lib/video-studio/schedule";

// BuPulse's Videos library (docs/VIDEO_STUDIO_SPLIT.md): every video the system made for the company, in one list.
//   studio     a Video Studio job that is "ready" (made on studio.bupulse.com, or by Autopilot): its MP4 is a Gallery
//              file in the "Video Studio" folder, so it can be scheduled and deleted here
//   slideshow  a content video (lib/visuals, a ContentVisual of kind "video"): it belongs to its post, so it is managed
//              from that post
// Videos are made on the studio; nothing here makes one.

export const LIBRARY_SHOWN = 60;
const URL_SECONDS = 60 * 60;

export type LibrarySource = "studio" | "slideshow";

export type LibraryVideo = {
  /** "studio:<job id>" or "slideshow:<visual id>". */
  key: string;
  id: string;
  source: LibrarySource;
  title: string;
  /** "motion" | "premium3d" | "seedance" for studio videos. */
  engine: string | null;
  ratio: string;
  durationMs: number | null;
  createdAt: string;
  videoUrl: string;
  downloadUrl: string | null;
  posterUrl: string | null;
  caption: string;
  /** Studio videos not opened in the library yet. */
  isNew: boolean;
  posts: { count: number; next: string | null };
  /** Where a slideshow video is managed (its post's page). */
  postHref: string | null;
};

/** Signed links for paths in any of the media buckets: to play, and (with `download`) to save the file. */
async function sign(paths: string[], download: boolean): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byBucket = new Map<string, string[]>();
  for (const p of new Set(paths)) byBucket.set(bucketForPath(p), [...(byBucket.get(bucketForPath(p)) ?? []), p]);
  // Every path here is read off the company's own rows, so the server signs them (the gallery-videos bucket has no
  // Storage policies at all).
  const storage = createAdminClient().storage;
  await Promise.all(
    [...byBucket].map(async ([bucket, list]) => {
      const { data } = await storage.from(bucket).createSignedUrls(list, URL_SECONDS, download ? { download: true } : undefined);
      for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
    }),
  );
  return out;
}

const contentHref = (c: { productId: string | null; campaignId: string | null } | null) =>
  c?.productId ? `/dashboard/content/products/${c.productId}` : c?.campaignId ? `/dashboard/content/campaigns/${c.campaignId}` : "/dashboard/content";

/** The company's videos, newest first. `source` narrows the list. */
export async function listLibraryVideos(businessId: string, opts: { source?: LibrarySource | null; limit?: number } = {}): Promise<LibraryVideo[]> {
  const limit = opts.limit ?? LIBRARY_SHOWN;
  const [jobs, visuals] = await Promise.all([
    opts.source === "slideshow"
      ? []
      : prisma.videoJob.findMany({
          where: { businessId, status: "ready", videoPath: { not: null } },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, engine: true, ratio: true, durationMs: true, createdAt: true, videoPath: true, posterPath: true, caption: true, seenAt: true, product: { select: { name: true } } },
        }),
    opts.source === "studio"
      ? []
      : prisma.contentVisual.findMany({
          where: { businessId, kind: "video", status: "ready" },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, items: true, seconds: true, createdAt: true, content: { select: { caption: true, productId: true, campaignId: true, product: { select: { name: true } } } } },
        }),
  ]);

  const slides = visuals.flatMap((v) => {
    const path = readItems(v.items)[0]?.path;
    return path ? [{ v, path }] : [];
  });
  const studioPaths = jobs.map((j) => j.videoPath!);
  const allPaths = [...studioPaths, ...slides.map((s) => s.path)];
  const [play, save, posts] = await Promise.all([
    sign([...allPaths, ...jobs.flatMap((j) => (j.posterPath ? [j.posterPath] : []))], false),
    sign(allPaths, true),
    scheduledPostsOf(businessId, allPaths),
  ]);
  const postsOf = (path: string) => {
    const p = posts.get(path);
    return p ? { count: p.count, next: p.next?.toISOString() ?? null } : { count: 0, next: null };
  };

  const out: LibraryVideo[] = [
    ...jobs.flatMap((j): LibraryVideo[] => {
      const url = play.get(j.videoPath!);
      if (!url) return [];
      return [
        {
          key: `studio:${j.id}`,
          id: j.id,
          source: "studio",
          title: j.product?.name ?? "Studio video",
          engine: j.engine,
          ratio: j.ratio,
          durationMs: j.durationMs,
          createdAt: j.createdAt.toISOString(),
          videoUrl: url,
          downloadUrl: save.get(j.videoPath!) ?? null,
          posterUrl: j.posterPath ? (play.get(j.posterPath) ?? null) : null,
          caption: j.caption,
          isNew: !j.seenAt,
          posts: postsOf(j.videoPath!),
          postHref: null,
        },
      ];
    }),
    ...slides.flatMap(({ v, path }): LibraryVideo[] => {
      const url = play.get(path);
      if (!url) return [];
      return [
        {
          key: `slideshow:${v.id}`,
          id: v.id,
          source: "slideshow",
          title: v.content?.product?.name ?? "Post video",
          engine: null,
          ratio: "9:16",
          durationMs: v.seconds ? v.seconds * 1000 : null,
          createdAt: v.createdAt.toISOString(),
          videoUrl: url,
          downloadUrl: save.get(path) ?? null,
          posterUrl: null,
          caption: v.content?.caption ?? "",
          isNew: false,
          posts: postsOf(path),
          postHref: contentHref(v.content),
        },
      ];
    }),
  ];
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Ready studio videos the company has not opened in the library yet (the bell), at most `max` counted. */
export async function unseenStudioVideos(businessId: string, max = 20): Promise<number> {
  const rows = await prisma.videoJob.findMany({ where: { businessId, status: "ready", videoPath: { not: null }, seenAt: null }, select: { id: true }, take: max });
  return rows.length;
}

/** Marks these studio videos as seen (the library was opened on them). */
export async function markStudioVideosSeen(businessId: string, ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await prisma.videoJob.updateMany({ where: { businessId, id: { in: ids }, seenAt: null }, data: { seenAt: now } });
}

export class LibraryError extends Error {}

/**
 * Deletes a studio video: its Gallery file (and poster) and the job's link to it. Refused while a post that has not
 * gone out yet uses it, so nothing scheduled loses its video.
 */
export async function deleteStudioVideo(businessId: string, jobId: string): Promise<void> {
  const job = await prisma.videoJob.findFirst({ where: { id: jobId, businessId, status: "ready" }, select: { id: true, videoPath: true } });
  if (!job?.videoPath) throw new LibraryError("That video is already gone.");
  const waiting = await prisma.post.count({ where: { businessId, mediaPaths: { has: job.videoPath }, status: { in: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PUBLISHING"] } } });
  if (waiting > 0) throw new LibraryError(`This video is in ${waiting} ${waiting === 1 ? "post" : "posts"} that ${waiting === 1 ? "has" : "have"} not gone out yet. Remove it from ${waiting === 1 ? "that post" : "those posts"} in the Calendar first.`);
  const asset = await prisma.mediaAsset.findFirst({ where: { businessId, path: job.videoPath }, select: { id: true } });
  if (asset) await deleteAssets(businessId, [asset.id]);
  await prisma.videoJob.update({ where: { id: job.id }, data: { status: "cancelled", videoPath: null, posterPath: null, bytes: 0 } });
}
