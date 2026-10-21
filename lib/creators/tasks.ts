// A creator's tasks by day (docs/CREATOR_CAMPAIGNS.md, "Campaigns, tasks and days"). Pure. A task covers a span of
// days and repeats on each: every day of it the creator hands in `postsPerDay` posts. Days are "YYYY-MM-DD" in the
// company's timezone.

import { addDaysYmd } from "@/lib/demo/slots";
import { listWords, networkLabel } from "./describe";
import { ymdOf } from "./periods";

export type TaskSpan = { id: string; startsOn: Date; endsOn: Date; postsPerDay: number; platforms: string[]; platformMode: string; mediaKind: string };

export const MAX_FILES = 6;
/** 50 MB per file: the Supabase Free plan refuses bigger uploads whatever the bucket allows (the bucket takes 100 MB, ready for Pro). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const TITLE_MAX = 120;
export const CAPTION_MAX = 2200;
export const URL_MAX = 500;

export const coversDay = (task: Pick<TaskSpan, "startsOn" | "endsOn">, day: string) => ymdOf(task.startsOn) <= day && day <= ymdOf(task.endsOn);

export const handInKey = (taskId: string, day: string) => `${taskId}|${day}`;

export type DayTask<T extends TaskSpan> = { task: T; day: string; due: number; handedIn: number; left: number };

/**
 * The tasks due on `day`, with how many posts were handed in for each (`handedIn`, by handInKey: only hand-ins that
 * still count, i.e. not every link INVALID) and how many are left.
 */
export function tasksForDay<T extends TaskSpan>(tasks: T[], day: string, handedIn: Map<string, number>): DayTask<T>[] {
  return tasks
    .filter((t) => coversDay(t, day))
    .map((task) => {
      const done = handedIn.get(handInKey(task.id, day)) ?? 0;
      return { task, day, due: task.postsPerDay, handedIn: done, left: Math.max(0, task.postsPerDay - done) };
    });
}

/** The days a creator may hand in a task for: from its first day to today (late hand-ins fail the on-time check anyway). */
export function handInDays(task: Pick<TaskSpan, "startsOn" | "endsOn">, today: string): string[] {
  const first = ymdOf(task.startsOn);
  const last = ymdOf(task.endsOn) < today ? ymdOf(task.endsOn) : today;
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 400; d = addDaysYmd(d, 1)) out.push(d);
  return out;
}

/** Why the links do not meet the task's platform rule (ALL: one per platform; ANY: at least one), or null. */
export function linksProblem(task: Pick<TaskSpan, "platforms" | "platformMode">, links: Record<string, string>): string | null {
  const given = task.platforms.filter((p) => links[p]?.trim());
  const extra = Object.keys(links).filter((p) => links[p]?.trim() && !task.platforms.includes(p));
  if (extra.length) return `This task is not for ${listWords(extra.map(networkLabel))}.`;
  if (task.platformMode === "ALL") {
    const missing = task.platforms.filter((p) => !given.includes(p));
    if (missing.length) return `Add the link of your post on ${listWords(missing.map(networkLabel))}: this task needs a post on each platform.`;
  }
  if (!given.length) return "Add the link of your post.";
  return null;
}
