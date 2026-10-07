import "server-only";
import { loadPlanInput } from "./data";
import { buildWeekPlan, type WeekPlan } from "./planner";

/** Plans a week for a business: which ideas, accounts, days and times. Writes nothing. */
export async function planWeek(businessId: string, weekStart: Date, now = new Date()): Promise<(WeekPlan & { input: NonNullable<Awaited<ReturnType<typeof loadPlanInput>>> }) | null> {
  const input = await loadPlanInput(businessId, weekStart, now);
  if (!input) return null;
  return { ...buildWeekPlan(input), input };
}
