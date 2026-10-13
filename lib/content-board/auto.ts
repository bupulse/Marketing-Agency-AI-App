// Auto-approval (docs/CONTENT.md): posts waiting for review whose app needs no approval (Content -> Settings) are
// scheduled at the best time, unless a safety rule (lib/content-board/rules.ts) keeps them waiting with a reason.
// Called when Studio drafts posts, after an Autopilot run, and when a picture or video of the post is finished.
// Plans have no cap on posts (lib/plans.ts meters text, images, video seconds, voice and chat only), so there is no
// post limit to check here; scheduling itself is gated by the calendar feature and a read-only account.
import "server-only";
import { prisma } from "@/lib/db";
import { companyEntitlements } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { accountUsable, bestTimesFor, scheduleAtFreeSlot } from "@/lib/publishing/service";
import { validatePost, type PostFormatName } from "@/lib/publishing/validate";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { autoDecision } from "./rules";
import { readContentSettings, requiresApproval } from "./settings";

const VIDEO = /\.(mp4|webm)$/i;

export type AutoResult = { scheduled: number; waiting: number };

/** What the safety rules need to know about a post. */
export const SAFETY_SELECT = {
  id: true,
  network: true,
  format: true,
  text: true,
  hashtags: true,
  mediaPaths: true,
  scheduledAt: true,
  status: true,
  connectionId: true,
  contentId: true,
  groupId: true,
  reviewNote: true,
  updatedAt: true,
  remindOnly: true,
  connection: { select: { status: true, postingMode: true } },
} as const;

type SafetyPost = { id: string; network: string; format: string; text: string; hashtags: string[]; mediaPaths: string[]; contentId: string | null; groupId: string | null; remindOnly: boolean; connection: { status: string; postingMode: string } | null };

/**
 * Why each post could not go out safely right now (null: it can), ignoring the approval setting: the plan, the
 * account, a picture or video still being made, the network's rules (lib/content-board/rules.ts). Used by
 * auto-approval and by "Schedule all my posts".
 */
export async function safetyReasons(businessId: string, posts: readonly SafetyPost[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (posts.length === 0) return out;
  const entitlements = await companyEntitlements(businessId);
  const canSchedule = entitlements.usable.has("calendar") && !entitlements.block;
  const contentIds = [...new Set(posts.flatMap((p) => (p.contentId ? [p.contentId] : [])))];
  const groupIds = [...new Set(posts.flatMap((p) => (p.groupId ? [p.groupId] : [])))];
  const visuals =
    contentIds.length || groupIds.length
      ? await prisma.contentVisual.findMany({
          where: { businessId, status: "pending", OR: [...(contentIds.length ? [{ contentId: { in: contentIds } }] : []), ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])] },
          select: { kind: true, contentId: true, groupId: true },
        })
      : [];
  const pending = (post: { contentId: string | null; groupId: string | null }, video: boolean) =>
    visuals.some((v) => (v.kind === "video") === video && ((post.contentId && v.contentId === post.contentId) || (post.groupId && v.groupId === post.groupId)));
  for (const post of posts) {
    const rules = isNetwork(post.network) ? getProvider(post.network).rules : null;
    const format = post.format === "ARTICLE" || post.format === "THREAD" ? null : (post.format as PostFormatName);
    const decision = autoDecision({
      network: post.network,
      format: post.format,
      requireApproval: false,
      canSchedule,
      account: post.connection ? { usable: accountUsable(post.connection) } : null,
      byHand: !post.connection && post.remindOnly,
      requiresMedia: rules?.requiresMedia ?? false,
      hasMedia: post.mediaPaths.length > 0,
      hasVideo: post.mediaPaths.some((p) => VIDEO.test(p)),
      videoPending: pending(post, true),
      imagePending: pending(post, false),
      issues: rules && format ? validatePost(rules, { format, text: post.text, hashtags: post.hashtags, mediaCount: post.mediaPaths.length }).errors : [],
    });
    out.set(post.id, decision.action === "review" ? decision.reason : null);
  }
  return out;
}

/** Runs auto-approval over these posts (only this business's, only those still waiting). */
export async function autoSchedule(businessId: string, postIds: string[], now = new Date()): Promise<AutoResult> {
  const ids = [...new Set(postIds)].slice(0, 500);
  if (ids.length === 0) return { scheduled: 0, waiting: 0 };
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { contentSettings: true } });
  if (!business) return { scheduled: 0, waiting: 0 };
  const settings = readContentSettings(business.contentSettings);

  const posts = await prisma.post.findMany({ where: { id: { in: ids }, businessId, status: "PENDING_APPROVAL" }, select: SAFETY_SELECT });
  // Nothing to decide when every app here waits for approval.
  const candidates = posts.filter((p) => !requiresApproval(settings, p.network));
  if (candidates.length === 0) return { scheduled: 0, waiting: posts.length };
  const reasons = await safetyReasons(businessId, candidates);

  const toSchedule: typeof candidates = [];
  let waiting = posts.length - candidates.length;
  for (const post of candidates) {
    const note = reasons.get(post.id) ?? null;
    if (note === null) {
      toSchedule.push(post);
      continue;
    }
    waiting += 1;
    if (note !== post.reviewNote) await prisma.post.updateMany({ where: { id: post.id, businessId, status: "PENDING_APPROVAL", updatedAt: post.updatedAt }, data: { reviewNote: note } });
  }

  // Autopilot planned its posts at the best time already: they keep a time still ahead. The rest get the best time now.
  const needTime = toSchedule.filter((p) => !p.scheduledAt || p.scheduledAt.getTime() <= now.getTime() + 5 * 60_000);
  const times = await bestTimesFor(businessId, needTime, now);
  // Written only if the post is unchanged since the safety checks read it (updatedAt), and only on a free slot
  // (2.5 hours from other posts on the account, checked under a lock; a new best time when it was taken meanwhile).
  let scheduled = 0;
  for (const post of toSchedule) {
    const at = times.get(post.id) ?? post.scheduledAt;
    if (!at) continue;
    const ok = "ok" === await scheduleAtFreeSlot(post, at, {
      businessId,
      where: { status: "PENDING_APPROVAL", updatedAt: post.updatedAt },
      data: { status: "SCHEDULED", autoScheduledAt: now, reviewNote: null },
      now,
    });
    if (ok) scheduled += 1;
    else waiting += 1;
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
