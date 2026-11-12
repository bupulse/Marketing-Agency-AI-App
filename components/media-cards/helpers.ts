// Pure helpers of the media cards (tests/media-cards/helpers.test.ts). Client-safe, no React.
import type { Ratio, StatusKey } from "./types";

/** "0:22", "1:05", "1:02:09"; null for no length. */
export function durationLabel(ms: number | null | undefined): string | null {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Player clock for seconds: "0:07". */
export const clock = (seconds: number) => durationLabel(Math.max(0, seconds) * 1000) ?? "0:00";

export type CaptionToken = { type: "text" | "tag" | "mention" | "link"; value: string };

const TOKEN = /(#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+[\p{L}\p{N}_]|https?:\/\/[^\s]+)/gu;

/** A caption cut into plain text, #hashtags, @mentions and links, so the card can colour them. Joining the values gives the text back. */
export function splitCaption(text: string): CaptionToken[] {
  const out: CaptionToken[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: "text", value: text.slice(last, i) });
    const v = m[0];
    out.push({ type: v.startsWith("#") ? "tag" : v.startsWith("@") ? "mention" : "link", value: v });
    last = i + v.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** The hashtags to show after the caption: the post's own list, with a leading "#", minus the ones the text already has. */
export function extraHashtags(text: string, hashtags: readonly string[] | null | undefined): string[] {
  const inText = new Set(splitCaption(text).filter((t) => t.type === "tag").map((t) => t.value.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of hashtags ?? []) {
    const tag = raw.trim().replace(/^#*/, "#");
    if (tag.length < 2) continue;
    const key = tag.toLowerCase();
    if (inText.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * Instagram's feed caption: the first `max` characters, cut at a word, with whether there is more ("… more"). Line breaks
 * after the second line also count as more, like the app.
 */
export function truncateCaption(text: string, max = 125, maxLines = 2): { text: string; more: boolean } {
  const clean = text.trim();
  const lines = clean.split("\n");
  let cut = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : clean;
  if (cut.length > max) {
    const slice = cut.slice(0, max);
    const space = slice.search(/\s\S*$/);
    cut = (space > max * 0.6 ? slice.slice(0, space) : slice).replace(/[\s.,;:!?-]+$/u, "");
  }
  return { text: cut, more: cut.length < clean.length };
}

const PARTS = (date: Date, timeZone: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const dayNumber = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000;

/**
 * When a post went out or goes out, short, in the business's time zone.
 * Past: "Just now", "5m", "3h", "Yesterday", "4d", "12 Nov", "12 Nov 2025". Future: "In 20 min", "Today 12:30",
 * "Tomorrow 12:30", "Fri 12:30" (this week), "14 Nov, 12:30".
 */
export function timeLabel(iso: string | Date, now: Date = new Date(), timeZone = "Africa/Kigali"): string {
  const at = typeof iso === "string" ? new Date(iso) : iso;
  const diff = at.getTime() - now.getTime();
  const a = PARTS(at, timeZone);
  const n = PARTS(now, timeZone);
  const days = dayNumber(a.day) - dayNumber(n.day);
  if (diff <= 0) {
    const mins = Math.floor(-diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60 && days === 0) return `${Math.floor(mins / 60)}h`;
    if (days === -1) return "Yesterday";
    if (days > -7) return `${-days}d`;
    const sameYear = a.day.slice(0, 4) === n.day.slice(0, 4);
    return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
  }
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `In ${mins} min`;
  if (days === 0) return `Today ${a.time}`;
  if (days === 1) return `Tomorrow ${a.time}`;
  if (days < 7) return `${new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(at)} ${a.time}`;
  return `${new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(at)}, ${a.time}`;
}

/** The pill for a Post row's status (prisma PostStatus) and whether it goes out as a reminder. */
export function postStatusKey(status: string, notify = false): StatusKey {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "PENDING_APPROVAL":
      return "pending";
    case "SCHEDULED":
      return notify ? "reminder" : "scheduled";
    case "PUBLISHING":
      return "publishing";
    case "PUBLISHED":
      return "posted";
    case "NEEDS_ACTION":
      return "reminder";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    case "CANCELLED":
      return "cancelled";
    default:
      return "draft";
  }
}

/** The pill for a creator campaign's status (DRAFT | LIVE | PAUSED | ENDED). */
export function campaignStatusKey(status: string): StatusKey {
  return ({ LIVE: "live", PAUSED: "paused", ENDED: "ended" } as Record<string, StatusKey>)[status] ?? "draft";
}

/** CSS aspect-ratio for a ratio string; unknown ratios are 9:16 (videos) or 4:5 (posts). */
export function aspectRatio(ratio: string | null | undefined, fallback: Ratio = "9:16"): string {
  const r = ratio && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(ratio) ? ratio : fallback;
  const [w, h] = r.split(":");
  return `${w} / ${h}`;
}

/** Whether a ratio is wider than tall. */
export const isLandscape = (ratio: string | null | undefined) => {
  const [w, h] = (ratio ?? "").split(":").map(Number);
  return !!w && !!h && w > h;
};

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: currency === "RWF" ? 0 : 2 })
      .format(amount)
      .replace(/^([A-Z]{3})\s?(.*)$/, "$2 $1");
  } catch {
    return `${amount.toLocaleString("en-GB")} ${currency}`;
  }
};

/**
 * A product's price line from its Business info fields (prisma Product: priceModel, priceAmount in the smallest unit,
 * currency). "25,000 RWF", "From 6,000 RWF", "15,000 RWF / month", "Price on request".
 */
export function priceLabel(model: string | null | undefined, amount: number | null | undefined, currency: string): string {
  if (amount == null || model === "ON_REQUEST") return "Price on request";
  const minor = currency === "RWF" || currency === "UGX" || currency === "BIF" ? 1 : 100;
  const v = money(amount / minor, currency);
  switch (model) {
    case "FROM":
      return `From ${v}`;
    case "PER_MONTH":
      return `${v} / month`;
    case "PER_YEAR":
      return `${v} / year`;
    case "PER_UNIT":
      return `${v} each`;
    default:
      return v;
  }
}

/** "1.2K", "34K", "1.5M" for views and counts. */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** 0..1 of a value against a target (0 when there is no target). */
export const progressOf = (value: number, target: number | null | undefined) => (target && target > 0 ? Math.min(1, Math.max(0, value / target)) : 0);

/** stroke-dasharray / offset for a progress ring of radius r. */
export function ringDash(progress: number, r: number): { dasharray: string; dashoffset: string } {
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  return { dasharray: c.toFixed(2), dashoffset: (c * (1 - p)).toFixed(2) };
}

/** "12 – 30 Nov", "28 Nov – 4 Dec", "28 Dec 2026 – 4 Jan 2027" for date-only values ("YYYY-MM-DD" or ISO). */
export function dateRangeLabel(start: string, end: string): string {
  const a = new Date(start.slice(0, 10) + "T12:00:00Z");
  const b = new Date(end.slice(0, 10) + "T12:00:00Z");
  const f = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(d);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${f(a, { day: "numeric", month: "short", year: "numeric" })} – ${f(b, { day: "numeric", month: "short", year: "numeric" })}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${f(a, { day: "numeric", month: "short" })} – ${f(b, { day: "numeric", month: "short" })}`;
  return `${a.getUTCDate()} – ${f(b, { day: "numeric", month: "short" })}`;
}

/** Where today falls in a date-only range: "Starts in 3 days", "Day 4 of 18", "Ended". */
export function campaignDayLabel(start: string, end: string, today: string): string {
  const s = dayNumber(start.slice(0, 10));
  const e = dayNumber(end.slice(0, 10));
  const t = dayNumber(today.slice(0, 10));
  if (t < s) return s - t === 1 ? "Starts tomorrow" : `Starts in ${s - t} days`;
  if (t > e) return "Ended";
  return `Day ${t - s + 1} of ${e - s + 1}`;
}

/** The first letter for an avatar without a picture ("LinkedIn · Acme" gives "A"). */
export const initialOf = (name: string) => (name.split(" · ").pop() ?? name).trim()[0]?.toUpperCase() ?? "?";
