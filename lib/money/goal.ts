// The revenue goal tracker on Admin -> Revenue and profit (docs/bizdev/PLAN.md section 4,
// docs/guide/features/26-revenue-goal-tracker.md). Pure: the page passes the money report and two settings.
import type { RwfPart } from "./revenue-shared";

/**
 * Share of the goal to reach by the end of launch months 1, 2, 3 and 4 (the pace plan in docs/bizdev/PLAN.md:
 * about 1.7M, 3.9M, 6.3M and 8.8M to 9M RWF of a 9M goal). From month 4 on, the target is the whole goal.
 */
export const GOAL_PATH = [0.19, 0.43, 0.7, 1] as const;

/** MRR in whole RWF: the part paid in RWF exactly, the rest converted at `rwfPerUsd`. */
export function mrrInRwf(mrrCents: number, part: RwfPart, rwfPerUsd: number): number {
  return Math.round(part.rwfMinor + ((mrrCents - part.rwfUsdCents) / 100) * rwfPerUsd);
}

/** Months from `start` to `month` (YYYY-MM), counting `start` as month 1; 0 or less before it. */
export function launchMonthNo(start: string, month: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  return (y - sy) * 12 + (m - sm) + 1;
}

export type GoalProgress = {
  goalRwf: number;
  mrrRwf: number;
  /** MRR as a share of the goal, 0 to 100+ (one decimal). */
  pct: number;
  gapRwf: number;
  /** Launch month number of this month (1 = the launch month); null before the launch. */
  monthNo: number | null;
  /** The pace plan's MRR for the end of this month; null before the launch. */
  targetRwf: number | null;
  /** MRR at or above this month's target (null before the launch). */
  onTrack: boolean | null;
  /** MRR per paying client in RWF; null with no paying client. */
  arpuRwf: number | null;
  /** More paying clients needed at today's average to reach the goal; null without an average. */
  clientsToGoal: number | null;
  /** Months left to the end of month 4 (at least 1 while the goal is not reached). */
  monthsLeft: number;
  /** New paying clients a month needed to close the gap by the end of month 4 (churn not counted). */
  perMonth: number | null;
};

export function goalProgress(input: { goalRwf: number; mrrRwf: number; payingNow: number; startMonth: string; thisMonth: string }): GoalProgress {
  const { goalRwf, mrrRwf, payingNow } = input;
  const no = launchMonthNo(input.startMonth, input.thisMonth);
  const monthNo = no >= 1 ? no : null;
  const share = monthNo === null ? null : GOAL_PATH[Math.min(monthNo, GOAL_PATH.length) - 1];
  const targetRwf = share === null ? null : Math.round(goalRwf * share);
  const gapRwf = Math.max(0, goalRwf - mrrRwf);
  const arpuRwf = payingNow > 0 ? Math.round(mrrRwf / payingNow) : null;
  const clientsToGoal = gapRwf === 0 ? 0 : arpuRwf ? Math.ceil(gapRwf / arpuRwf) : null;
  const monthsLeft = gapRwf === 0 ? 0 : Math.max(1, GOAL_PATH.length - (monthNo ?? 1) + 1);
  return {
    goalRwf,
    mrrRwf,
    pct: goalRwf > 0 ? Math.round((mrrRwf / goalRwf) * 1000) / 10 : 0,
    gapRwf,
    monthNo,
    targetRwf,
    onTrack: targetRwf === null ? null : mrrRwf >= targetRwf,
    arpuRwf,
    clientsToGoal,
    monthsLeft,
    perMonth: clientsToGoal === null ? null : monthsLeft === 0 ? 0 : Math.ceil(clientsToGoal / monthsLeft),
  };
}
