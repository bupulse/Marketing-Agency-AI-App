// Database reads for a subject's day view (docs/CONTENT.md, content flow v3), scoped to the business.
import "server-only";
import { postInclude, toContentPosts } from "@/lib/content-board/queries";
import type { ContentFilters, ContentScope } from "@/lib/content-board/filters";
import { prisma } from "@/lib/db";
import { loadVisuals, pickVisuals } from "@/lib/visuals/queries";
import { dayBounds, dayDate, dayWhere, periodWhere } from "./day";

/**
 * One day of a subject's posts (content flow v3, lib/content-flow/day.ts): made that day or going out that day, under
 * the board's app, type, status and search filters, newest first, paged.
 */
export async function loadDayPosts(businessId: string, scope: ContentScope, day: string, filters: ContentFilters, zone: string, now: Date) {
  const where = dayWhere(businessId, scope, day, zone, filters, now);
  const [rows, total] = await Promise.all([prisma.post.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: filters.limit + 1, include: postInclude }), prisma.post.count({ where })]);
  return { posts: await toContentPosts(businessId, rows.slice(0, filters.limit)), total, hasMore: rows.length > filters.limit };
}

/**
 * A week's or month's posts of a subject (the Week / Month switch, lib/content-board/period.ts), oldest first so a
 * longer list ("Show more") continues at its end. The page groups them by day.
 */
export async function loadPeriodPosts(businessId: string, scope: ContentScope, period: { start: string; end: string }, filters: ContentFilters, zone: string, now: Date) {
  const where = periodWhere(businessId, scope, period, zone, filters, now);
  const [rows, total] = await Promise.all([prisma.post.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: filters.limit + 1, include: postInclude }), prisma.post.count({ where })]);
  return { posts: await toContentPosts(businessId, rows.slice(0, filters.limit)), total, hasMore: rows.length > filters.limit };
}

export type DayContent = { id: string; network: string | null; angle: string | null; mode: string | null; createdAt: string; hasScript: boolean };

/** The content rows a day's runs made for a subject (one per post), each with its picture and video. */
export async function loadDayContents(businessId: string, scope: ContentScope, day: string, zone: string) {
  const subject = scope.kind === "product" ? { productId: scope.id } : scope.kind === "campaign" ? { campaignId: scope.id } : { productId: null, campaignId: null };
  const rows = await prisma.generatedContent.findMany({
    // Content from before the day runs (no forDate) shows on the day it was written, so its picture and video can still be made.
    where: { businessId, ...subject, OR: [{ forDate: dayDate(day) }, { forDate: null, createdAt: dayBounds(day, zone) }] },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, network: true, angle: true, mode: true, createdAt: true, videoScript: true },
  });
  // A day's shared set (lib/content-flow/day-set.ts) hangs from its posts' group, not from one content row: it is shown
  // once, on the set's first feed post's content (the others show none), so the page draws and edits it as before.
  const posts = rows.length ? await prisma.post.findMany({ where: { businessId, contentId: { in: rows.map((r) => r.id) }, groupId: { not: null } }, select: { contentId: true, groupId: true, format: true } }) : [];
  const groupIds = [...new Set(posts.flatMap((p) => (p.groupId ? [p.groupId] : [])))];
  const visuals = await loadVisuals(businessId, { contentIds: rows.map((r) => r.id), groupIds });
  const setOf = new Map<string, string>();
  for (const groupId of groupIds) {
    if (!visuals.some((v) => v.groupId === groupId && !v.contentId)) continue;
    const mine = posts.filter((p) => p.groupId === groupId);
    const lead = [...rows].reverse().find((r) => mine.some((p) => p.contentId === r.id && p.format !== "SCRIPT")) ?? [...rows].reverse().find((r) => mine.some((p) => p.contentId === r.id));
    if (lead) setOf.set(lead.id, groupId);
  }
  return rows.map((r) => {
    const own = pickVisuals(visuals, { contentId: r.id });
    const groupId = setOf.get(r.id);
    const shared = groupId ? pickVisuals(visuals.filter((v) => !v.contentId), { groupId }) : null;
    return { id: r.id, network: r.network, angle: r.angle, mode: r.mode, createdAt: r.createdAt.toISOString(), hasScript: r.videoScript.trim().length > 0, groupId: groupId ?? null, image: own.image ?? shared?.image ?? null, video: own.video ?? shared?.video ?? null };
  });
}
