// Free demo slots from the owner's weekly availability. Pure: no database, no clock of its own, so the booking page,
// the booking action and the tests all agree on what is free. Times are kept in one IANA zone (Africa/Kigali by
// default) and converted with Intl, so a zone with daylight saving would still come out right.

export const DEMO_TIME_ZONE = "Africa/Kigali";
export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_BUFFER_MINUTES = 15;
/** Bookings, reschedules and cancellations must be at least this far ahead. */
export const MIN_LEAD_MINUTES = 120;
/** How far ahead a client can book. */
export const BOOKING_WINDOW_DAYS = 14;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type AvailabilityWindow = { weekday: number; startMinute: number; endMinute: number };
export type Busy = { startsAt: Date; endsAt: Date };

export type SlotOptions = {
  windows: AvailabilityWindow[];
  slotMinutes?: number;
  bufferMinutes?: number;
  /** Days with no slots, as YYYY-MM-DD in the zone. */
  blockedDates?: string[];
  /** Bookings that are live (status "booked"). */
  busy?: Busy[];
  from: Date;
  days?: number;
  minLeadMinutes?: number;
  timeZone?: string;
};

const MINUTE = 60_000;
const DAY = 86_400_000;

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "09:30" -> 570; null for anything else. */
export function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function minutesToHm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts of an instant in a zone. */
export function partsInZone(date: Date, timeZone = DEMO_TIME_ZONE): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) out[p.type] = p.value;
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day), hour: Number(out.hour) % 24, minute: Number(out.minute), weekday: WEEKDAYS[out.weekday] ?? 0 };
}

export function ymdInZone(date: Date, timeZone = DEMO_TIME_ZONE): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes the zone is ahead of UTC at that instant (Kigali: 120). */
export function zoneOffsetMinutes(date: Date, timeZone = DEMO_TIME_ZONE): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / MINUTE) * MINUTE) / MINUTE);
}

/** The instant of a wall-clock time (a date and minutes after midnight) in a zone. */
export function zonedToUtc(ymd: string, minute: number, timeZone = DEMO_TIME_ZONE): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minute);
  // Two passes: the offset at the guessed instant, then at the corrected one (only differs across a DST switch).
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * MINUTE;
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * MINUTE;
  return new Date(guess);
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function overlaps(start: number, end: number, busy: Busy[], bufferMs: number): boolean {
  return busy.some((b) => start - bufferMs < b.endsAt.getTime() && end + bufferMs > b.startsAt.getTime());
}

/**
 * Every free slot from `from` over the next `days` days, as instants in order. A slot is free when it sits inside a
 * weekly window, its day is not blocked, it starts at least `minLeadMinutes` ahead, and no live booking is within
 * `bufferMinutes` of it on either side.
 */
export function freeSlots(opts: SlotOptions): Date[] {
  const timeZone = opts.timeZone ?? DEMO_TIME_ZONE;
  const slotMinutes = opts.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const bufferMs = (opts.bufferMinutes ?? DEFAULT_BUFFER_MINUTES) * MINUTE;
  const blocked = new Set(opts.blockedDates ?? []);
  const busy = opts.busy ?? [];
  const earliest = opts.from.getTime() + (opts.minLeadMinutes ?? MIN_LEAD_MINUTES) * MINUTE;
  const days = opts.days ?? BOOKING_WINDOW_DAYS;
  const out: Date[] = [];
  let ymd = ymdInZone(opts.from, timeZone);
  // Exactly `days` days, today (in the zone) included.
  for (let i = 0; i < days; i++, ymd = addDaysYmd(ymd, 1)) {
    if (blocked.has(ymd)) continue;
    const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    for (const w of opts.windows.filter((x) => x.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute)) {
      for (let m = w.startMinute; m + slotMinutes <= w.endMinute; m += slotMinutes) {
        const start = zonedToUtc(ymd, m, timeZone);
        const s = start.getTime();
        if (s < earliest) continue;
        if (overlaps(s, s + slotMinutes * MINUTE, busy, bufferMs)) continue;
        out.push(start);
      }
    }
  }
  return out;
}

/** Whether one start time is a free slot under the same rules (the booking action checks this before writing). */
export function isSlotFree(start: Date, opts: SlotOptions): boolean {
  return freeSlots({ ...opts, from: opts.from }).some((d) => d.getTime() === start.getTime());
}

/** Parts of a date as words, built by hand so the text is the same on Node and Cloudflare (ICU versions differ in punctuation). */
function words(date: Date, timeZone: string, locale: string) {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), day: get("day"), month: get("month"), year: get("year"), time: `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}` };
}

/** "Tuesday 14 October 2026, 10:00" in the zone. */
export function formatSlot(date: Date, timeZone = DEMO_TIME_ZONE, locale = "en-GB"): string {
  const w = words(date, timeZone, locale);
  return `${w.weekday} ${w.day} ${w.month} ${w.year}, ${w.time}`;
}

/** "10:00" in the zone. */
export function formatSlotTime(date: Date, timeZone = DEMO_TIME_ZONE, locale = "en-GB"): string {
  return words(date, timeZone, locale).time;
}

/** "Tuesday 14 October" in the zone. */
export function formatSlotDay(date: Date, timeZone = DEMO_TIME_ZONE, locale = "en-GB"): string {
  const w = words(date, timeZone, locale);
  return `${w.weekday} ${w.day} ${w.month}`;
}

/** Groups slots by their day in the zone, in order, for the picker. */
export function groupSlotsByDay(slots: Date[], timeZone = DEMO_TIME_ZONE): { ymd: string; label: string; slots: Date[] }[] {
  const groups: { ymd: string; label: string; slots: Date[] }[] = [];
  for (const s of slots) {
    const ymd = ymdInZone(s, timeZone);
    let g = groups[groups.length - 1];
    if (!g || g.ymd !== ymd) {
      g = { ymd, label: formatSlotDay(s, timeZone), slots: [] };
      groups.push(g);
    }
    g.slots.push(s);
  }
  return groups;
}

/** Validates the admin's weekly windows: 0-6, whole minutes inside the day, end after start. */
export function cleanWindows(input: { weekday: unknown; startMinute: unknown; endMinute: unknown }[]): AvailabilityWindow[] {
  const out: AvailabilityWindow[] = [];
  for (const w of input) {
    const weekday = Number(w.weekday);
    const startMinute = Number(w.startMinute);
    const endMinute = Number(w.endMinute);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("The weekday must be 0 (Sunday) to 6 (Saturday).");
    if (![startMinute, endMinute].every((m) => Number.isInteger(m) && m >= 0 && m <= 24 * 60)) throw new Error("Times must be whole minutes inside the day.");
    if (endMinute <= startMinute) throw new Error("The end time must be after the start time.");
    out.push({ weekday, startMinute, endMinute });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}
