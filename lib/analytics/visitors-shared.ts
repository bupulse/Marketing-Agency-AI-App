// Pure helpers for the visitor analytics page (support app → Analytics) and the "old method" notes in Admin. No I/O.
// Days are UTC calendar days, like the visitor hash (it changes at 00:00 UTC) and every Admin analytics page.
import { addDays, daysInMonth, eachDay, pct } from "./math";
import { utcDay } from "./collect";

export type Grouping = "day" | "week" | "month";
export type PresetKey = "today" | "7d" | "30d" | "month" | "by-month" | "custom";
export type VisitorPeriod = { key: PresetKey; from: string; to: string; by: Grouping; month: string | null; label: string };

export const PRESETS: { key: Exclude<PresetKey, "by-month" | "custom">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
];

/** The longest period the page reads (the Admin analytics limit). */
export const MAX_PERIOD_DAYS = 400;
/** How many months the "by month" list offers. */
export const MONTHS_LISTED = 13;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const isDay = (s: unknown): s is string => typeof s === "string" && DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && utcDay(new Date(`${s}T00:00:00Z`)) === s;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_YEAR_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const at = (day: string) => new Date(`${day}T00:00:00Z`);

/** "9 Nov" (or "9 Nov 2025" when `withYear`). */
export const dayLabel = (day: string, withYear = false) => (withYear ? DAY_YEAR_FMT : DAY_FMT).format(at(day));
/** "November 2026". */
export const monthLabel = (month: string) => MONTH_FMT.format(at(`${month}-01`));

/** The months offered in the "by month" list, newest first ("2026-11", "2026-10", ...). */
export function recentMonths(now = new Date(), count = MONTHS_LISTED): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

const defaultGrouping = (from: string, to: string): Grouping => {
  const days = eachDay(from, to).length;
  return days > 180 ? "month" : days > 62 ? "week" : "day";
};

/**
 * The period from the page's address: ?p=today|7d|30d|month, ?m=2026-10 (one month), or ?from=&to= (the date picker),
 * plus ?by=day|week|month. Anything unreadable falls back to the last 7 days; dates are clamped to today and to
 * MAX_PERIOD_DAYS.
 */
export function parseVisitorPeriod(sp: Record<string, string | string[] | undefined>, now = new Date()): VisitorPeriod {
  const today = utcDay(now);
  const p = one(sp.p);
  const m = one(sp.m);
  const f = one(sp.from);
  const t = one(sp.to);
  let key: PresetKey = "7d";
  let from = addDays(today, -6);
  let to = today;
  let month: string | null = null;
  if (p === "today") {
    key = "today";
    from = today;
  } else if (p === "30d") {
    key = "30d";
    from = addDays(today, -29);
  } else if (p === "month") {
    key = "month";
    from = `${today.slice(0, 7)}-01`;
  } else if (typeof m === "string" && MONTH_RE.test(m) && recentMonths(now).includes(m)) {
    key = "by-month";
    month = m;
    from = `${m}-01`;
    to = `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;
  } else if (isDay(f) || isDay(t)) {
    key = "custom";
    from = isDay(f) ? f : isDay(t) ? t : from;
    to = isDay(t) ? t : today;
    if (from > to) [from, to] = [to, from];
  }
  if (to > today) to = today;
  if (from > to) from = to;
  const min = addDays(to, -(MAX_PERIOD_DAYS - 1));
  if (from < min) from = min;
  const byRaw = one(sp.by);
  const by: Grouping = byRaw === "day" || byRaw === "week" || byRaw === "month" ? byRaw : defaultGrouping(from, to);
  const sameYear = from.slice(0, 4) === to.slice(0, 4) && from.slice(0, 4) === today.slice(0, 4);
  const label =
    key === "today" ? `Today, ${dayLabel(today)}`
    : key === "by-month" && month ? monthLabel(month)
    : from === to ? dayLabel(from, !sameYear)
    : `${dayLabel(from, !sameYear)} – ${dayLabel(to, !sameYear)}`;
  return { key, from, to, by, month, label };
}

// --- Counting method ----------------------------------------------------------------------------------------------

/** How a day's visitors were counted: "new" (IP + device), "old" (one per browser), "mixed" (the day of the switch). */
export type DayMethod = "new" | "old" | "mixed" | "none";

/** From the day's roll-up: all views (visits) and those counted the new way (visits_v2, missing on days rolled before). */
export function dayMethod(visits: number, visitsV2: number | null | undefined): DayMethod {
  if (!visits) return "none";
  const v2 = visitsV2 ?? 0;
  if (v2 >= visits) return "new";
  return v2 > 0 ? "mixed" : "old";
}

/** The last day in the list counted (even partly) the old way, or null when every day with visits is new. */
export function lastOldMethodDay(days: { date: string; method: DayMethod }[]): string | null {
  let last: string | null = null;
  for (const d of days) if ((d.method === "old" || d.method === "mixed") && (!last || d.date > last)) last = d.date;
  return last;
}

/** The plain-language note shown under a visitor count that includes old-method days, or null. */
export function oldMethodNote(lastOld: string | null): string | null {
  if (!lastOld) return null;
  return `Days up to ${dayLabel(lastOld, true)} are marked "old method": each browser counted as a visitor, so one person on two browsers counted twice. Later days count one visitor per device.`;
}

// --- Series ---------------------------------------------------------------------------------------------------------

export type DayPoint = { date: string; visitors: number; views: number; method: DayMethod };
export type SeriesPoint = { key: string; label: string; from: string; to: string; visitors: number; views: number; oldMethod: boolean };

/** Monday of the day's ISO week. */
export function weekStart(day: string): string {
  const dow = at(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/**
 * Daily points grouped by day, week (Monday to Sunday) or month, for every day of the period (missing days are 0).
 * Visitors are summed: the visitor hash changes every day, so a person who comes on three days counts three times in a
 * week. A bucket with any old-method day is marked oldMethod.
 */
export function groupSeries(points: DayPoint[], from: string, to: string, by: Grouping): SeriesPoint[] {
  const byDay = new Map(points.map((p) => [p.date, p]));
  const out = new Map<string, SeriesPoint>();
  for (const date of eachDay(from, to)) {
    const p = byDay.get(date);
    const key = by === "day" ? date : by === "week" ? weekStart(date) : date.slice(0, 7);
    let s = out.get(key);
    if (!s) {
      const label = by === "day" ? dayLabel(date) : by === "week" ? `Week of ${dayLabel(key)}` : `${SHORT_MONTH_FMT.format(at(date))} ${date.slice(0, 4)}`;
      s = { key, label, from: date, to: date, visitors: 0, views: 0, oldMethod: false };
      out.set(key, s);
    }
    s.to = date;
    if (p) {
      s.visitors += p.visitors;
      s.views += p.views;
      if (p.method === "old" || p.method === "mixed") s.oldMethod = true;
    }
  }
  return [...out.values()];
}

// --- Funnel ---------------------------------------------------------------------------------------------------------

export type FunnelCounts = { visitors: number; quotes: number; chats: number; signups: number; paid: number };
export type FunnelStepView = { key: keyof FunnelCounts; label: string; hint: string; count: number; ofPreviousPct: number | null };

const FUNNEL: { key: keyof FunnelCounts; label: string; hint: string }[] = [
  { key: "visitors", label: "Visitors", hint: "People on the website (one per device per day)" },
  { key: "quotes", label: "Asked for a quote", hint: "“Get a free quote” forms sent" },
  { key: "chats", label: "Started a chat", hint: "Chats started from the website" },
  { key: "signups", label: "Signed up", hint: "New BuPulse accounts" },
  { key: "paid", label: "Paid", hint: "Companies that started paying (card or Mobile Money)" },
];

/** The funnel's steps with "% of the step before". Each step counts what happened in the period on its own. */
export function funnelSteps(c: FunnelCounts): FunnelStepView[] {
  return FUNNEL.map((s, i) => ({ ...s, count: c[s.key], ofPreviousPct: i === 0 ? null : pct(c[s.key], c[FUNNEL[i - 1].key]) }));
}

// --- Labels ---------------------------------------------------------------------------------------------------------

const SOURCE_NAMES: Record<string, string> = {
  direct: "Direct (typed the address, a bookmark or an app)",
  google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", yahoo: "Yahoo", baidu: "Baidu", yandex: "Yandex",
  facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp", x: "X (Twitter)", linkedin: "LinkedIn",
  youtube: "YouTube", tiktok: "TikTok", reddit: "Reddit", pinterest: "Pinterest", chatgpt: "ChatGPT",
  perplexity: "Perplexity", claude: "Claude", producthunt: "Product Hunt",
};

/** A traffic source for people: "Google", "Direct (…)", a website's address, or a campaign's utm_source as it is. */
export function sourceLabel(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

let regions: Intl.DisplayNames | null = null;
/** "Rwanda" for "RW"; "Unknown" when there is no country. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "45 s", "3 min 20 s", "–" when nothing was measured. */
export function durationLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}
