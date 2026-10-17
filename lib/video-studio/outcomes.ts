import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { Prisma } from "@/lib/generated/prisma/client";
import { hookById } from "@/lib/video-engine/brain/database";
import { formatFromTemplate, sectorFromText } from "@/lib/video-engine/brain/select";
import type { OutcomeStats } from "@/lib/video-engine/brain/types";
import { isVideoPath } from "@/lib/visuals/post-media";

// What studio videos did once posted (docs/VIDEO_APP_INTEGRATION.md, section 5, step 3; docs/research/BRAIN.md,
// "Learning from our own results"): a VideoOutcome per published post of a studio MP4, written when the post goes out
// (the publisher, or the owner's "I posted it" for a reminder), and its numbers after 24 hours and 7 days, filled by
// the metrics cron from the post's latest PostMetrics. The Brain reads them back (brain/outcomes.ts).

const DAY_MS = 24 * 60 * 60 * 1000;
const BRAIN_PLATFORM: Record<string, string> = { tiktok: "tiktok", instagram: "instagram", facebook: "facebook", youtube: "shorts" };
/** Outcomes looked at per metrics run. */
export const OUTCOME_BATCH = 200;

type Brief = { business?: { name?: string; description?: string | null; language?: string | null }; product?: { name?: string; summary?: string | null } };

/**
 * Records the outcome of a published post when it carries a studio MP4 (found by its file). Once per post (postId is
 * unique). Never throws: publishing must not fail because of it.
 */
export async function recordStudioOutcome(post: { id: string; businessId: string; network: string; mediaPaths: string[] }, postedAt: Date): Promise<boolean> {
  try {
    const platform = BRAIN_PLATFORM[post.network];
    const path = post.mediaPaths.find(isVideoPath);
    if (!platform || !path) return false;
    const job = await prisma.videoJob.findFirst({ where: { businessId: post.businessId, videoPath: path }, select: { id: true, templateId: true, hookId: true, seconds: true, brief: true } });
    if (!job) return false;
    const brief = (job.brief ?? {}) as Brief;
    const sector = sectorFromText([brief.business?.name, brief.business?.description, brief.product?.name, brief.product?.summary].filter(Boolean).join(" "));
    const { count } = await prisma.videoOutcome.createMany({
      data: [
        {
          videoJobId: job.id,
          postId: post.id,
          businessId: post.businessId,
          sector,
          platform,
          templateId: job.templateId,
          hookId: job.hookId && hookById(job.hookId) ? job.hookId : null,
          formatId: formatFromTemplate(job.templateId),
          captionFormulaId: null,
          seconds: job.seconds,
          language: brief.business?.language ?? null,
          postedAt,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (error) {
    await logError(error, { source: "video.outcome", level: "warn", businessId: post.businessId, postId: post.id }).catch(() => {});
    return false;
  }
}

const statsOf = (m: { views: number | null; reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null }): OutcomeStats => ({ views: m.views, reach: m.reach, likes: m.likes, comments: m.comments, saves: m.saves, shares: m.shares });

/**
 * Fills each outcome's numbers: 24 hours after it was posted (stats24h) and 7 days after (stats7d), from the post's
 * latest metrics read by then. An outcome whose post has no metrics yet waits for the next run. Idempotent.
 */
export async function fillOutcomeStats(now = new Date()): Promise<{ day: number; week: number }> {
  const result = { day: 0, week: 0 };
  for (const [field, ageMs] of [["stats24h", DAY_MS], ["stats7d", 7 * DAY_MS]] as const) {
    // Not filled yet: the column is a database NULL.
    const unfilled: Prisma.VideoOutcomeWhereInput = field === "stats24h" ? { stats24h: { equals: Prisma.DbNull } } : { stats7d: { equals: Prisma.DbNull } };
    const due = await prisma.videoOutcome.findMany({
      where: { ...unfilled, postId: { not: null }, postedAt: { lte: new Date(now.getTime() - ageMs) } },
      orderBy: { postedAt: "asc" },
      take: OUTCOME_BATCH,
      select: { id: true, postId: true },
    });
    for (const o of due) {
      const latest = await prisma.postMetrics.findFirst({ where: { postId: o.postId as string }, orderBy: { capturedAt: "desc" }, select: { views: true, reach: true, likes: true, comments: true, saves: true, shares: true } });
      if (!latest) continue;
      const stats = statsOf(latest) as Prisma.InputJsonValue;
      const { count } = await prisma.videoOutcome.updateMany({ where: { id: o.id, ...unfilled }, data: field === "stats24h" ? { stats24h: stats } : { stats7d: stats } });
      if (count === 1) result[field === "stats24h" ? "day" : "week"] += 1;
    }
  }
  return result;
}
