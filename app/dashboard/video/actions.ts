"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { MediaError } from "@/lib/media/service";
import { PUBLISHING_LIMITS } from "@/lib/publishing/limits";
import { PublishingError } from "@/lib/publishing/service";
import { rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import type { Network } from "@/lib/social/types";
import { ForbiddenError } from "@/lib/team/roles";
import { deleteStudioVideo, LibraryError, listLibraryVideos, type LibrarySource, type LibraryVideo } from "@/lib/video-library/service";
import { VideoStudioError } from "@/lib/video-studio/jobs";
import { scheduleJob, scheduleOptions, STUDIO_NETWORKS, type ScheduleOptions } from "@/lib/video-studio/schedule";

// The Videos library (docs/VIDEO_STUDIO_SPLIT.md). Videos are made on the Video Studio (studio.bupulse.com); here the
// company schedules and deletes them. Each action works inside the signed-in person's company, with the `content`
// permission; scheduling also needs the calendar in the plan.

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
type Ctx = { userId: string; businessId: string; actorId: string };

const FAILED = "Something went wrong. Please try again.";
const id = z.string().min(1).max(40);

async function library<T extends object>(source: string, fn: (ctx: Ctx) => Promise<T>): Promise<Result<T>> {
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
    return { ok: true, ...(await fn({ userId: user.id, businessId: business.id, actorId: user.actorId })) };
  } catch (error) {
    if (error instanceof VideoStudioError || error instanceof LibraryError || error instanceof MediaError || error instanceof PublishingError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source, userId: user.id });
    return { ok: false, error: FAILED };
  }
}

/** The library again (after a delete, or when the studio finished something while the page was open). */
export async function loadLibrary(source: LibrarySource | null = null): Promise<Result<{ videos: LibraryVideo[] }>> {
  const s = source === "studio" || source === "slideshow" ? source : null;
  return library("video.library", async ({ businessId }) => ({ videos: await listLibraryVideos(businessId, { source: s }) }));
}

/** Scheduling also needs the calendar (posting) in the plan. */
async function needCalendar(businessId: string) {
  const missing = await featureBlocked(businessId, "calendar");
  if (missing) throw new VideoStudioError(missing, "invalid", 403);
}

/** The accounts a studio video can go to and each network's caption with its check. */
export async function loadScheduleOptions(jobId: string): Promise<Result<ScheduleOptions>> {
  if (!id.safeParse(jobId).success) return { ok: false, error: "We could not find that video." };
  return library("video.schedule.options", async ({ businessId }) => {
    await needCalendar(businessId);
    return scheduleOptions(businessId, jobId);
  });
}

const network = z.enum(STUDIO_NETWORKS as [Network, ...Network[]]);
const scheduleSchema = z.object({
  connectionIds: z.array(z.string().min(1).max(60)).min(1, "Choose at least one account.").max(10),
  when: z.discriminatedUnion("mode", [z.object({ mode: z.literal("queue") }), z.object({ mode: z.literal("schedule"), local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) })]),
  captions: z.partialRecord(network, z.object({ text: z.string().max(5000), hashtags: z.array(z.string().max(100)).max(30) })).optional(),
});

/** Schedules a studio video on the chosen accounts, one post each, every caption checked first. */
export async function scheduleStudioVideo(jobId: string, input: z.input<typeof scheduleSchema>): Promise<Result<{ postIds: string[]; scheduledAt: string | null }>> {
  const parsed = scheduleSchema.safeParse(input);
  if (!id.safeParse(jobId).success || !parsed.success) return { ok: false, error: parsed.success ? "We could not find that video." : (parsed.error.issues[0]?.message ?? "Check the accounts and the time.") };
  const out = await library("video.schedule", async ({ userId, businessId, actorId }) => {
    await needCalendar(businessId);
    await rateLimit(`publishing:compose:${userId}`, PUBLISHING_LIMITS.compose);
    const created = await scheduleJob({ businessId, userId, actorId }, jobId, parsed.data);
    return { postIds: created.postIds, scheduledAt: created.scheduledAt?.toISOString() ?? null };
  });
  if (out.ok) revalidatePath("/dashboard/calendar");
  return out;
}

/** Deletes a studio video (refused while a post that has not gone out uses it). */
export async function deleteLibraryVideo(jobId: string): Promise<Result> {
  if (!id.safeParse(jobId).success) return { ok: false, error: "We could not find that video." };
  const out = await library("video.delete", async ({ businessId }) => {
    await deleteStudioVideo(businessId, jobId);
    return {};
  });
  if (out.ok) revalidatePath("/dashboard/gallery");
  return out;
}
