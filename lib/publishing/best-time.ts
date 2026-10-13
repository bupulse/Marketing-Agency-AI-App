// The best time to post one post: Autopilot's rules (docs/AUTOPILOT.md) for a single post. Pure, so approvals,
// auto-approval and the tests agree. The owner's posting times are the times BuPulse MAY use; the network's preferred
// hours (learned from the business's own results, else NETWORK_DEFAULTS) decide which is tried first, and its
// preferred weekdays which days come first. Never in the past, never within 2.5 hours of another post on the account.
import { addDays, dayKey, parseDayKey, weekdayIndex, zonedTimeToUtc } from "./time";
import { cleanSlotTimes } from "./slots";

/** Minimum gap between two posts on one account (as the Autopilot planner). */
export const MIN_GAP_MINUTES = 150;
/** A post is never due sooner than this after it was approved. */
export const LEAD_MINUTES = 15;
export const HORIZON_DAYS = 21;

const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Posting times, the one closest to a preferred hour first (earlier preferred hours win ties). */
export function orderTimes(times: readonly string[], hours: readonly number[]): string[] {
  const clean = cleanSlotTimes(times);
  if (hours.length === 0) return clean;
  const closeness = (t: string) => Math.min(...hours.map((h, i) => Math.abs(minutesOf(t) / 60 - h) + i / 100));
  return [...clean].sort((a, b) => closeness(a) - closeness(b));
}

export function bestTime(args: {
  zone: string;
  now: Date;
  /** The business's posting times ("HH:mm", local). */
  postingTimes: readonly string[];
  /** Preferred local hours for the network, best first. */
  hours: readonly number[];
  /** Preferred weekdays (0 = Monday). */
  weekdays: readonly number[];
  /** Times other posts on the same account go out. */
  taken: readonly Date[];
  leadMinutes?: number;
  minGapMinutes?: number;
  horizonDays?: number;
}): Date | null {
  const { zone, now, taken, leadMinutes = LEAD_MINUTES, minGapMinutes = MIN_GAP_MINUTES, horizonDays = HORIZON_DAYS } = args;
  const times = orderTimes(args.postingTimes, args.hours);
  const earliest = now.getTime() + leadMinutes * 60_000;
  const gap = minGapMinutes * 60_000;
  const today = dayKey(now, zone);
  const free = (at: Date) => at.getTime() >= earliest && taken.every((t) => Math.abs(t.getTime() - at.getTime()) >= gap);

  const tryDays = (days: number, preferredOnly: boolean): Date | null => {
    for (let i = 0; i < days; i++) {
      const key = addDays(today, i);
      if (preferredOnly && args.weekdays.length > 0 && !args.weekdays.includes(weekdayIndex(key))) continue;
      const { year, month, day } = parseDayKey(key);
      for (const t of times) {
        const [h, m] = t.split(":").map(Number);
        const at = zonedTimeToUtc(year, month, day, h, m, zone);
        if (free(at)) return at;
      }
    }
    return null;
  };
  // The coming week's preferred days first, then any day.
  return tryDays(7, true) ?? tryDays(horizonDays, false);
}
