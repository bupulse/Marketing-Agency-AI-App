// Paging and date grouping for the Designs page list. Pure, so it can be tested and used on the server or the client.

export const DESIGNS_PER_PAGE = 30;

export type DesignsRange = "all" | "7d" | "30d" | "month" | "custom";
export type DesignsQuery = { page: number; range: DesignsRange; from: string | null; to: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string | undefined | null): string | null {
  if (!value || !DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

/** Reads ?page=, ?range= and ?from=/?to= (YYYY-MM-DD). Anything invalid falls back to page 1, all dates. */
export function parseDesignsQuery(sp: { page?: string; range?: string; from?: string; to?: string }): DesignsQuery {
  const n = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
  const range: DesignsRange = sp.range === "7d" || sp.range === "30d" || sp.range === "month" || sp.range === "custom" ? sp.range : "all";
  if (range !== "custom") return { page, range, from: null, to: null };
  let from = validDay(sp.from);
  let to = validDay(sp.to);
  if (from && to && from > to) [from, to] = [to, from];
  return { page, range: from || to ? "custom" : "all", from, to };
}

/** Day key (YYYY-MM-DD) of a date in a time zone. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Start of a day in a time zone as an instant (works for any fixed or DST offset at that moment). */
function zonedDayStart(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime()));
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The createdAt bounds ({ gte, lt }) for a query, in the business's time zone; null bounds mean open. */
export function designsDateBounds(q: DesignsQuery, now: Date, timeZone: string): { gte: Date | null; lt: Date | null } {
  const today = dayKey(now, timeZone);
  switch (q.range) {
    case "7d":
      return { gte: zonedDayStart(addDays(today, -6), timeZone), lt: null };
    case "30d":
      return { gte: zonedDayStart(addDays(today, -29), timeZone), lt: null };
    case "month":
      return { gte: zonedDayStart(`${today.slice(0, 7)}-01`, timeZone), lt: null };
    case "custom":
      return { gte: q.from ? zonedDayStart(q.from, timeZone) : null, lt: q.to ? zonedDayStart(addDays(q.to, 1), timeZone) : null };
    default:
      return { gte: null, lt: null };
  }
}

/** "Today", "Yesterday" or a long date, for a group heading. */
export function dayLabel(day: string, now: Date, timeZone: string): string {
  const today = dayKey(now, timeZone);
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" }).format(d);
}

/** Groups items (newest first) by the day they were made, keeping their order. */
export function groupByDay<T extends { createdAt: string }>(items: T[], now: Date, timeZone: string): { day: string; label: string; items: T[] }[] {
  const groups: { day: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayKey(new Date(item.createdAt), timeZone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, label: dayLabel(day, now, timeZone), items: [item] });
  }
  return groups;
}

/** Page numbers to show: first, last, current ±1, with null for a gap ("…"). */
export function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const p of sorted) {
    if (out.length && (out[out.length - 1] as number) < p - 1) out.push(null);
    out.push(p);
  }
  return out;
}

/** The query string for a page/filter, keeping the other params. */
export function designsHref(base: string, q: DesignsQuery, change: Partial<DesignsQuery>, extra: Record<string, string | undefined> = {}): string {
  const next = { ...q, ...change };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  if (next.range !== "all") params.set("range", next.range);
  if (next.range === "custom") {
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
  }
  if (next.page > 1) params.set("page", String(next.page));
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}
