import "server-only";
import { prisma } from "@/lib/db";
import { finalizeUpload, MediaError, prepareUploads, type UploadTarget } from "@/lib/media/service";
import { fileProblem, inferMimeType, isOwnGalleryVideoPath, isVideoType } from "@/lib/media/rules";
import { studioFolder } from "@/lib/video-studio/library";
import { LibraryError, libraryVideoOfJob, type LibraryVideo } from "./service";
import { ratioFor, UPLOAD_ENGINE, UPLOAD_FOLDER, UPLOAD_PICK_MAX, UPLOAD_TITLE_MAX } from "./upload-rules";

// "Upload a video" on the Videos page: the company's own finished videos (an ad made elsewhere, a phone clip) into its
// Videos library. The file goes through the Gallery's own video upload (prepareUploads / finalizeUpload,
// lib/media/service.ts), so every check of a Gallery video applies as it is: MP4, MOV or WebM read from the file's own
// first bytes, at most 50 MB (the gallery-videos bucket's and Supabase's free plan's limit) and the size it was started
// with, at most 60 seconds read from the file, the media quota (500 files, 2 GB) and the company's video cap
// (MEDIA_COMPANY_VIDEO_MAX_BYTES, 100 MB by default), and the poster frame. The browser uploads straight to Storage with
// the server's signed upload token (the server never carries the file). Once the Gallery has confirmed the file, a
// VideoJob of engine "upload" is made, "ready" and already seen (no "Your video is ready" email, no bell), so the video
// is in the library like a studio video: watched, downloaded, scheduled, deleted. It uses no credits.

type Ctx = { userId: string; businessId: string; actorId: string };
type File = { name: string; type: string; size: number };

/** One picked file's upload: where it goes (and its poster), or why it cannot go. Lines up with the files sent. */
export type VideoUploadSlot = { ok: true; path: string; token: string; poster: { path: string; token: string } | null } | { ok: false; error: string };

/** Why a picked file cannot be an uploaded video, or null. Only videos here (photos go to the Gallery). */
export function videoFileProblem(file: File): string | null {
  if (!isVideoType(inferMimeType(file.name, file.type))) return `${file.name}: use an MP4, MOV or WebM video.`;
  return fileProblem(file);
}

/**
 * Checks the picked videos (type, size, the quotas, the company's video cap) and gives each one that passes a signed
 * upload (and one for its poster), in the "Uploaded videos" folder. A file that does not pass gets its reason.
 */
export async function startVideoUploads(ctx: Ctx, files: File[]): Promise<VideoUploadSlot[]> {
  if (files.length === 0 || files.length > UPLOAD_PICK_MAX) throw new LibraryError(`Pick up to ${UPLOAD_PICK_MAX} videos at a time.`);
  const problems = files.map(videoFileProblem);
  const passing = files.filter((_, i) => !problems[i]);
  let targets: UploadTarget[] = [];
  if (passing.length) {
    const destination = await studioFolder(ctx.businessId, UPLOAD_FOLDER);
    targets = await prepareUploads(ctx, passing, destination);
  }
  let next = 0;
  return files.map((file, i): VideoUploadSlot => {
    if (problems[i]) return { ok: false, error: problems[i]! };
    const t = targets[next++];
    if (!t) return { ok: false, error: `${file.name} could not be started. Please try again.` };
    return t.ok ? { ok: true, path: t.path, token: t.token, poster: t.poster ?? null } : { ok: false, error: t.error };
  });
}

export type FinishInput = { path: string; title: string; productId: string | null; width: number | null; height: number | null };

/**
 * Confirms an uploaded video (the Gallery's checks: the object exists, its size, its real type and length, the quotas;
 * a file that fails is removed from Storage) and puts it in the library: a VideoJob of engine "upload", ready, with the
 * title as its caption, the ratio from the video's size and the length read from the file. A retry after a lost
 * answer gives back the same video.
 */
export async function finishVideoUpload(ctx: Ctx, input: FinishInput): Promise<LibraryVideo> {
  const { businessId } = ctx;
  if (!isOwnGalleryVideoPath(ctx.userId, input.path)) throw new LibraryError("That upload could not be used.");
  const title = input.title.trim().slice(0, UPLOAD_TITLE_MAX);
  const product = input.productId ? await prisma.product.findFirst({ where: { id: input.productId, businessId }, select: { id: true } }) : null;
  if (input.productId && !product) throw new LibraryError("We could not find that product.");

  const made = await prisma.videoJob.findFirst({ where: { businessId, engine: UPLOAD_ENGINE, videoPath: input.path, status: "ready" }, select: { id: true } });
  if (made) {
    const again = await libraryVideoOfJob(businessId, made.id);
    if (!again) throw new LibraryError("That video is already gone.");
    return again;
  }

  const destination = await studioFolder(businessId, UPLOAD_FOLDER);
  const item = await finalizeUpload(ctx, { path: input.path, name: title || "Video", destination, width: input.width, height: input.height });
  if (item.kind !== "video" || !item.durationMs) throw new MediaError("That file is not a video.");

  const job = await prisma.videoJob.create({
    data: {
      businessId,
      userId: ctx.actorId,
      productId: product?.id ?? null,
      engine: UPLOAD_ENGINE,
      status: "ready",
      ratio: ratioFor(item.width, item.height),
      seconds: Math.max(1, Math.round(item.durationMs / 1000)),
      brief: { upload: { name: item.name } },
      caption: title,
      videoPath: item.path,
      posterPath: item.posterPath,
      bytes: item.bytes,
      durationMs: item.durationMs,
      credits: 0,
      // The company's own video: nothing to tell them about.
      seenAt: new Date(),
      readyNoticeAt: new Date(),
    },
    select: { id: true },
  });
  const video = await libraryVideoOfJob(businessId, job.id);
  if (!video) throw new LibraryError("The video was saved but could not be shown. Refresh the page.");
  return video;
}
