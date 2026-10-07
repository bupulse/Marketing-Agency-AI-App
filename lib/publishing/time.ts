// Time zone helpers for the calendar and the queue. Pure: only Intl, no I/O, so they run in the
// browser and on the server. Business.timezone is an IANA zone such as "Africa/Kigali".

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall-clock fields of an instant in a zone. */
export function zonedParts(date: Date, zone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Milliseconds the zone is ahead of UTC at that instant. */
function offsetMs(date: Date, zone: string): number {
  const p = zonedParts(date, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which a zone's wall clock shows this date and time (handles daylight saving). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), zone);
  const second = guess - offsetMs(new Date(first), zone);
  return new Date(second);
}

/** "YYYY-MM-DD" of an instant in a zone. */
export function dayKey(date: Date, zone: string): string {
  const p = zonedParts(date, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(key: string): number {
  const { year, month, day } = parseDayKey(key);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The Monday on or before this day. */
export function startOfWeek(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function addMonths(key: string, months: number): string {
  const { year, month } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Whole days from one day key to another. */
export function daysBetween(from: string, to: string): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Reads a <input type="datetime-local"> value ("2026-10-08T09:30") as a time in the zone. Null if malformed. */
export function parseLocalInput(value: string, zone: string): Date | null {
  const m = LOCAL_INPUT.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = zonedTimeToUtc(year, month, day, hour, minute, zone);
  // Rejects dates that rolled over (31 February).
  const back = zonedParts(date, zone);
  if (back.month !== month || back.day !== day) return null;
  return date;
}

/** The value of a datetime-local input for an instant, in the zone. */
export function toLocalInput(date: Date, zone: string): string {
  const p = zonedParts(date, zone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** Moves an instant to another day, keeping the wall-clock time in the zone. */
export function moveToDay(date: Date, targetKey: string, zone: string): Date {
  const p = zonedParts(date, zone);
  const t = parseDayKey(targetKey);
  return zonedTimeToUtc(t.year, t.month, t.day, p.hour, p.minute, zone);
}
