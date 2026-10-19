// When to check a switched-on Instagram or Facebook account again (pure, so the tests can pin every case).
//
// - Soon after activity: every 5 minutes for half an hour after the last new comment or message, then every 10 minutes
//   up to two hours.
// - Quiet: every 30 minutes (the slow end of the 15 to 30 the plan allows, to stretch the free calls), or longer when
//   the month's remaining calls must be spread over more accounts (pacing, below): better a slower check all month
//   than none in its last week.
// - Night: no checks between 22:00 and 07:00 in the business's time zone; the first check is at 07:00.
// - Errors: after repeated failures the wait doubles, up to 6 hours, so a broken account does not eat the budget.

export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 22;
export const ACTIVE_MINUTES_PER_DAY = (DAY_END_HOUR - DAY_START_HOUR) * 60;

export const ACTIVE_MINUTES = 5;
export const WARM_MINUTES = 10;
export const QUIET_MINUTES = 30;
export const MAX_MINUTES = 240;
const ERROR_MAX_MINUTES = 360;

/** Calls a quiet check makes (the posts list and the conversations list), used for pacing. */
export const CALLS_PER_QUIET_CHECK = 2;

/** Minutes since local midnight in `timeZone` (an unknown zone counts as UTC). */
export function localMinutes(now: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

export function isNight(now: Date, timeZone: string): boolean {
  const m = localMinutes(now, timeZone);
  return m < DAY_START_HOUR * 60 || m >= DAY_END_HOUR * 60;
}

/** Minutes until the next 07:00 in `timeZone` (0 when it is already daytime). */
export function minutesUntilMorning(now: Date, timeZone: string): number {
  if (!isNight(now, timeZone)) return 0;
  const m = localMinutes(now, timeZone);
  return (DAY_START_HOUR * 60 - m + 24 * 60) % (24 * 60);
}

/**
 * The quiet interval that spreads the calls left this month over every switched-on account's remaining daytime:
 * minutes of daytime left x accounts x calls per check / calls left. 0 when there is plenty.
 */
export function pacedMinutes(input: { now: Date; callsLeft: number; accounts: number }): number {
  const { now, callsLeft, accounts } = input;
  if (accounts <= 0) return 0;
  if (callsLeft <= 0) return MAX_MINUTES;
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const daysLeft = Math.max(1, (monthEnd - now.getTime()) / 86_400_000);
  return Math.ceil((daysLeft * ACTIVE_MINUTES_PER_DAY * accounts * CALLS_PER_QUIET_CHECK) / callsLeft);
}

export type NextCheckInput = {
  now: Date;
  timeZone: string;
  /** The last time a new comment or message was found. */
  lastActivityAt: Date | null;
  /** From pacedMinutes. */
  paced: number;
  /** Failed checks in a row. */
  errors?: number;
};

/** When to check next. */
export function nextCheckAt(input: NextCheckInput): Date {
  const { now, timeZone, lastActivityAt, paced } = input;
  const since = lastActivityAt ? (now.getTime() - lastActivityAt.getTime()) / 60_000 : Infinity;
  let minutes: number;
  if (since <= 30) minutes = Math.max(ACTIVE_MINUTES, Math.ceil(paced / 4));
  else if (since <= 120) minutes = Math.max(WARM_MINUTES, Math.ceil(paced / 2));
  else minutes = Math.max(QUIET_MINUTES, paced);
  minutes = Math.min(minutes, MAX_MINUTES);
  if (input.errors && input.errors >= 2) minutes = Math.min(ERROR_MAX_MINUTES, Math.max(minutes, QUIET_MINUTES * 2 ** Math.min(input.errors - 1, 5)));
  const at = new Date(now.getTime() + minutes * 60_000);
  const wait = minutesUntilMorning(at, timeZone);
  return wait > 0 ? new Date(at.getTime() + wait * 60_000) : at;
}
