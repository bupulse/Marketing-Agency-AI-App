"use server";

import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { MediaError, type MediaItem, type UploadTarget } from "@/lib/media/service";
import { RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { ForbiddenError } from "@/lib/team/roles";
import type { HookSuggestion } from "@/lib/video-engine/brain/suggest";
import { PLATFORMS } from "@/lib/video-engine/designer";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { BriefError } from "@/lib/video-studio/brief";
import { VideoStudioError } from "@/lib/video-studio/jobs";
import { jobForDrawing, listStudioJobs, openingLines, prepareJobVideo, saveJobVideo, type StudioJob } from "@/lib/video-studio/library";

// The Create page (docs/VIDEO_APP_INTEGRATION.md, task 6). Designing itself is POST /api/video/design (it runs up to
// 300 s); these are the free, quick steps around it. Each works inside the signed-in person's company, with the
// `content` permission and the videoStudio feature.

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
type Ctx = { userId: string; businessId: string };

const FAILED = "Something went wrong. Please try again.";
const id = z.string().min(1).max(40);

async function studio<T extends object>(source: string, fn: (ctx: Ctx) => Promise<T>): Promise<Result<T>> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("content", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return { ok: false, error: "Set up your business first." };
    const missing = await featureBlocked(business.id, "videoStudio");
    if (missing) return { ok: false, error: missing };
    return { ok: true, ...(await fn({ userId: user.id, businessId: business.id })) };
  } catch (error) {
    if (error instanceof VideoStudioError || error instanceof BriefError || error instanceof MediaError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source, userId: user.id });
    return { ok: false, error: FAILED };
  }
}

/** The latest Motion videos (after a design, or to see a finished MP4). */
export async function loadStudioJobs(): Promise<Result<{ jobs: StudioJob[] }>> {
  return studio("video.jobs", async ({ businessId }) => ({ jobs: await listStudioJobs(businessId) }));
}

const linesSchema = z.object({
  productId: id,
  templateId: z.string().min(1).max(40),
  seconds: z.number().int().min(4).max(30),
  platform: z.enum(Object.keys(PLATFORMS) as [keyof typeof PLATFORMS, ...(keyof typeof PLATFORMS)[]]).nullable(),
});

/** The Brain's opening lines for the current choices (free). */
export async function loadOpeningLines(input: z.input<typeof linesSchema>): Promise<Result<{ lines: HookSuggestion[] }>> {
  const parsed = linesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a product first." };
  return studio("video.lines", async ({ businessId }) => ({ lines: await openingLines(businessId, parsed.data) }));
}

/** The spec and photo links the browser draws the MP4 from. */
export async function loadJobForDrawing(jobId: string): Promise<Result<{ spec: MotionSpec; photoUrls: string[]; cutoutUrls: (string | null)[] }>> {
  if (!id.safeParse(jobId).success) return { ok: false, error: "We could not find that video." };
  return studio("video.draw", (ctx) => jobForDrawing(ctx, jobId));
}

/** A signed upload for the MP4 made in this browser (the Gallery's checks: size, quota, video cap). */
export async function startJobVideoUpload(jobId: string, bytes: number): Promise<Result<{ target: Extract<UploadTarget, { ok: true }>; destination: string }>> {
  if (!id.safeParse(jobId).success || !Number.isSafeInteger(bytes) || bytes <= 0) return { ok: false, error: "That video could not be saved." };
  return studio("video.upload", (ctx) => prepareJobVideo(ctx, jobId, { bytes }));
}

const finishSchema = z.object({
  path: z.string().min(1).max(300),
  destination: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  musicTrackId: z.string().min(1).max(40).nullish(),
});

/** Confirms the uploaded MP4: it goes into the Gallery's "Video Studio" folder and the video is ready. */
export async function finishJobVideoUpload(jobId: string, input: z.input<typeof finishSchema>): Promise<Result<{ item: MediaItem; job: StudioJob }>> {
  const parsed = finishSchema.safeParse(input);
  if (!id.safeParse(jobId).success || !parsed.success) return { ok: false, error: "That video could not be saved." };
  return studio("video.finish", (ctx) => saveJobVideo(ctx, jobId, parsed.data));
}
