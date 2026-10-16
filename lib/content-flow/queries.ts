// Database reads for a subject's day view (docs/CONTENT.md, content flow v3), scoped to the business.
import "server-only";
import { postInclude, toContentPosts } from "@/lib/content-board/queries";
import type { ContentFilters, ContentScope } from "@/lib/content-board/filters";
import { prisma } from "@/lib/db";
import { loadVisuals, pickVisuals } from "@/lib/visuals/queries";
import { dayBounds, dayDate, dayWhere } from "./day";

/**
 * One day of a subject's posts (content flow v3, lib/content-flow/day.ts): made that day or going out that day, under
 * the board's app, type, status and search filters, newest first, paged.
 */
export async function loadDayPosts(businessId: string, scope: ContentScope, day: string, filters: ContentFilters, zone: string, now: Date) {
  const where = dayWhere(businessId, scope, day, zone, filters, now);
  const [rows, total] = await Promise.all([prisma.post.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: filters.limit + 1, include: postInclude }), prisma.post.count({ where })]);
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
  const visuals = await loadVisuals(businessId, { contentIds: rows.map((r) => r.id) });
  return rows.map((r) => ({ id: r.id, network: r.network, angle: r.angle, mode: r.mode, createdAt: r.createdAt.toISOString(), hasScript: r.videoScript.trim().length > 0, ...pickVisuals(visuals, { contentId: r.id }) }));
}
