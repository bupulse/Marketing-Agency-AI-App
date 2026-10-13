// The day view of a product's, campaign's or General's content (docs/CONTENT.md): a business-local day ("YYYY-MM-DD"
// in Business.timezone, Africa/Kigali for most companies) and the posts that belong to it. Pure: the page, the date bar
// and the tests share it.
import type { Prisma } from "@/lib/generated/prisma/client";
import { contentWhere, STATUS_GROUPS, type ContentFilters, type ContentScope } from "@/lib/content-board/filters";
import { addDays, dayKey, parseDayKey, zonedTimeToUtc } from "@/lib/publishing/time";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** How far back and ahead the date bar goes. */
export const DAY_RANGE = { back: 366, ahead: 90 } as const;

export function todayIn(zone: string, now: Date): string {
  return dayKey(now, zone);
}

/** The `?day=` value when it is a real date within the range, else today. */
export function parseDay(raw: unknown, zone: string, now: Date): string {
  const today = todayIn(zone, now);
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !DAY.test(value)) return today;
  const { year, month, day } = parseDayKey(value);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return today;
  if (value < addDays(today, -DAY_RANGE.back) || value > addDays(today, DAY_RANGE.ahead)) return today;
  return value;
}

/** [start, end) of a local day as instants. */
export function dayBounds(day: string, zone: string): { gte: Date; lt: Date } {
  const at = (key: string) => {
    const { year, month, day: d } = parseDayKey(key);
    return zonedTimeToUtc(year, month, d, 0, 0, zone);
  };
  return { gte: at(day), lt: at(addDays(day, 1)) };
}

/** The day as a DATE column value (midnight UTC of that calendar day), for GeneratedContent.forDate. */
export function dayDate(day: string): Date {
  const { year, month, day: d } = parseDayKey(day);
  return new Date(Date.UTC(year, month - 1, d));
}

export function dateDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The posts of a day: made that day, or planned for that day (scheduled to go out or posted then). The board's filters
 * (app, type, status, search) apply; its date range does not (the day replaces it).
 */
export function dayWhere(businessId: string, scope: ContentScope, day: string, zone: string, filters: ContentFilters, now: Date): Prisma.PostWhereInput {
  const base = contentWhere(businessId, { ...filters, range: undefined, from: undefined, to: undefined }, { zone, now, scope });
  const window = dayBounds(day, zone);
  const inDay: Prisma.PostWhereInput = { OR: [{ createdAt: window }, { publishedAt: window }, { publishedAt: null, scheduledAt: window }] };
  return { ...base, AND: [...(Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : []), inDay] };
}

export type DaySection = "review" | "goes" | "made";

export const DAY_SECTION_LABEL: Record<DaySection, string> = {
  review: "Needs your OK",
  goes: "Goes out this day",
  made: "Made this day",
};

/**
 * Where a post shows in the day: waiting for the owner, going out (or gone out) that day, or made that day and planned
 * for another one. Pure, so the sections and the counts agree.
 */
export function daySection(post: { status: string; scheduledAt: string | null; publishedAt: string | null }, day: string, zone: string): DaySection {
  if (STATUS_GROUPS.review.includes(post.status)) return "review";
  const when = post.publishedAt ?? post.scheduledAt;
  if (when && dayKey(new Date(when), zone) === day) return "goes";
  return "made";
}

export function groupDay<T extends { status: string; scheduledAt: string | null; publishedAt: string | null }>(posts: T[], day: string, zone: string): Record<DaySection, T[]> {
  const out: Record<DaySection, T[]> = { review: [], goes: [], made: [] };
  for (const p of posts) out[daySection(p, day, zone)].push(p);
  for (const list of [out.goes]) list.sort((a, b) => (a.publishedAt ?? a.scheduledAt ?? "").localeCompare(b.publishedAt ?? b.scheduledAt ?? ""));
  return out;
}

/** "Tuesday 13 October" (and the year when it is not this year). */
export function dayLabel(day: string, today: string, locale = "en-GB"): string {
  const { year, month, day: d } = parseDayKey(day);
  const date = new Date(Date.UTC(year, month - 1, d, 12));
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const text = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
  if (day === today) return `Today, ${text}`;
  if (day === addDays(today, -1)) return `Yesterday, ${text}`;
  if (day === addDays(today, 1)) return `Tomorrow, ${text}`;
  return text;
}
