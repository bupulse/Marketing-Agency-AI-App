// Scheduled jobs the admin health page watches, and the arithmetic to tell when one is overdue.
// Pure (no database): tests/admin-health.test.ts covers it. The schedules must match wrangler.jsonc / the GitHub workflows.

export type CronJob = {
  job: string;
  label: string;
  /** Standard 5-field cron expression, UTC. */
  cron: string;
  /** Where the schedule lives, for the owner. */
  via: "Cloudflare" | "GitHub Actions";
  /** Plain words: what it does. */
  what: string;
};

export const CRON_JOBS: CronJob[] = [
  { job: "publish", label: "Publish posts", cron: "* * * * *", via: "Cloudflare", what: "Publishes posts that are due" },
  { job: "metrics", label: "Collect metrics", cron: "23 * * * *", via: "Cloudflare", what: "Reads post reach and engagement" },
  { job: "leads-digest", label: "Leads digest and webhook retries", cron: "37 * * * *", via: "Cloudflare", what: "Daily lead emails and webhook retries" },
  { job: "autopilot", label: "Autopilot planning", cron: "11 */3 * * 5,6", via: "Cloudflare", what: "Plans next week on Fridays and Saturdays" },
  { job: "store-sync", label: "Store sync", cron: "47 3 * * *", via: "Cloudflare", what: "Re-syncs imported store products" },
  { job: "analytics-rollup", label: "Analytics roll-up", cron: "17 2 * * *", via: "Cloudflare", what: "Daily numbers for the admin console" },
  { job: "plan-price-changes", label: "Plan price changes", cron: "29 4 * * *", via: "Cloudflare", what: "Notices and renewals when a plan price changes" },
  { job: "purge-accounts", label: "Delete scheduled accounts", cron: "17 3 * * *", via: "GitHub Actions", what: "Erases accounts past their 30-day grace period" },
  { job: "social-refresh", label: "Refresh social tokens", cron: "43 4 * * *", via: "GitHub Actions", what: "Renews channel tokens before they expire" },
];

const MINUTE = 60_000;

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad cron step in "${field}"`);
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b === undefined ? (stepText ? max : lo) : Number(b);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`Bad cron field "${field}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

type Parsed = { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean };

export function parseCron(expr: string): Parsed {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`A cron expression has 5 fields: "${expr}"`);
  const dow = parseField(f[4], 0, 7);
  if (dow.has(7)) dow.add(0);
  return {
    min: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    mon: parseField(f[3], 1, 12),
    dow,
    domAny: f[2] === "*",
    dowAny: f[4] === "*",
  };
}

function matches(p: Parsed, d: Date): boolean {
  if (!p.min.has(d.getUTCMinutes()) || !p.hour.has(d.getUTCHours()) || !p.mon.has(d.getUTCMonth() + 1)) return false;
  const domOk = p.dom.has(d.getUTCDate());
  const dowOk = p.dow.has(d.getUTCDay());
  // Like cron: when both day fields are restricted, either may match.
  return p.domAny || p.dowAny ? domOk && dowOk : domOk || dowOk;
}

const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;
const SEARCH_MINUTES = 8 * 24 * 60;

/** The first scheduled time strictly after `from`, or null if none within 8 days. */
export function nextRun(expr: string, from: Date): Date | null {
  const p = parseCron(expr);
  let t = floorMinute(from.getTime()) + MINUTE;
  for (let i = 0; i < SEARCH_MINUTES; i++, t += MINUTE) if (matches(p, new Date(t))) return new Date(t);
  return null;
}

/** The latest scheduled time at or before `from`, or null if none within 8 days. */
export function prevRun(expr: string, from: Date): Date | null {
  const p = parseCron(expr);
  let t = floorMinute(from.getTime());
  for (let i = 0; i < SEARCH_MINUTES; i++, t -= MINUTE) if (matches(p, new Date(t))) return new Date(t);
  return null;
}

/** GitHub Actions schedules often start well after their time, so those jobs get at least this long before they count as overdue. */
export const GITHUB_MIN_GRACE_MS = 4 * 60 * MINUTE;

/**
 * How late a run may start before it counts as overdue: a quarter of the gap, between 5 and 90 minutes
 * (at least 4 hours for jobs scheduled by GitHub Actions).
 */
export function graceMs(expr: string, scheduled: Date, via: CronJob["via"] = "Cloudflare"): number {
  const after = nextRun(expr, scheduled);
  const period = after ? after.getTime() - scheduled.getTime() : 24 * 60 * MINUTE;
  const grace = Math.min(Math.max(period / 4, 5 * MINUTE), 90 * MINUTE);
  return via === "GitHub Actions" ? Math.max(grace, GITHUB_MIN_GRACE_MS) : grace;
}

export type CronState = "ok" | "failed" | "overdue" | "never";

export type CronStatus = {
  job: string;
  label: string;
  what: string;
  via: CronJob["via"];
  cron: string;
  state: CronState;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastSummary: string | null;
  lastError: string | null;
  nextExpectedAt: string | null;
  failures24h: number;
  runs24h: number;
  /** Minutes past the time it should have started, when overdue. */
  overdueByMinutes: number | null;
};

export type LastRun = { startedAt: Date; finishedAt: Date; ok: boolean; summary: string | null; error: string | null } | null;

/**
 * Where a job stands. Overdue = the scheduled time after its last run has passed (plus grace) with no run started;
 * failed = the latest run reported a failure; never = nothing recorded at all.
 */
export function cronStatus(job: CronJob, last: LastRun, counts: { failures24h: number; runs24h: number }, now: Date): CronStatus {
  const next = nextRun(job.cron, now);
  let state: CronState = "ok";
  let overdueBy: number | null = null;
  if (!last) state = "never";
  else {
    // The run after the last one that started should have begun by now (plus grace).
    const expected = nextRun(job.cron, last.startedAt);
    if (expected && now.getTime() > expected.getTime() + graceMs(job.cron, expected, job.via)) {
      state = "overdue";
      overdueBy = Math.round((now.getTime() - expected.getTime()) / MINUTE);
    } else if (!last.ok) state = "failed";
  }
  return {
    job: job.job,
    label: job.label,
    what: job.what,
    via: job.via,
    cron: job.cron,
    state,
    lastStartedAt: last?.startedAt.toISOString() ?? null,
    lastFinishedAt: last?.finishedAt.toISOString() ?? null,
    lastOk: last?.ok ?? null,
    lastSummary: last?.summary ?? null,
    lastError: last?.error ?? null,
    nextExpectedAt: next?.toISOString() ?? null,
    failures24h: counts.failures24h,
    runs24h: counts.runs24h,
    overdueByMinutes: overdueBy,
  };
}
