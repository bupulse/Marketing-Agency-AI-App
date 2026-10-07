// Time-zone helpers for planning in the business's own zone (IANA name, Business.timezone).
// Pure functions built on Intl, so they work the same on Node and Cloudflare Workers.

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone to plan in; UTC when the stored name is unknown. */
export function safeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  hour: number;
  minute: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/** "YYYY-MM-DD" of an instant in a zone. */
export function localDateISO(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Adds whole days to a "YYYY-MM-DD" string (calendar arithmetic, no zone involved). */
export function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday for a "YYYY-MM-DD" string. */
export function weekdayOfISO(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The UTC instant at which the wall clock in `tz` reads `iso` `time` ("HH:mm"). */
export function zonedToUtc(iso: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  const wall = Date.parse(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  // Two passes settle the offset around daylight-saving changes.
  let utc = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(utc), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    utc += wall - shown;
  }
  return new Date(utc);
}

/** Monday 00:00 (in `tz`) of the week containing `date`, as a UTC instant. */
export function weekStartFor(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return zonedToUtc(addDaysISO(today, -p.weekday), "00:00", tz);
}

/** The Monday 00:00 that starts the week after the one containing `now`. */
export function nextWeekStart(now: Date, tz: string): Date {
  const monday = localDateISO(weekStartFor(now, tz), tz);
  return zonedToUtc(addDaysISO(monday, 7), "00:00", tz);
}

/** The seven "YYYY-MM-DD" dates of the week starting at `weekStart`, Monday first. */
export function weekDates(weekStart: Date, tz: string): string[] {
  const monday = localDateISO(weekStart, tz);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));
}

/** "HH:mm" -> minutes after midnight, or null when malformed. */
export function minutesOf(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The key a week is stored under (AutopilotRun.weekStart): midnight UTC of its local Monday date.
 * It is a date, not an instant, so changing the business's time zone later cannot make a second key.
 */
export function weekKey(weekStart: Date, tz: string): Date {
  return new Date(`${localDateISO(weekStart, tz)}T00:00:00Z`);
}

/** The instant a week starts in `tz` for a stored key. */
export function weekStartFromKey(key: Date, tz: string): Date {
  return zonedToUtc(key.toISOString().slice(0, 10), "00:00", tz);
}
