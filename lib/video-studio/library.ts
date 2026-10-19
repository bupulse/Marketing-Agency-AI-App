import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { activeTracks } from "@/lib/music/service";
import { isOwnedLicence } from "@/lib/music/tracks";
import { consumeDailyVideo, consumeUsage, getUsageSummary, refundDailyVideo, refundUsage, UsageLimitError } from "@/lib/usage";
import { createFolder, finalizeUpload, MediaError, prepareUploads, signedUrls, type MediaItem, type UploadTarget } from "@/lib/media/service";
import { suggestHooks, type HookSuggestion } from "@/lib/video-engine/brain/suggest";
import type { Platform } from "@/lib/video-engine/designer";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { loadBriefFacts, type StoredPhoto } from "./brief";
import { view, VideoStudioError, type VideoJobView } from "./jobs";
import { scheduledPostsOf } from "./schedule";

// The Create page's side of the Video Studio (docs/VIDEO_APP_INTEGRATION.md, task 6): the job list, the Brain's
// opening lines, what the browser needs to draw a design, and the finished MP4 saved into the Gallery. The MP4 goes
// through the Gallery's own upload (prepareUploads / finalizeUpload, lib/media/service.ts), so its checks apply as they
// are: file type and size read from the file, the media quota, the company's video cap and the poster. It lands in the
// "Video Studio" folder, and the job keeps its path. A job's first MP4 also uses one of the plan's videos (the month's
// and the day's, as a content video does); making it again uses none. The cap is checked before the browser encodes.

export const STUDIO_FOLDER = "Video Studio";
/** Jobs shown on the Create page, newest first. */
export const STUDIO_JOBS_SHOWN = 20;

type Ctx = { userId: string; businessId: string };

export type StudioJob = VideoJobView & {
  videoUrl: string | null;
  posterUrl: string | null;
  /** Posts made from its MP4 (not cancelled), and when the next scheduled one goes out (ISO). */
  posts: { count: number; next: string | null };
};

const NO_POSTS = { count: 0, next: null };

const JOB_SELECT = { id: true, status: true, engine: true, spec: true, caption: true, hashtags: true, warnings: true, score: true, captionScore: true, credits: true, error: true, parentId: true, productId: true, templateId: true, platform: true, ratio: true, seconds: true, videoPath: true, posterPath: true, brief: true, music: true, createdAt: true } as const;

/** The company's latest Motion jobs, with signed links to the MP4s already made. */
export async function listStudioJobs(businessId: string, limit = STUDIO_JOBS_SHOWN): Promise<StudioJob[]> {
  const rows = await prisma.videoJob.findMany({ where: { businessId, engine: "motion" }, orderBy: { createdAt: "desc" }, take: limit, select: JOB_SELECT });
  const videos = rows.flatMap((r) => (r.videoPath ? [r.videoPath] : []));
  const [urls, posts] = await Promise.all([signedUrls(rows.flatMap((r) => [r.videoPath, r.posterPath].filter((p): p is string => !!p))), scheduledPostsOf(businessId, videos)]);
  return rows.map((r) => {
    const p = r.videoPath ? posts.get(r.videoPath) : null;
    return { ...view(r), videoUrl: r.videoPath ? (urls.get(r.videoPath) ?? null) : null, posterUrl: r.posterPath ? (urls.get(r.posterPath) ?? null) : null, posts: p ? { count: p.count, next: p.next?.toISOString() ?? null } : NO_POSTS };
  });
}

/** A music track the owner can put under an MP4: the library's public file, mixed in the browser (free). */
export type StudioTrack = { id: string; title: string; moods: string[]; url: string; attribution: string | null };

/** The library's active tracks; empty when the library is empty or cannot be read (MP4s are then made without music). */
export async function studioTracks(): Promise<StudioTrack[]> {
  const tracks = await activeTracks().catch(() => []);
  return tracks.map((t) => ({ id: t.id, title: t.title, moods: t.moods, url: t.url, attribution: isOwnedLicence(t.licence) ? null : t.attribution || null }));
}

/** The Brain's three opening lines for this product, template, length and platform (pure, free). */
export async function openingLines(businessId: string, input: { productId: string; templateId: string; seconds: number; platform: Platform | null }): Promise<HookSuggestion[]> {
  const facts = await loadBriefFacts(businessId, input.productId);
  // The Brain calls YouTube Shorts "shorts".
  return suggestHooks({ business: facts.business, product: facts.product, styleId: input.templateId, seconds: input.seconds }, { platform: input.platform === "youtube" ? "shorts" : (input.platform ?? "any") });
}

/** The engines whose MP4 is saved here: Motion (made in the browser), and the clips made by a provider or a renderer. */
export type SavedEngine = "motion" | "seedance" | "premium3d";
/** The statuses a provider's or renderer's job is saved in, while its MP4 is being finalised (or saved again). */
const SAVING: Record<Exclude<SavedEngine, "motion">, string[]> = { seedance: ["submitted", "queued", "running", "ready"], premium3d: ["rendering", "ready"] };

async function designedJob(businessId: string, jobId: string, engine: SavedEngine = "motion") {
  const job = await prisma.videoJob.findFirst({ where: { id: jobId, businessId, engine }, select: { id: true, status: true, spec: true, brief: true, productId: true, videoPath: true } });
  // A Seedance or Premium 3D clip has no Motion design: it is saved while its task or render is finishing
  // (lib/video-studio/seedance-jobs.ts, premium-jobs.ts).
  const ready = engine === "motion" ? !!job?.spec && (job.status === "designed" || job.status === "ready") : SAVING[engine].includes(job?.status ?? "");
  if (!job || !ready) throw new VideoStudioError("That video is not ready to be made yet.", "not_found", 404);
  return job;
}

/** Why no new video can be saved right now (the month's or the day's videos used up), or null. Shown as it is. */
export function studioCapMessage(a: { monthLeft: number; monthly: number; perDay: number; today: number }): string | null {
  if (a.monthLeft <= 0) return `Your plan's ${a.monthly} videos for this month are used up, so this MP4 cannot be made yet. Your design is kept: make it next month, or add more video to your plan.`;
  if (a.today >= a.perDay) return `${a.perDay} ${a.perDay === 1 ? "video" : "videos"} a day is the most, and today's are made. Your design is kept: make this MP4 tomorrow.`;
  return null;
}

/** Throws the plain cap message when a job's first MP4 could not be counted now (a remake is never refused). */
async function assertVideoRoom(userId: string, first: boolean): Promise<void> {
  if (!first) return;
  const usage = await getUsageSummary(userId);
  const cap = studioCapMessage({ monthLeft: Math.max(0, usage.limits.videos - usage.used.videos), monthly: usage.limits.videos, perDay: usage.videosPerDay, today: usage.videosToday });
  if (cap) throw new VideoStudioError(cap, "invalid", 402);
}

/**
 * What the browser needs to draw a design: the spec, and signed links to its photos (1-based, the order the designer
 * saw them) and their cut-outs (null where there is none).
 */
export async function jobForDrawing(ctx: Ctx, jobId: string, purpose: "preview" | "mp4" = "mp4"): Promise<{ spec: MotionSpec; photoUrls: string[]; cutoutUrls: (string | null)[] }> {
  const { businessId } = ctx;
  const job = await designedJob(businessId, jobId);
  // Before the browser spends a minute encoding: a first MP4 that the plan could not count is refused now. The live
  // preview is never refused (it saves nothing).
  if (purpose === "mp4") await assertVideoRoom(ctx.userId, !job.videoPath);
  const photos = ((job.brief as { photos?: StoredPhoto[] } | null)?.photos ?? []).map((p) => p.path);
  const assets = photos.length ? await prisma.mediaAsset.findMany({ where: { businessId, path: { in: photos } }, select: { path: true, cutoutPath: true } }) : [];
  const cutouts = new Map(assets.map((a) => [a.path, a.cutoutPath]));
  const urls = await signedUrls([...photos, ...assets.flatMap((a) => (a.cutoutPath ? [a.cutoutPath] : []))]);
  return {
    spec: job.spec as unknown as MotionSpec,
    photoUrls: photos.map((p) => urls.get(p) ?? ""),
    cutoutUrls: photos.map((p) => {
      const c = cutouts.get(p);
      return c ? (urls.get(c) ?? null) : null;
    }),
  };
}

/** The Gallery folder studio videos go to, made the first time. */
export async function studioFolder(businessId: string): Promise<string> {
  const found = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: STUDIO_FOLDER } }, select: { id: true } });
  if (found) return `folder:${found.id}`;
  try {
    return `folder:${(await createFolder(businessId, STUDIO_FOLDER)).id}`;
  } catch (error) {
    // Made by a parallel request in the meantime.
    const again = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: STUDIO_FOLDER } }, select: { id: true } });
    if (again) return `folder:${again.id}`;
    throw error;
  }
}

/** A signed upload for the MP4 the browser made of a design (and its poster), into the Gallery's studio folder. */
export async function prepareJobVideo(ctx: Ctx, jobId: string, file: { bytes: number }): Promise<{ target: Extract<UploadTarget, { ok: true }>; destination: string }> {
  const job = await designedJob(ctx.businessId, jobId);
  await assertVideoRoom(ctx.userId, !job.videoPath);
  const destination = await studioFolder(ctx.businessId);
  const [target] = await prepareUploads(ctx, [{ name: `video-${jobId}.mp4`, type: "video/mp4", size: file.bytes }], destination);
  if (!target?.ok) throw new MediaError(target?.error ?? "The video could not be saved. Please try again.");
  return { target, destination };
}

/**
 * Confirms the uploaded MP4 (the Gallery's checks) and puts it on the job, which becomes "ready". Making the MP4 again
 * replaces the job's video; the earlier file stays in the Gallery. `engine` "seedance" or "premium3d": a finished clip,
 * already paid for in video credits, so it does not use one of the plan's videos.
 */
export async function saveJobVideo(ctx: Ctx, jobId: string, input: { path: string; destination: string; name: string; width: number | null; height: number | null; musicTrackId?: string | null }, opts: { engine?: SavedEngine } = {}): Promise<{ item: MediaItem; job: StudioJob }> {
  const engine = opts.engine ?? "motion";
  const job = await designedJob(ctx.businessId, jobId, engine);
  // The track the browser mixed in, read from the library (not the browser's word), for its credit line on the posts.
  const track = input.musicTrackId ? await prisma.musicTrack.findUnique({ where: { id: input.musicTrackId }, select: { id: true, title: true, attribution: true, licence: true } }) : null;
  const music = track ? { trackId: track.id, title: track.title, attribution: track.attribution, owned: isOwnedLicence(track.licence) } : null;
  // A first MP4 uses one of the month's videos and one of the day's, counted before the file is confirmed and given
  // back if it is not (or if a parallel save of the same job got there first).
  let counted: { periodStart: Date; day: string | null } | null = null;
  const uncount = async () => {
    if (!counted) return;
    await refundUsage(ctx.userId, "videos", counted.periodStart, 1).catch(() => {});
    if (counted.day) await refundDailyVideo(ctx.userId, counted.day).catch(() => {});
    counted = null;
  };
  if (!job.videoPath && engine === "motion") {
    try {
      counted = { ...(await consumeUsage(ctx.userId, "videos", 1)), day: null };
      counted.day = (await consumeDailyVideo(ctx.userId, (await getUsageSummary(ctx.userId)).videosPerDay)).day;
    } catch (error) {
      await uncount();
      if (error instanceof UsageLimitError) {
        await assertVideoRoom(ctx.userId, true);
        throw new VideoStudioError("Your plan's videos are used up for now. Your design is kept: make the MP4 later.", "invalid", 402);
      }
      throw error;
    }
  }
  let item: MediaItem;
  try {
    item = await finalizeUpload(ctx, { path: input.path, name: input.name, destination: input.destination, width: input.width, height: input.height });
    if (item.kind !== "video") throw new MediaError("That file is not a video.");
  } catch (error) {
    await uncount();
    throw error;
  }
  const data = { status: "ready", videoPath: item.path, posterPath: item.posterPath, bytes: item.bytes, durationMs: item.durationMs, music: music ?? Prisma.DbNull };
  if (counted) {
    const { count } = await prisma.videoJob.updateMany({ where: { id: jobId, videoPath: null }, data });
    if (count === 0) await uncount();
  }
  const row = await prisma.videoJob.update({ where: { id: jobId }, data, select: JOB_SELECT });
  const posts = (await scheduledPostsOf(ctx.businessId, [item.path])).get(item.path);
  return { item, job: { ...view(row), videoUrl: item.url, posterUrl: item.posterUrl, posts: posts ? { count: posts.count, next: posts.next?.toISOString() ?? null } : NO_POSTS } };
}
