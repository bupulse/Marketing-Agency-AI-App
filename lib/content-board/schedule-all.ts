// "Schedule all my posts" (docs/CONTENT.md): the posts not posted yet in the current view (drafts and posts waiting for
// review) are scheduled at once, at the best times or at times the owner picked. Same safety rules as auto-approval,
// 2.5 hours apart per account (claimSlot), and a report of what was scheduled and what was skipped, with why.
import "server-only";
import { prisma } from "@/lib/db";
import { bestTimesFor, claimSlot, scheduleAtFreeSlot } from "@/lib/publishing/service";
import { SAFETY_SELECT, safetyReasons } from "./auto";
import { contentWhere, type ContentFilters, type ContentScope } from "./filters";
import { networkLabel } from "./labels";

/** Posts this action schedules: not posted, not scheduled yet. */
export const SCHEDULABLE = ["DRAFT", "PENDING_APPROVAL"] as const;
export const MAX_SCHEDULE_ALL = 100;

export const SKIP_REASONS = {
  taken: "Another post on this account goes out within 2.5 hours of that time. Pick another time.",
  past: "Pick a time in the future.",
  changed: "This post changed or was scheduled meanwhile.",
  noTime: "No free time was found in the next three weeks. Pick a time.",
} as const;

export type SchedulablePost = { id: string; network: string; label: string; excerpt: string; subject: string; suggested: string | null; blocked: string | null };

/** The view's unposted posts with a suggested best time each (nothing is written), and why any cannot go. */
export async function schedulablePosts(businessId: string, filters: ContentFilters, ctx: { zone: string; now: Date; scope?: ContentScope | null }): Promise<SchedulablePost[]> {
  const where = contentWhere(businessId, { ...filters, statuses: ["review"] }, ctx);
  const rows = await prisma.post.findMany({
    where: { ...where, status: { in: [...SCHEDULABLE] } },
    orderBy: { createdAt: "desc" },
    take: MAX_SCHEDULE_ALL,
    select: { ...SAFETY_SELECT, title: true, product: { select: { name: true } }, campaign: { select: { name: true } } },
  });
  const [reasons, times] = await Promise.all([safetyReasons(businessId, rows), bestTimesFor(businessId, rows, ctx.now)]);
  return rows.map((r) => {
    const text = (r.title ?? r.text).replace(/\s+/g, " ").trim();
    return {
      id: r.id,
      network: r.network,
      label: networkLabel(r.network),
      excerpt: text.length > 80 ? `${text.slice(0, 79)}…` : text,
      subject: r.product?.name ?? r.campaign?.name ?? "General",
      suggested: times.get(r.id)?.toISOString() ?? null,
      blocked: reasons.get(r.id) ?? null,
    };
  });
}

export type ScheduleAllResult = { scheduled: { id: string; at: string }[]; skipped: { id: string; reason: string }[] };

/**
 * Schedules these posts: each at its own time when given (`at`), else at the best time. Only this business's posts
 * not posted or scheduled yet; each one is checked by the safety rules and written only if it has not changed since
 * (updatedAt) and its time is free on the account.
 */
export async function scheduleAll(businessId: string, items: { id: string; at?: Date }[], now = new Date()): Promise<ScheduleAllResult> {
  const wanted = new Map<string, Date | undefined>();
  for (const item of items.slice(0, MAX_SCHEDULE_ALL)) wanted.set(item.id, item.at);
  const result: ScheduleAllResult = { scheduled: [], skipped: [] };
  if (wanted.size === 0) return result;
  const posts = await prisma.post.findMany({ where: { id: { in: [...wanted.keys()] }, businessId, status: { in: [...SCHEDULABLE] } }, select: SAFETY_SELECT });
  for (const id of wanted.keys()) if (!posts.some((p) => p.id === id)) result.skipped.push({ id, reason: SKIP_REASONS.changed });
  const reasons = await safetyReasons(businessId, posts);
  const ready = posts.filter((p) => {
    const reason = reasons.get(p.id);
    if (reason) result.skipped.push({ id: p.id, reason });
    return !reason;
  });
  const auto = ready.filter((p) => !wanted.get(p.id));
  const best = await bestTimesFor(businessId, auto, now);

  for (const post of ready) {
    const chosen = wanted.get(post.id);
    const where = { status: post.status, updatedAt: post.updatedAt };
    const data = { status: "SCHEDULED" as const, reviewNote: null };
    if (chosen) {
      if (chosen.getTime() <= now.getTime() + 60_000) {
        result.skipped.push({ id: post.id, reason: SKIP_REASONS.past });
        continue;
      }
      const outcome = await claimSlot({ businessId, postId: post.id, connectionId: post.connectionId, at: chosen, where, data });
      if (outcome === "ok") result.scheduled.push({ id: post.id, at: chosen.toISOString() });
      else result.skipped.push({ id: post.id, reason: outcome === "taken" ? SKIP_REASONS.taken : SKIP_REASONS.changed });
      continue;
    }
    const at = best.get(post.id);
    if (!at) {
      result.skipped.push({ id: post.id, reason: SKIP_REASONS.noTime });
      continue;
    }
    if (await scheduleAtFreeSlot(post, at, { businessId, where, data, now })) {
      const written = await prisma.post.findFirst({ where: { id: post.id, businessId }, select: { scheduledAt: true } });
      result.scheduled.push({ id: post.id, at: (written?.scheduledAt ?? at).toISOString() });
    } else result.skipped.push({ id: post.id, reason: SKIP_REASONS.noTime });
  }
  return result;
}
