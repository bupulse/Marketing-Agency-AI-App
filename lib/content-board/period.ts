// The Day / Week / Month switch of the Posts page and of each product's, campaign's or General's posts (docs/CONTENT.md):
// a period of business-local days ("YYYY-MM-DD" in Business.timezone), kept in the URL as ?view=day|week|month&day=.
// Weeks start on Monday. Pure (only Intl): the pages, the bar and the tests share it.
import type { Prisma } from "@/lib/generated/prisma/client";
import { addDays, addMonths, dayKey, parseDayKey, startOfMonth, startOfWeek, zonedTimeToUtc } from "@/lib/publishing/time";

export const PERIOD_VIEWS = ["day", "week", "month"] as const;
export type PeriodView = (typeof PERIOD_VIEWS)[number];
export const PERIOD_VIEW_LABEL: Record<PeriodView, string> = { day: "Day", week: "Week", month: "Month" };

export function isPeriodView(value: unknown): value is PeriodView {
  return typeof value === "string" && (PERIOD_VIEWS as readonly string[]).includes(value);
}

export interface Period {
  view: PeriodView;
  /** The day the period was picked from (the URL's ?day=): arrows move it by a day, a week or a month. */
  anchor: string;
  /** First day. */
  start: string;
  /** Last day (inclusive). */
  end: string;
}

/** The day, Monday-to-Sunday week or calendar month around a day. */
export function periodOf(view: PeriodView, anchor: string): Period {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { view, anchor, start, end: addDays(start, 6) };
  }
  if (view === "month") {
    const start = startOfMonth(anchor);
    return { view, anchor, start, end: addDays(addMonths(start, 1), -1) };
  }
  return { view, anchor, start: anchor, end: anchor };
}

/** The anchor of the period before (-1) or after (+1). A month moves to the 1st of that month. */
export function shiftPeriod(view: PeriodView, anchor: string, delta: number): string {
  if (view === "week") return addDays(anchor, 7 * delta);
  if (view === "month") return addMonths(startOfMonth(anchor), delta);
  return addDays(anchor, delta);
}

export function periodContains(period: Pick<Period, "start" | "end">, day: string): boolean {
  return day >= period.start && day <= period.end;
}

/**
 * The button of an empty week or month: back to the current one, or, when this already is the current one ("Back to
 * this month" went nowhere, QA 13 Nov), today's posts.
 */
export function emptyPeriodAction(period: Pick<Period, "start" | "end">, today: string, span: "week" | "month"): { label: string; today: boolean } {
  return periodContains(period, today) ? { label: "See today", today: true } : { label: `Back to this ${span}`, today: false };
}

/** Every day of the period, in order. */
export function periodDays(period: Pick<Period, "start" | "end">): string[] {
  const out: string[] = [];
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) out.push(d);
  return out;
}

const noon = (key: string) => {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day, 12));
};
const fmt = (key: string, options: Intl.DateTimeFormatOptions, locale = "en-GB") => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(noon(key));
/** "Sat 31 Oct" or "Saturday 31 October 2027", built from parts (Intl adds a comma before the year). */
const dayWords = (key: string, width: "short" | "long", year: boolean) =>
  [fmt(key, { weekday: width }), fmt(key, { day: "numeric" }), fmt(key, { month: width }), ...(year ? [key.slice(0, 4)] : [])].join(" ");

/**
 * The bar's label: "Sat 31 Oct", "27 Oct – 2 Nov" (or "2 – 8 Nov" within a month), "October 2026". The year shows on a
 * day or week when it is not this year.
 */
export function periodLabel(period: Period, today: string): string {
  const thisYear = today.slice(0, 4);
  if (period.view === "month") return fmt(period.start, { month: "long", year: "numeric" });
  if (period.view === "day") return dayWords(period.start, "short", period.start.slice(0, 4) !== thisYear);
  const sameYear = period.start.slice(0, 4) === period.end.slice(0, 4);
  const yearOn = !sameYear || period.end.slice(0, 4) !== thisYear;
  const sameMonth = period.start.slice(0, 7) === period.end.slice(0, 7);
  const first = sameMonth ? fmt(period.start, { day: "numeric" }) : fmt(period.start, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const last = fmt(period.end, { day: "numeric", month: "short", ...(yearOn ? { year: "numeric" } : {}) });
  return `${first} – ${last}`;
}

/** [start, end) of the period as instants in the zone. */
export function periodBounds(period: Pick<Period, "start" | "end">, zone: string): { gte: Date; lt: Date } {
  const at = (key: string) => {
    const { year, month, day } = parseDayKey(key);
    return zonedTimeToUtc(year, month, day, 0, 0, zone);
  };
  return { gte: at(period.start), lt: at(addDays(period.end, 1)) };
}

/** The day as a DATE column value (midnight UTC of that calendar day), for Post.plannedDay and GeneratedContent.forDate. */
export function dayDate(day: string): Date {
  const { year, month, day: d } = parseDayKey(day);
  return new Date(Date.UTC(year, month - 1, d));
}

/** A DATE column value back as "YYYY-MM-DD". */
export function dateDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The posts of a period: made in it, posted in it, scheduled in it, or (without a time) planned for one of its days
 * after a missed day moved them. Combined with the other filters by the caller.
 */
export function periodPostWhere(period: Pick<Period, "start" | "end">, zone: string): Prisma.PostWhereInput {
  const window = periodBounds(period, zone);
  return {
    OR: [
      { createdAt: window },
      { publishedAt: window },
      { publishedAt: null, scheduledAt: window },
      { publishedAt: null, scheduledAt: null, plannedDay: { gte: dayDate(period.start), lt: dayDate(addDays(period.end, 1)) } },
    ],
  };
}

type Dated = { status: string; scheduledAt: string | null; publishedAt: string | null; createdAt: string; plannedDay?: string | null };

/** The day a post belongs to: when it went out, else when it goes out, else the day a missed day moved it to, else the day it was made. */
export function plannedDayOf(post: Dated, zone: string): string {
  const when = post.publishedAt ?? post.scheduledAt;
  if (when) return dayKey(new Date(when), zone);
  return post.plannedDay ?? dayKey(new Date(post.createdAt), zone);
}

/**
 * A week's or month's posts by day, in date order, only the days that have posts: each post under the day it belongs
 * to, or the day it was made when that day is outside the period (made this week, going out next week).
 */
export function groupByDay<T extends Dated>(posts: T[], period: Pick<Period, "start" | "end">, zone: string): { day: string; posts: T[] }[] {
  const byDay = new Map<string, T[]>();
  for (const p of posts) {
    let day = plannedDayOf(p, zone);
    if (!periodContains(period, day)) day = dayKey(new Date(p.createdAt), zone);
    if (!periodContains(period, day)) day = day < period.start ? period.start : period.end;
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const time = (p: T) => p.publishedAt ?? p.scheduledAt ?? p.createdAt;
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, posts: list.sort((a, b) => time(a).localeCompare(time(b))) }));
}

/** "Saturday 31 October" for a day heading (with the year when it is not this year). */
export function dayHeading(day: string, today: string): string {
  return dayWords(day, "long", day.slice(0, 4) !== today.slice(0, 4));
}
