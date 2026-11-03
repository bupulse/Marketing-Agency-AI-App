import { CRON_ROUTES, PUBLISH_CRON } from "@/worker-crons";

// Cloud Run's scheduled jobs (docs/DEPLOY_CLOUDRUN.md, "Scheduled jobs"): Cloud Scheduler's free tier has 3 jobs, so
// one job calls /api/cron/tick every minute and the tick works out here which routes are due in that minute, from the
// same schedule list Cloudflare uses (worker-crons.ts). Times are UTC, as on Cloudflare. Pure, no server imports.

const FIELDS = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 and 7 are Sunday)
];

/** One cron field ("*", "5", "1-5", "*\/4", "10-40/10", "5,6,0") as the set of values it allows; throws when malformed. */
function parseField(text: string, { min, max }: { min: number; max: number }): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad cron field "${text}"`);
    const step = m[4] ? Number(m[4]) : 1;
    const from = m[1] === "*" ? min : Number(m[2]);
    const to = m[1] === "*" ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from;
    if (step < 1 || from < min || to > max || from > to) throw new Error(`bad cron field "${text}"`);
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return values;
}

/**
 * True when the five-field cron expression fires at `at` (UTC, to the minute). Day of month and day of week follow
 * the usual cron rule: when both are restricted, either one matching is enough.
 */
export function cronMatches(expression: string, at: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`bad cron expression "${expression}"`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (dow.has(7)) dow.add(0);
  const dayOfMonth = dom.has(at.getUTCDate());
  const dayOfWeek = dow.has(at.getUTCDay());
  const day = parts[2] !== "*" && parts[4] !== "*" ? dayOfMonth || dayOfWeek : dayOfMonth && dayOfWeek;
  return minute.has(at.getUTCMinutes()) && hour.has(at.getUTCHours()) && month.has(at.getUTCMonth() + 1) && day;
}

/** The routes due at `at` (UTC minute), the publisher first, then in worker-crons.ts order. */
export function dueRoutes(at: Date, routes: Record<string, string> = CRON_ROUTES): string[] {
  const due = Object.entries(routes)
    .filter(([cron]) => cronMatches(cron, at))
    .map(([cron, path]) => ({ cron, path }));
  return [...due.filter((d) => d.cron === PUBLISH_CRON), ...due.filter((d) => d.cron !== PUBLISH_CRON)].map((d) => d.path);
}

/** How far Cloud Scheduler's planned time may be from now and still be used (a late or retried call). */
const SCHEDULE_TIME_SLACK_MS = 15 * 60 * 1000;

/**
 * The minute this tick stands for: Cloud Scheduler's X-CloudScheduler-ScheduleTime (the planned time, RFC 3339) when
 * it is valid and within 15 minutes of now, so a call that arrives a few seconds late still runs that minute's jobs;
 * else now. Always cut to the whole UTC minute.
 */
export function tickMinute(scheduleTime: string | null | undefined, now: Date = new Date()): Date {
  const planned = scheduleTime ? new Date(scheduleTime) : null;
  const usable = planned && !Number.isNaN(planned.getTime()) && Math.abs(planned.getTime() - now.getTime()) <= SCHEDULE_TIME_SLACK_MS;
  const at = usable ? planned : now;
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}
