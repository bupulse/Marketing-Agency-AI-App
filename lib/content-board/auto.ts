// Auto-approval (docs/CONTENT.md): posts waiting for review whose app needs no approval (Content -> Settings) are
// scheduled at the best time, unless a safety rule (lib/content-board/rules.ts) keeps them waiting with a reason.
// Called when Studio drafts posts, after an Autopilot run, and when a picture or video of the post is finished.
import "server-only";
import { prisma } from "@/lib/db";
import { companyEntitlements } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { accountUsable, bestTimesFor } from "@/lib/publishing/service";
import { validatePost, type PostFormatName } from "@/lib/publishing/validate";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { autoDecision } from "./rules";
import { readContentSettings, requiresApproval } from "./settings";

const VIDEO = /\.(mp4|webm)$/i;

export type AutoResult = { scheduled: number; waiting: number };

/** Runs auto-approval over these posts (only this business's, only those still waiting). */
export async function autoSchedule(businessId: string, postIds: string[], now = new Date()): Promise<AutoResult> {
  const ids = [...new Set(postIds)].slice(0, 500);
  if (ids.length === 0) return { scheduled: 0, waiting: 0 };
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { contentSettings: true } });
  if (!business) return { scheduled: 0, waiting: 0 };
  const settings = readContentSettings(business.contentSettings);

  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, businessId, status: "PENDING_APPROVAL" },
    select: {
      id: true,
      network: true,
      format: true,
      text: true,
      hashtags: true,
      mediaPaths: true,
      scheduledAt: true,
      connectionId: true,
      contentId: true,
      groupId: true,
      reviewNote: true,
      connection: { select: { status: true, postingMode: true } },
    },
  });
  // Nothing to decide when every app here waits for approval.
  const candidates = posts.filter((p) => !requiresApproval(settings, p.network));
  if (candidates.length === 0) return { scheduled: 0, waiting: posts.length };

  const entitlements = await companyEntitlements(businessId);
  const canSchedule = entitlements.usable.has("calendar") && !entitlements.block;
  const contentIds = [...new Set(candidates.flatMap((p) => (p.contentId ? [p.contentId] : [])))];
  const groupIds = [...new Set(candidates.flatMap((p) => (p.groupId ? [p.groupId] : [])))];
  const visuals =
    contentIds.length || groupIds.length
      ? await prisma.contentVisual.findMany({
          where: { businessId, status: "pending", OR: [...(contentIds.length ? [{ contentId: { in: contentIds } }] : []), ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
          select: { kind: true, contentId: true, groupId: true },
        })
      : [];
  const pending = (post: { contentId: string | null; groupId: string | null }, video: boolean) =>
    visuals.some((v) => (v.kind === "video") === video && ((post.contentId && v.contentId === post.contentId) || (post.groupId && v.groupId === post.groupId)));

  const toSchedule: typeof candidates = [];
  let waiting = posts.length - candidates.length;
  for (const post of candidates) {
    const rules = isNetwork(post.network) ? getProvider(post.network).rules : null;
    const format = post.format === "ARTICLE" || post.format === "THREAD" ? null : (post.format as PostFormatName);
    const decision = autoDecision({
      network: post.network,
      format: post.format,
      requireApproval: false,
      canSchedule,
      account: post.connection ? { usable: accountUsable(post.connection) } : null,
      requiresMedia: rules?.requiresMedia ?? false,
      hasMedia: post.mediaPaths.length > 0,
      hasVideo: post.mediaPaths.some((p) => VIDEO.test(p)),
      videoPending: pending(post, true),
      imagePending: pending(post, false),
      issues: rules && format ? validatePost(rules, { format, text: post.text, hashtags: post.hashtags, mediaCount: post.mediaPaths.length }).errors : [],
    });
    if (decision.action === "schedule") {
      toSchedule.push(post);
      continue;
    }
    waiting += 1;
    const note = decision.action === "review" ? decision.reason : null;
    if (note !== post.reviewNote) await prisma.post.updateMany({ where: { id: post.id, businessId, status: "PENDING_APPROVAL" }, data: { reviewNote: note } });
  }

  // Autopilot planned its posts at the best time already: they keep a time still ahead. The rest get the best time now.
  const needTime = toSchedule.filter((p) => !p.scheduledAt || p.scheduledAt.getTime() <= now.getTime() + 5 * 60_000);
  const times = await bestTimesFor(businessId, needTime, now);
  let scheduled = 0;
  for (const post of toSchedule) {
    const at = times.get(post.id) ?? post.scheduledAt;
    if (!at) continue;
    const { count } = await prisma.post.updateMany({
      where: { id: post.id, businessId, status: "PENDING_APPROVAL" },
      data: { status: "SCHEDULED", scheduledAt: at, autoScheduledAt: now, reviewNote: null },
    });
    scheduled += count;
  }
  return { scheduled, waiting };
}

/**
 * A picture or video was finished: posts of that content (Studio) or group (Autopilot) that waited only because of it
 * get another chance. Never throws: a visual is never failed by this.
 */
export async function retryAutoSchedule(businessId: string, key: { contentId: string } | { groupId: string }, now = new Date()): Promise<void> {
  try {
    const waiting = await prisma.post.findMany({ where: { businessId, ...key, status: "PENDING_APPROVAL", reviewNote: { not: null } }, select: { id: true }, take: 50 });
    if (waiting.length) await autoSchedule(businessId, waiting.map((p) => p.id), now);
  } catch (error) {
    await logError(error, { source: "content.auto.retry", level: "warn", businessId });
  }
}
