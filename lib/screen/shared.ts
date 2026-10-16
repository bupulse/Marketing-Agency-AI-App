import { convertMinor, digitsOf, formatMoney, showMixed, showMoney, type MoneyDisplay } from "@/lib/money/display";
import { kigaliDayOf } from "@/lib/time/kigali";
// The sales room TV (/screen/<token>): the rules that need no server, shared by the screen, its data route, the admin
// page and the tests. Nothing here reads the database.

/** "Active now": used the dashboard in the last 5 minutes (User.lastSeenAt, lib/staff/heartbeat.ts). */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
/** The screen asks for new numbers this often. */
export const POLL_MS = 10_000;
/** ScreenLink.lastSeenAt is written at most this often per link. */
export const LINK_SEEN_EVERY_MS = 60_000;
/** Active celebration sounds at most. */
export const MAX_ACTIVE_SOUNDS = 10;
/** A sound file: an MP3 of at most 1 MB (the "sounds" bucket refuses anything bigger). */
export const SOUND_MAX_BYTES = 1024 * 1024;
export const SOUND_MAX_SECONDS = 5;

// "Today" and "this month" are Kigali's (lib/time/kigali.ts), like the Overview, Revenue and the leaderboard.
export { kigaliDayStart, kigaliMonthStart } from "@/lib/time/kigali";

/** What the screen shows. Names only: never an email address or a phone number. */
export type ScreenData = {
  at: string;
  activeNow: number;
  activeToday: number;
  /** Today's and this month's revenue in USD cents (the books), with the part received in RWF (exact RWF, its USD value). */
  revenue: { todayCents: number; monthCents: number; todayRwfMinor: number; todayRwfUsdCents: number; monthRwfMinor: number; monthRwfUsdCents: number };
  /** The admin default currency (Settings) and rates. The TV shows every amount in it until someone picks RWF, USD or EUR on the TV (kept in that browser). */
  money: MoneyDisplay;
  /** `totalDays`: the trial's length, for the "days left" pill (the Settings trial length when the start is unknown). */
  trials: { company: string; daysLeft: number; totalDays: number; agent: string | null }[];
  /** Revenue per Kigali day of this month so far (1st to today), USD cents with the RWF part. */
  daily: DayRevenue[];
  /** New companies per Kigali day, the last SIGNUP_DAYS days (oldest first, today last). */
  signups: { day: string; count: number }[];
  /** The month's sales goal in RWF (SALES_MONTHLY_GOAL_RWF, default 9,000,000). */
  goalRwf: number;
  /** USD cents with the parts received in RWF (exact in RWF on the TV). */
  leaderboard: { agent: string; ownCents: number; teamShareCents: number; totalCents: number; clients: number; ownRwf?: { rwfMinor: number; rwfUsdCents: number }; teamShareRwf?: { rwfMinor: number; rwfUsdCents: number }; totalRwf?: { rwfMinor: number; rwfUsdCents: number } }[];
  /** Active sounds in rotation order, with short-lived signed URLs. */
  sounds: { id: string; url: string }[];
  /** New confirmed payments since the cursor the screen sent, oldest first. */
  celebrations: Celebration[];
  /** Send this back as ?after= on the next poll. */
  cursor: string;
};

export type DayRevenue = { day: string; usdCents: number; rwfMinor: number; rwfUsdCents: number };

/** Days of sign-ups on the sparkline. */
export const SIGNUP_DAYS = 14;
export const DEFAULT_GOAL_RWF = 9_000_000;

/** The goal from SALES_MONTHLY_GOAL_RWF when it is a sound whole number of francs, else 9,000,000. */
export function goalRwfFrom(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 1e12 ? n : DEFAULT_GOAL_RWF;
}

/**
 * Pure: payments and refunds bucketed per Kigali day from `monthStart` to `now` (every day present, zero when quiet).
 * The RWF part of each day is kept, so the TV shows it exactly in RWF.
 */
export function dailyRevenue(entries: readonly { at: Date; usdCents: number; currency: string; localMinor: number | null }[], monthStart: Date, now: Date): DayRevenue[] {
  const days: DayRevenue[] = [];
  for (let t = monthStart.getTime(); t <= now.getTime(); t += 86_400_000) days.push({ day: kigaliDayOf(new Date(t)), usdCents: 0, rwfMinor: 0, rwfUsdCents: 0 });
  const index = new Map(days.map((d, i) => [d.day, i]));
  for (const e of entries) {
    if (e.at < monthStart || e.at > now) continue;
    const i = index.get(kigaliDayOf(e.at));
    if (i === undefined) continue;
    days[i].usdCents += e.usdCents;
    if (e.currency === "RWF" && e.localMinor !== null) {
      days[i].rwfMinor += e.localMinor;
      days[i].rwfUsdCents += e.usdCents;
    }
  }
  return days;
}

/** Pure: grouped counts per day turned into `n` days ending today (missing days are zero). */
export function fillDays(rows: readonly { day: string; count: number }[], today: string, n = SIGNUP_DAYS): { day: string; count: number }[] {
  const by = new Map(rows.map((r) => [r.day, r.count]));
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10);
    return { day, count: by.get(day) ?? 0 };
  });
}

/**
 * A mixed total (USD cents with an exact RWF part) as a number in the display currency's smallest unit, for charts:
 * the RWF part exact in RWF, the rest converted (the same rule as screenTotal). Null without a rate.
 */
export function mixedMinor(input: { usdCents: number; rwfMinor?: number; rwfUsdCents?: number }, d: MoneyDisplay): number | null {
  if (d.currency === "USD") return input.usdCents;
  if (d.currency === "RWF") {
    const rest = input.usdCents - (input.rwfUsdCents ?? 0);
    const restRwf = rest === 0 ? 0 : convertMinor(rest, "USD", "RWF", d.rates);
    return restRwf === null ? null : (input.rwfMinor ?? 0) + restRwf;
  }
  return convertMinor(input.usdCents, "USD", d.currency, d.rates);
}

/** The month so far against the goal: the RWF total (RWF part exact) and the share reached, 0 to 1 (more than 1 past it). */
export function goalProgress(revenue: { monthCents: number; monthRwfMinor: number; monthRwfUsdCents: number }, rates: MoneyDisplay["rates"], goalRwf: number): { rwf: number; share: number } {
  const rwf = mixedMinor({ usdCents: revenue.monthCents, rwfMinor: revenue.monthRwfMinor, rwfUsdCents: revenue.monthRwfUsdCents }, { currency: "RWF", rates }) ?? revenue.monthRwfMinor;
  return { rwf, share: goalRwf > 0 ? Math.max(0, rwf) / goalRwf : 0 };
}

/** The pill of a trial: the share of the trial still left, 0 (ends today) to 1. */
export const trialLeftShare = (daysLeft: number, totalDays: number) => (totalDays > 0 ? Math.min(1, Math.max(0, daysLeft / totalDays)) : 0);

/** Short money for chart labels: "RWF 1.2M", "$4.5k", "€980". */
export function compactMoney(minor: number, currency: string): string {
  const major = minor / 10 ** digitsOf(currency);
  const sign = currency === "USD" ? "$" : currency === "EUR" ? "€" : "RWF ";
  const abs = Math.abs(major);
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k` : `${Math.round(abs)}`;
  return `${major < 0 ? "-" : ""}${sign}${text}`;
}

/** Each agent's part of the board's total, 0 to 1 (for the bar in the leaderboard). */
export function shares(totals: readonly number[]): number[] {
  const sum = totals.reduce((s, t) => s + Math.max(0, t), 0);
  return totals.map((t) => (sum > 0 ? Math.max(0, t) / sum : 0));
}

/** A new payment: its USD value and what the client paid in their own currency (RWF for Mobile Money), when known. */
export type Celebration = { id: string; client: string; usdCents: number; localMinor: number | null; currency: string; agent: string | null };

/** An amount for the TV in the default currency: exact when it was paid in that currency, else "≈" converted. */
export function screenMoney(d: MoneyDisplay, usdCents: number, paid?: { minor: number | null; currency: string }): string {
  if (paid && paid.minor !== null && paid.currency.toUpperCase() === d.currency) return formatMoney(paid.minor, d.currency);
  return showMoney(usdCents, "USD", d).text;
}

/** A revenue total for the TV: the RWF part exact in RWF, only the rest converted. */
export const screenTotal = (d: MoneyDisplay, usdCents: number, rwfMinor: number, rwfUsdCents: number) => showMixed({ usdCents, rwfMinor, rwfUsdCents }, d).text;

const EMAIL = /[^\s@]+@[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
/** A run of digits, spaces and dashes with 9 digits or more (Rwandan numbers have 10, or 12 with +250). */
const hasPhone = (v: string) => (v.match(PHONE) ?? []).some((m) => m.replace(/\D/g, "").length >= 9);

/**
 * A name fit for a screen the whole room (and anyone walking past) can read: trimmed and shortened, and refused when
 * it holds an email address or a phone number (a company or a staff member without a name falls back to those
 * elsewhere in the app). Null when nothing safe is left.
 */
export function screenName(value: string | null | undefined, max = 40): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v || EMAIL.test(v) || hasPhone(v)) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

// ---- New-payment cursor ----
// A cursor is the newest money event the screen has seen: its creation time (ms) and id, "<ms>_<id>". Events after it
// (later time, or the same time and a greater id) are new. The first poll has no cursor and celebrates nothing.

export type Cursor = { at: Date; id: string };

export function parseCursor(raw: string | null | undefined): Cursor | null {
  const m = /^(\d{1,15})_([a-z0-9]{0,40})$/i.exec(raw ?? "");
  if (!m) return null;
  const at = new Date(Number(m[1]));
  return Number.isNaN(at.getTime()) ? null : { at, id: m[2] };
}

export const formatCursor = (c: Cursor) => `${c.at.getTime()}_${c.id}`;

/** True when an event comes after the cursor. */
export function isAfter(row: { createdAt: Date; id: string }, cursor: Cursor): boolean {
  const t = row.createdAt.getTime();
  const c = cursor.at.getTime();
  return t > c || (t === c && row.id > cursor.id);
}

/** The cursor after reading `rows` (oldest first): the last one, or the old cursor when nothing new came. */
export function advanceCursor(cursor: Cursor, rows: { createdAt: Date; id: string }[]): Cursor {
  const last = rows.filter((r) => isAfter(r, cursor)).at(-1);
  return last ? { at: last.createdAt, id: last.id } : cursor;
}

// ---- Sounds ----

/** The sound after `lastId` in rotation order (the first after the end, or when `lastId` is gone); null without sounds. */
export function nextSound<T extends { id: string }>(sounds: T[], lastId: string | null): T | null {
  if (sounds.length === 0) return null;
  const i = lastId ? sounds.findIndex((s) => s.id === lastId) : -1;
  return sounds[(i + 1) % sounds.length];
}

/** An MP3 by its first bytes: an ID3 tag or an MPEG audio frame. */
export function isMp3(head: Uint8Array): boolean {
  return (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
}

/** Why a sound upload is refused, or null when it may go ahead. Checked before the upload and again after it. */
export function soundUploadProblem(input: { bytes: number; rights: boolean; activeCount: number; head?: Uint8Array }): string | null {
  if (!input.rights) return "Tick the box to confirm you hold the rights to this sound.";
  if (!(input.bytes > 0)) return "That file is empty.";
  if (input.bytes > SOUND_MAX_BYTES) return "Sounds can be at most 1 MB.";
  if (input.activeCount >= MAX_ACTIVE_SOUNDS) return `There are already ${MAX_ACTIVE_SOUNDS} active sounds. Deactivate or delete one first.`;
  if (input.head && !isMp3(input.head)) return "That file is not an MP3.";
  return null;
}

/** "$1,234" (whole dollars) for the big numbers; "$12.50" when there are cents. */
export function usd(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}
