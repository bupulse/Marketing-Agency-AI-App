// Days and months for money, sales and the admin console are Kigali's (Africa/Kigali, UTC+2 all year, no summer
// time): a payment at 01:00 Kigali on the 1st belongs to the new month, as the owner sees it. One helper, used by the
// Money pages, the leaderboard, the sales screen, the AI budget and the Overview. Pure.

export const BUSINESS_TIME_ZONE = "Africa/Kigali";
/** Kigali is UTC+2 with no daylight saving, so a fixed offset is exact. */
export const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;
/** The same offset for SQL: `"createdAt" + interval '2 hours'` is the Kigali wall clock of a UTC timestamp. */
export const KIGALI_SQL_OFFSET = "2 hours";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The Kigali wall clock of an instant, as UTC fields. */
const wall = (d: Date) => new Date(d.getTime() + KIGALI_OFFSET_MS);

/** "YYYY-MM" of the Kigali month an instant falls in. */
export function kigaliMonthOf(d: Date): string {
  return wall(d).toISOString().slice(0, 7);
}

/** "YYYY-MM-DD" of the Kigali day an instant falls in. */
export function kigaliDayOf(d: Date): string {
  return wall(d).toISOString().slice(0, 10);
}

/** Midnight in Kigali at the start of the day `now` falls in. */
export function kigaliDayStart(now: Date): Date {
  const w = wall(now);
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - KIGALI_OFFSET_MS);
}

/** The instants a Kigali month covers: [start, end). Throws on a malformed month. */
export function kigaliMonthRange(month: string): { start: Date; end: Date } {
  if (!MONTH.test(month)) throw new Error(`Not a month: ${month}`);
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - KIGALI_OFFSET_MS), end: new Date(Date.UTC(y, m, 1) - KIGALI_OFFSET_MS) };
}

/** Midnight in Kigali on the 1st of the month `now` falls in. */
export const kigaliMonthStart = (now: Date) => kigaliMonthRange(kigaliMonthOf(now)).start;
