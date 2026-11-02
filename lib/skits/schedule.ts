// Which days are skit days (PlanLimits.skitsPerWeek): spread evenly over the business-local week, so Business (2 a
// week) gets Tuesday and Friday and Business Pro (3) Monday, Wednesday and Friday. On a skit day the daily posts make no
// slideshow video (lib/daily-posts/service.ts): the skit is that day's video. Pure.
import { addDays, weekdayIndex } from "@/lib/publishing/time";
import { SKITS_PER_WEEK_MAX } from "@/lib/plans";

/** 0 = Monday ... 6 = Sunday, for each number of skits a week. */
export const SKIT_WEEKDAYS: Readonly<Record<number, readonly number[]>> = {
  0: [],
  1: [2],
  2: [1, 4],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function skitWeekdays(perWeek: number): readonly number[] {
  const n = Number.isInteger(perWeek) ? Math.min(Math.max(perWeek, 0), SKITS_PER_WEEK_MAX) : 0;
  return SKIT_WEEKDAYS[n] ?? [];
}

/** Whether a business-local day ("YYYY-MM-DD") is a skit day for a plan with `perWeek` skits. */
export function isSkitDay(perWeek: number, day: string): boolean {
  return skitWeekdays(perWeek).includes(weekdayIndex(day));
}

/** The first skit day on or after `from`, or null for a plan without skits. */
export function nextSkitDay(perWeek: number, from: string): string | null {
  if (skitWeekdays(perWeek).length === 0) return null;
  for (let i = 0; i < 7; i++) {
    const day = addDays(from, i);
    if (isSkitDay(perWeek, day)) return day;
  }
  return null;
}

/** "Tuesday and Friday" / "Monday, Wednesday and Friday". */
export function skitDaysText(perWeek: number): string {
  const names = skitWeekdays(perWeek).map((d) => WEEKDAY_NAMES[d]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function weekdayName(day: string): string {
  return WEEKDAY_NAMES[weekdayIndex(day)];
}
