// Delivery (docs/AD_BRAIN.md, section 3.9): the finished ad goes into the BuPulse company account's Gallery ("Ad Brain"
// folder), shows in its Videos library (a VideoJob of engine "adbrain"), and becomes posts "waiting for your OK" on the
// Posts page with the caption and hashtags. It never publishes and never auto-schedules: the owner approves each post.
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { createFolder, finalizeUpload, MediaError, prepareUploads } from "@/lib/media/service";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import { dayDate } from "@/lib/content-flow/day";
import { accountUsable } from "@/lib/publishing/service";
import { dayKey } from "@/lib/publishing/time";
import { pagesFirst } from "@/lib/social/choices";
import { isNetwork } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { mediaForPost } from "@/lib/visuals/post-media";

export const AD_FOLDER = "Ad Brain";
export const AD_ENGINE = "adbrain";
/** The networks a 9:16 ad goes to (the video apps); without connected accounts they wait as reminders. */
export const AD_NETWORKS: readonly Network[] = ["instagram", "facebook", "tiktok", "youtube"];

async function adFolder(businessId: string): Promise<string> {
  const found = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: AD_FOLDER } }, select: { id: true } });
  if (found) return `folder:${found.id}`;
  try {
    return `folder:${(await createFolder(businessId, AD_FOLDER)).id}`;
  } catch (error) {
    const again = await prisma.mediaFolder.findUnique({ where: { businessId_name: { businessId, name: AD_FOLDER } }, select: { id: true } });
    if (again) return `folder:${again.id}`;
    throw error;
  }
}

/** The caption with its hashtags, the way the posts carry them. */
export const cleanHashtags = (tags: string[]) => [...new Set(tags.map((t) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean))].slice(0, 10);

/**
 * Saves the MP4 into the Gallery and the Videos library, then (unless a hard rule was flagged) one post per video
 * network, waiting for approval. Returns where everything went.
 */
export type GalleryVideo = { path: string; posterPath: string | null; bytes: number; durationMs: number | null };

/** Step 1: the MP4 into the Gallery's "Ad Brain" folder (the Gallery's own checks and quota). The caller keeps the result, so a retry never uploads twice. */
export async function saveAdToGallery(input: { jobId: string; userId: string; businessId: string; bytes: Buffer; title: string }): Promise<GalleryVideo> {
  const ctx = { userId: input.userId, businessId: input.businessId };
  const destination = await adFolder(input.businessId);
  const [target] = await prepareUploads(ctx, [{ name: `ad-${input.jobId}.mp4`, type: "video/mp4", size: input.bytes.length }], destination);
  if (!target?.ok) throw new MediaError(target?.error ?? "The ad could not be saved in the Gallery.");
  const up = await createAdminClient().storage.from(GALLERY_VIDEO_BUCKET).uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(input.bytes)], { type: "video/mp4" }), { contentType: "video/mp4" });
  if (up.error) throw new Error("The ad could not be uploaded to the Gallery.");
  const item = await finalizeUpload(ctx, { path: target.path, name: input.title.slice(0, 120), destination, width: 720, height: 1280 });
  return { path: item.path, posterPath: item.posterPath ?? null, bytes: item.bytes, durationMs: item.durationMs ?? null };
}

/**
 * Step 2: the Videos library row and (unless a hard rule was flagged) one post per video network, waiting for
 * approval, in one transaction.
 */
export async function deliverAd(input: { jobId: string; userId: string; businessId: string; timezone: string; item: GalleryVideo; seconds: number; caption: string; hashtags: string[]; makePosts: boolean; reviewNote?: string | null; now?: Date }): Promise<{ videoPath: string; videoJobId: string; postGroupId: string | null; posts: number }> {
  const item = input.item;
  const hashtags = cleanHashtags(input.hashtags);
  // VideoJob.seconds is 4 to 30 (a database check): an ad of up to 34 s is listed as 30.
  const videoRow = { businessId: input.businessId, userId: input.userId, engine: AD_ENGINE, mode: "ad", status: "ready", platform: null, ratio: "9:16", seconds: Math.max(4, Math.min(30, Math.round(input.seconds))), brief: { adJobId: input.jobId } as Prisma.InputJsonValue, caption: input.caption, hashtags, videoPath: item.path, posterPath: item.posterPath, bytes: item.bytes, durationMs: item.durationMs ?? Math.round(input.seconds * 1000) };
  if (!input.makePosts) {
    const video = await prisma.videoJob.create({ data: videoRow, select: { id: true } });
    return { videoPath: item.path, videoJobId: video.id, postGroupId: null, posts: 0 };
  }

  const connections = await prisma.connection.findMany({ where: { businessId: input.businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } });
  const usable = pagesFirst(connections).filter((c) => isNetwork(c.provider) && accountUsable(c));
  const today = dayKey(input.now ?? new Date(), input.timezone || "UTC");
  const groupId = `ad-${input.jobId}`;
  const rows: Prisma.PostCreateManyInput[] = AD_NETWORKS.map((network) => {
    const connection = usable.find((c) => c.provider === network) ?? null;
    const media = mediaForPost({ network, format: "SCRIPT", rules: { formats: ["POST"], maxImages: 1, videoOnly: true }, images: [], video: item.path, videoMs: item.durationMs ?? Math.round(input.seconds * 1000) });
    return {
      businessId: input.businessId,
      connectionId: connection?.id ?? null,
      remindOnly: connection === null,
      network,
      groupId,
      status: "PENDING_APPROVAL",
      format: media.format,
      source: "MANUAL",
      text: input.caption,
      hashtags,
      mediaPaths: media.mediaPaths,
      plannedDay: dayDate(today),
      reviewNote: [input.reviewNote, media.note].filter(Boolean).join(" ") || "Made by the Ad Brain: check the video before you approve it.",
    };
  });
  // Never auto-scheduled: the owner's OK is needed for each post (docs/AD_BRAIN.md, "Delivery").
  const [video] = await prisma.$transaction([prisma.videoJob.create({ data: videoRow, select: { id: true } }), ...rows.map((data) => prisma.post.create({ data, select: { id: true } }))]);
  return { videoPath: item.path, videoJobId: video.id, postGroupId: groupId, posts: rows.length };
}
