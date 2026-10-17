import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { activeTracks } from "@/lib/music/service";
import { isOwnedLicence } from "@/lib/music/tracks";
import { createFolder, finalizeUpload, MediaError, prepareUploads, signedUrls, type MediaItem, type UploadTarget } from "@/lib/media/service";
import { suggestHooks, type HookSuggestion } from "@/lib/video-engine/brain/suggest";
import type { Platform } from "@/lib/video-engine/designer";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { loadBriefFacts, type StoredPhoto } from "./brief";
import { view, VideoStudioError, type VideoJobView } from "./jobs";

// The Create page's side of the Video Studio (docs/VIDEO_APP_INTEGRATION.md, task 6): the job list, the Brain's
// opening lines, what the browser needs to draw a design, and the finished MP4 saved into the Gallery. The MP4 goes
// through the Gallery's own upload (prepareUploads / finalizeUpload, lib/media/service.ts), so its checks apply as they
// are: file type and size read from the file, the media quota, the company's video cap and the poster. It lands in the
// "Video Studio" folder, and the job keeps its path.

export const STUDIO_FOLDER = "Video Studio";
/** Jobs shown on the Create page, newest first. */
export const STUDIO_JOBS_SHOWN = 20;

type Ctx = { userId: string; businessId: string };

export type StudioJob = VideoJobView & { videoUrl: string | null; posterUrl: string | null };

const JOB_SELECT = { id: true, status: true, engine: true, spec: true, caption: true, hashtags: true, warnings: true, score: true, captionScore: true, credits: true, error: true, parentId: true, productId: true, templateId: true, platform: true, ratio: true, seconds: true, videoPath: true, posterPath: true, brief: true, music: true, createdAt: true } as const;

/** The company's latest Motion jobs, with signed links to the MP4s already made. */
export async function listStudioJobs(businessId: string, limit = STUDIO_JOBS_SHOWN): Promise<StudioJob[]> {
  const rows = await prisma.videoJob.findMany({ where: { businessId, engine: "motion" }, orderBy: { createdAt: "desc" }, take: limit, select: JOB_SELECT });
  const urls = await signedUrls(rows.flatMap((r) => [r.videoPath, r.posterPath].filter((p): p is string => !!p)));
  return rows.map((r) => ({ ...view(r), videoUrl: r.videoPath ? (urls.get(r.videoPath) ?? null) : null, posterUrl: r.posterPath ? (urls.get(r.posterPath) ?? null) : null }));
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

async function designedJob(businessId: string, jobId: string) {
  const job = await prisma.videoJob.findFirst({ where: { id: jobId, businessId, engine: "motion" }, select: { id: true, status: true, spec: true, brief: true, productId: true } });
  if (!job?.spec || (job.status !== "designed" && job.status !== "ready")) throw new VideoStudioError("That video is not ready to be made yet.", "not_found", 404);
  return job;
}

/**
 * What the browser needs to draw a design: the spec, and signed links to its photos (1-based, the order the designer
 * saw them) and their cut-outs (null where there is none).
 */
export async function jobForDrawing(businessId: string, jobId: string): Promise<{ spec: MotionSpec; photoUrls: string[]; cutoutUrls: (string | null)[] }> {
  const job = await designedJob(businessId, jobId);
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
async function studioFolder(businessId: string): Promise<string> {
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
  await designedJob(ctx.businessId, jobId);
  const destination = await studioFolder(ctx.businessId);
  const [target] = await prepareUploads(ctx, [{ name: `video-${jobId}.mp4`, type: "video/mp4", size: file.bytes }], destination);
  if (!target?.ok) throw new MediaError(target?.error ?? "The video could not be saved. Please try again.");
  return { target, destination };
}

/**
 * Confirms the uploaded MP4 (the Gallery's checks) and puts it on the job, which becomes "ready". Making the MP4 again
 * replaces the job's video; the earlier file stays in the Gallery.
 */
export async function saveJobVideo(ctx: Ctx, jobId: string, input: { path: string; destination: string; name: string; width: number | null; height: number | null; musicTrackId?: string | null }): Promise<{ item: MediaItem; job: StudioJob }> {
  await designedJob(ctx.businessId, jobId);
  // The track the browser mixed in, read from the library (not the browser's word), for its credit line on the posts.
  const track = input.musicTrackId ? await prisma.musicTrack.findUnique({ where: { id: input.musicTrackId }, select: { id: true, title: true, attribution: true, licence: true } }) : null;
  const music = track ? { trackId: track.id, title: track.title, attribution: track.attribution, owned: isOwnedLicence(track.licence) } : null;
  const item = await finalizeUpload(ctx, { path: input.path, name: input.name, destination: input.destination, width: input.width, height: input.height });
  if (item.kind !== "video") throw new MediaError("That file is not a video.");
  const row = await prisma.videoJob.update({
    where: { id: jobId },
    data: { status: "ready", videoPath: item.path, posterPath: item.posterPath, bytes: item.bytes, durationMs: item.durationMs, music: music ?? Prisma.DbNull },
    select: JOB_SELECT,
  });
  return { item, job: { ...view(row), videoUrl: item.url, posterUrl: item.posterUrl } };
}
