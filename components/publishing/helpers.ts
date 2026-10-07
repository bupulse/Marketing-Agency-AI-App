// Pure helpers for the calendar screens (no React), so they are easy to test.
import type { CalendarPost } from "@/lib/publishing/types";
import { addDays, addMonths, dayKey, parseDayKey, startOfMonth, startOfWeek } from "@/lib/publishing/time";

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${zone}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options });
    formatters.set(key, f);
  }
  return f;
}

export function formatTime(iso: string | Date, zone: string): string {
  return fmt(zone, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDateTime(iso: string | Date, zone: string): string {
  return fmt(zone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Mon, Oct 5" for a day key (a calendar date, no zone involved). */
export function formatDay(key: string, options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const { year, month, day } = parseDayKey(key);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function weekDays(anchor: string): string[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The weeks (Monday first) that cover the month of `anchor`. */
export function monthWeeks(anchor: string): string[][] {
  const first = startOfMonth(anchor);
  const last = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let start = startOfWeek(first); start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

export function rangeLabel(view: "week" | "month", anchor: string): string {
  if (view === "month") return formatDay(anchor, { month: "long", year: "numeric" });
  const days = weekDays(anchor);
  const sameMonth = days[0].slice(0, 7) === days[6].slice(0, 7);
  const start = formatDay(days[0], { month: "short", day: "numeric" });
  const end = formatDay(days[6], sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${start} – ${end}, ${days[6].slice(0, 4)}`;
}

/** Posts that have a time, grouped by their day in the business's zone, earliest first. */
export function groupByDay(posts: CalendarPost[], zone: string): Map<string, CalendarPost[]> {
  const map = new Map<string, CalendarPost[]>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const key = dayKey(new Date(post.scheduledAt), zone);
    map.set(key, [...(map.get(key) ?? []), post]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.scheduledAt as string).localeCompare(b.scheduledAt as string));
  return map;
}

export function snippet(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The browser's own time zone, for suggesting one when the business is still on UTC. */
export function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Every zone the browser knows, for the picker (a short fallback list on old browsers). */
export function allZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (supported) {
    try {
      return supported("timeZone");
    } catch {
      // fall through
    }
  }
  return ["UTC", "Africa/Kigali", "Africa/Lagos", "Africa/Nairobi", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "Europe/Paris", "Australia/Sydney"];
}
