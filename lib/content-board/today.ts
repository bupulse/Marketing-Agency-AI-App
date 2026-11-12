// "Today's posts" on the Posts page grid: a product's, campaign's or General's card glows when posts were made for it
// today (the business's local day: Daily posts, the day's set, Create, Autopilot, by hand). Pure: the query in
// queries.ts asks one grouped count with todayWhere, and the cards read todayBySubject.
import type { Prisma } from "@/lib/generated/prisma/client";
import { addDays, dayKey, parseDayKey, zonedTimeToUtc } from "@/lib/publishing/time";
import { LISTED_STATUSES } from "./filters";

/** The business's local today as [since, until) instants. Midnight to midnight in its zone, daylight-saving safe. */
export function todayWindow(zone: string, now: Date): { since: Date; until: Date } {
  const today = dayKey(now, zone);
  const at = (key: string) => {
    const { year, month, day } = parseDayKey(key);
    return zonedTimeToUtc(year, month, day, 0, 0, zone);
  };
  return { since: at(today), until: at(addDays(today, 1)) };
}

/** Posts of this business made today, not cancelled: one `post.groupBy(["productId", "campaignId"])` over these. */
export function todayWhere(businessId: string, zone: string, now: Date): Prisma.PostWhereInput {
  const { since, until } = todayWindow(zone, now);
  return { businessId, createdAt: { gte: since, lt: until }, status: { in: [...LISTED_STATUSES] as Prisma.EnumPostStatusFilter["in"] } };
}

export type TodayRow = { productId: string | null; campaignId: string | null; count: number };

/** Today's post count per subject key ("product:<id>", "campaign:<id>", "general"), the grid's card keys. */
export function todayBySubject(rows: readonly TodayRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.count <= 0) continue;
    const key = r.productId ? `product:${r.productId}` : r.campaignId ? `campaign:${r.campaignId}` : "general";
    out.set(key, (out.get(key) ?? 0) + r.count);
  }
  return out;
}
