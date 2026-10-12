// Opening hours as data: a list of schedules, each a set of days with one time range (or 24 hours). Times are
// wall-clock "HH:MM" in the business's own zone (Business.timezone). Pure, so the form, the server action and the
// chat prompt share one behaviour. Days that no schedule covers are closed, once at least one schedule exists.
import { localParts, safeZone } from "@/lib/autopilot/timezone";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAYS)[number];

export const DAY_SHORT: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const DAY_LONG: Record<DayKey, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export type Schedule = {
  days: DayKey[];
  /** "08:00". Ignored when allDay. */
  open: string;
  /** "18:00". Before `open` only when overnight. */
  close: string;
  allDay?: boolean;
  /** Closes after midnight: "22:00" to "02:00" the next morning. */
  overnight?: boolean;
};

export const MAX_SCHEDULES = 7;
/** The slider moves in 15 minute steps from 00:00; the last stop is 23:59 (closing at the end of the day). */
export const STEP_MINUTES = 15;
export const LAST_MINUTE = 23 * 60 + 59;
export const SLIDER_STOPS = 24 * (60 / STEP_MINUTES); // stops 0..96, 96 = 23:59

export const DEFAULT_SCHEDULE: Schedule = { days: ["mon", "tue", "wed", "thu", "fri"], open: "08:00", close: "18:00" };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value: string): boolean {
  return TIME.test(value);
}

export function toMinutes(time: string): number {
  const m = TIME.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function fromMinutes(minutes: number): string {
  const m = Math.max(0, Math.min(LAST_MINUTE, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Slider stop of a time: 08:00 -> 32, 23:59 -> 96. Off-step times snap down. */
export function stopOf(time: string): number {
  const m = toMinutes(time);
  return m >= LAST_MINUTE ? SLIDER_STOPS : Math.floor(m / STEP_MINUTES);
}

export function timeOfStop(stop: number): string {
  const s = Math.max(0, Math.min(SLIDER_STOPS, Math.round(stop)));
  return s === SLIDER_STOPS ? fromMinutes(LAST_MINUTE) : fromMinutes(s * STEP_MINUTES);
}

export function sortDays(days: readonly DayKey[]): DayKey[] {
  return DAYS.filter((d) => days.includes(d));
}

/** "Mon–Fri", "Mon, Wed, Fri", "Mon–Wed, Sat". */
export function dayRanges(days: readonly DayKey[]): string {
  const idx = sortDays(days).map((d) => DAYS.indexOf(d));
  const runs: [number, number][] = [];
  for (const i of idx) {
    const last = runs.at(-1);
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs
    .map(([a, b]) => (a === b ? DAY_SHORT[DAYS[a]] : b === a + 1 ? `${DAY_SHORT[DAYS[a]]}, ${DAY_SHORT[DAYS[b]]}` : `${DAY_SHORT[DAYS[a]]}–${DAY_SHORT[DAYS[b]]}`))
    .join(", ");
}

/** "08:00–18:00", "22:00–02:00 (next day)", "open 24 hours". */
export function timeRange(s: Schedule, sep = "–"): string {
  if (s.allDay) return "open 24 hours";
  return `${s.open}${sep}${s.close}${s.overnight ? " (next day)" : ""}`;
}

/** Days not covered by any schedule. */
export function closedDays(schedules: readonly Schedule[]): DayKey[] {
  const used = new Set(schedules.flatMap((s) => s.days));
  return DAYS.filter((d) => !used.has(d));
}

/** "Mon–Fri 08:00–18:00 · Sat 09:00–14:00 · Sun closed". Empty when there are no schedules. */
export function summarizeHours(schedules: readonly Schedule[]): string {
  const rows = schedules.filter((s) => s.days.length);
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => DAYS.indexOf(sortDays(a.days)[0]) - DAYS.indexOf(sortDays(b.days)[0]));
  const parts = sorted.map((s) => `${dayRanges(s.days)} ${timeRange(s)}`);
  const closed = closedDays(rows);
  if (closed.length) parts.push(`${dayRanges(closed)} closed`);
  return parts.join(" · ");
}

/** Problems with a list of schedules, keyed like the form ("0.days", "1.close"). Empty when valid. */
export function scheduleErrors(schedules: readonly Schedule[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const add = (key: string, message: string) => {
    if (!(key in errors)) errors[key] = message;
  };
  if (schedules.length > MAX_SCHEDULES) add("form", `Add up to ${MAX_SCHEDULES} sets of hours.`);
  const owner = new Map<DayKey, number>();
  schedules.forEach((s, i) => {
    if (!s.days.length) add(`${i}.days`, "Choose at least one day, or remove these hours.");
    for (const d of s.days) {
      const first = owner.get(d);
      if (first !== undefined && first !== i) add(`${i}.days`, `${DAY_LONG[d]} is already in other hours. Each day can only be in one.`);
      else owner.set(d, i);
    }
    if (s.allDay) return;
    if (!isTime(s.open)) add(`${i}.open`, "Choose an opening time.");
    if (!isTime(s.close)) add(`${i}.close`, "Choose a closing time.");
    if (!isTime(s.open) || !isTime(s.close)) return;
    const open = toMinutes(s.open);
    const close = toMinutes(s.close);
    if (s.overnight && close >= open) add(`${i}.close`, "For hours past midnight, the closing time must be earlier than the opening time.");
    if (!s.overnight && close <= open) add(`${i}.close`, "The closing time must be after the opening time. If you close after midnight, tick “Closes after midnight”.");
  });
  // Late hours that run into the next morning must not overlap that morning's own hours.
  schedules.forEach((s, i) => {
    if (s.allDay || !s.overnight || !isTime(s.close)) return;
    const until = toMinutes(s.close);
    for (const d of s.days) {
      const next = DAYS[(DAYS.indexOf(d) + 1) % 7];
      const j = owner.get(next);
      if (j === undefined) continue;
      const other = schedules[j];
      if (other.allDay || toMinutes(other.open) < until) {
        add(`${i}.close`, `These hours run into ${DAY_LONG[next]} morning and overlap its opening time.`);
        return;
      }
    }
  });
  return errors;
}

// ---- open now / next opening ----

const DAY = 24 * 60;
const WEEK = 7 * DAY;

/** Open intervals in minutes from Monday 00:00, for the week before, this week and the next, merged. */
function intervals(schedules: readonly Schedule[]): [number, number][] {
  const base: [number, number][] = [];
  for (const s of schedules) {
    for (const d of s.days) {
      const start = DAYS.indexOf(d) * DAY;
      if (s.allDay) base.push([start, start + DAY]);
      else if (isTime(s.open) && isTime(s.close)) {
        const open = toMinutes(s.open);
        // Closing at 23:59 means open to the end of the day.
        const close = toMinutes(s.close) === LAST_MINUTE ? DAY : toMinutes(s.close);
        const end = s.overnight ? close + DAY : close;
        if (end > open) base.push([start + open, start + end]);
      }
    }
  }
  const all = [-WEEK, 0, WEEK].flatMap((offset) => base.map(([a, b]) => [a + offset, b + offset] as [number, number])).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of all) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export type OpenStatus =
  | { known: false }
  | { known: true; open: true; always: true }
  | { known: true; open: boolean; always?: false; /** When it closes (open) or next opens (closed); missing when never. */ change?: { dayOffset: number; day: DayKey; time: string } };

/** Open or closed at `now` in the business's zone, and when that changes. Unknown when there are no hours. */
export function openStatus(schedules: readonly Schedule[], timeZone: string | null | undefined, now: Date = new Date()): OpenStatus {
  const rows = schedules.filter((s) => s.days.length);
  if (!rows.length) return { known: false };
  const p = localParts(now, safeZone(timeZone));
  const t = p.weekday * DAY + p.hour * 60 + p.minute;
  const list = intervals(rows);
  const at = (m: number) => {
    const day = Math.floor(m / DAY);
    return { dayOffset: day - p.weekday, day: DAYS[((day % 7) + 7) % 7], time: fromMinutes(m - day * DAY) };
  };
  const current = list.find(([a, b]) => a <= t && t < b);
  if (current) {
    if (current[1] - current[0] >= 2 * WEEK) return { known: true, open: true, always: true };
    // Open until the end of a day reads as "until 23:59", not "until 00:00 tomorrow".
    const end = current[1] % DAY === 0 ? current[1] - 1 : current[1];
    return { known: true, open: true, change: at(end) };
  }
  const next = list.find(([a]) => a > t);
  return { known: true, open: false, change: next ? at(next[0]) : undefined };
}

function when(change: { dayOffset: number; day: DayKey }): string {
  if (change.dayOffset === 0) return "today";
  if (change.dayOffset === 1) return "tomorrow";
  return `on ${DAY_LONG[change.day]}`;
}

/** "We're open now until 18:00." / "We're closed now. We open tomorrow at 08:00." English; the chat translates it. */
export function describeOpenStatus(status: OpenStatus): string {
  if (!status.known) return "";
  if (status.open && status.always) return "We're open 24 hours, every day.";
  const c = status.change;
  if (status.open) return c ? `We're open now until ${c.time}${c.dayOffset === 0 ? "" : ` ${when(c)}`}.` : "We're open now.";
  return c ? `We're closed now. We open ${when(c)} at ${c.time}.` : "We're closed now.";
}

// ---- old free-text hours ----

const DAY_WORDS: [RegExp, DayKey][] = [
  [/^mon(day)?$/, "mon"],
  [/^tue(s|sday)?$/, "tue"],
  [/^wed(nesday)?$/, "wed"],
  [/^thu(r|rs|rsday)?$/, "thu"],
  [/^fri(day)?$/, "fri"],
  [/^sat(urday)?$/, "sat"],
  [/^sun(day)?$/, "sun"],
];

function dayWord(word: string): DayKey | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  return DAY_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
}

function parseClock(text: string): number | null {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59 || h > 24) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h === 24) return LAST_MINUTE;
  return h * 60 + min;
}

/**
 * Best-effort reading of old free-text hours ("Mon to Sat, 9am to 6pm", "Mon-Fri 08:00-18:00; Sat 9-14") into
 * schedules, so the editor can start from them. Null when any part is unclear: the text then stays as a note.
 */
export function parseLegacyHours(text: string | null | undefined): Schedule[] | null {
  const src = (text ?? "").trim();
  if (!src) return null;
  const out: Schedule[] = [];
  const segments = src.split(/[;\n|·]|,(?=\s*(?:mon|tue|wed|thu|fri|sat|sun))/i).map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const m = /^([a-z.]+)(?:\s*(?:-|–|—|to|until|through)\s*([a-z.]+))?\s*[,:]?\s*(.+)$/i.exec(segment);
    if (!m) return null;
    const from = dayWord(m[1]);
    const to = m[2] ? dayWord(m[2]) : from;
    if (!from || !to) return null;
    const a = DAYS.indexOf(from);
    const b = DAYS.indexOf(to);
    const days = a <= b ? DAYS.slice(a, b + 1) : [...DAYS.slice(a), ...DAYS.slice(0, b + 1)];
    const rest = m[3].trim();
    if (/^closed$/i.test(rest)) continue;
    if (/^(open\s+)?24\s*(h|hours|hrs)$/i.test(rest)) {
      out.push({ days: [...days], open: "00:00", close: fromMinutes(LAST_MINUTE), allDay: true });
      continue;
    }
    const t = /^(.+?)\s*(?:-|–|—|to|until)\s*(.+)$/i.exec(rest);
    if (!t) return null;
    const open = parseClock(t[1]);
    let close = parseClock(t[2]);
    // "9-6" without am/pm means 9:00 to 18:00, not past midnight.
    if (open !== null && close !== null && close < open && close < 12 * 60 && !/[ap]\.?m/i.test(rest) && close + 12 * 60 > open) close += 12 * 60;
    if (open === null || close === null || open === close) return null;
    out.push({ days: [...days], open: fromMinutes(open), close: fromMinutes(close), overnight: close < open || undefined });
  }
  if (!out.length || Object.keys(scheduleErrors(out)).length) return null;
  return out;
}
