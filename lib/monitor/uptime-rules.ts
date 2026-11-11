// Uptime from outside (docs/SUPPORT_DASHBOARD.md, "Server monitoring"): the rules that turn GitHub Actions' checks
// (.github/workflows/uptime.yml, every 5 minutes) into outages, the site's state now and uptime percentages. Pure, no
// imports: tests/monitor/outages.test.ts.
//
// The site is "down from the last good check to the next good check" when there was no good check for more than
// GAP_MS and something shows the site really was down: a failed check in it, the check after it saying the workflow's
// previous run found the site down (that run sent the "down" alert, so the "back up" alert must follow), or the server
// PC going silent inside it. A gap alone never counts while the PC kept reporting: GitHub's 5-minute schedule ran only
// every few hours on 10 November 2026 (a false "down for 4 hours 57 minutes"), and the PC's own 5-minute check
// (scripts/monitor/pc-self-check.mjs) fills the record anyway. Outages shorter than MIN_OUTAGE_MS (a deploy restart,
// one slow answer) are neither recorded nor alerted.

export const GAP_MS = 12 * 60_000;
export const LONG_GAP_MS = 30 * 60_000;
/** Shorter than this is a blip (a deploy restarting the server), not an outage. */
export const MIN_OUTAGE_MS = 2 * 60_000;
/** The PC reports every minute; this long without a report means it (or its job loop, or the server) stopped. */
export const PC_SILENT_MS = 3 * 60_000;
export const UPTIME_MAX_BYTES = 4_096;

export type OutageReason = "failed-check" | "pc-silent" | "long-gap";
export type Outage = { startedAt: Date; endedAt: Date; minutes: number; reason: OutageReason };

export const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

/**
 * The outage before a good check `next`, if there was one, given the good check before it (`prev`, null for the very
 * first check) and what happened in between.
 */
export function gapOutage(
  prev: { checkedAt: Date } | null,
  next: { checkedAt: Date; afterFailure: boolean },
  between: { failedChecks: number; pcSilent: boolean },
): Outage | null {
  if (!prev) return null;
  const gap = next.checkedAt.getTime() - prev.checkedAt.getTime();
  if (gap <= 0) return null;
  if (gap < MIN_OUTAGE_MS) return null;
  let reason: OutageReason | null = null;
  if (next.afterFailure) reason = "failed-check";
  else if (gap > GAP_MS) reason = between.failedChecks > 0 ? "failed-check" : between.pcSilent ? "pc-silent" : null;
  return reason ? { startedAt: prev.checkedAt, endedAt: next.checkedAt, minutes: minutesBetween(prev.checkedAt, next.checkedAt), reason } : null;
}

/** The longest stretch without a time in `times` between `from` and `to` (both ends count as edges). */
export function longestGapMs(times: Date[], from: Date, to: Date): number {
  const points = [from.getTime(), ...times.map((t) => t.getTime()).filter((t) => t > from.getTime() && t < to.getTime()).sort((a, b) => a - b), to.getTime()];
  let max = 0;
  for (let i = 1; i < points.length; i++) max = Math.max(max, points[i] - points[i - 1]);
  return max;
}

export type SiteState =
  /** No outside check has ever arrived: the workflow or its secret is not set up yet. */
  | { kind: "never" }
  | { kind: "up"; lastCheckAt: Date }
  /** The last check failed, or no good check for a long time / with the PC silent too. */
  | { kind: "down"; since: Date | null; minutes: number | null; lastCheckAt: Date }
  /** No check for a while, nothing else wrong: most likely GitHub runs late. */
  | { kind: "late"; lastCheckAt: Date; minutes: number };

export function siteState(
  input: { lastCheck: { checkedAt: Date; ok: boolean } | null; lastOkAt: Date | null; pcSilent: boolean },
  now: Date,
): SiteState {
  const { lastCheck, lastOkAt } = input;
  if (!lastCheck) return { kind: "never" };
  if (!lastCheck.ok) return { kind: "down", since: lastOkAt, minutes: lastOkAt ? minutesBetween(lastOkAt, now) : null, lastCheckAt: lastCheck.checkedAt };
  const quiet = now.getTime() - lastCheck.checkedAt.getTime();
  if (quiet <= GAP_MS) return { kind: "up", lastCheckAt: lastCheck.checkedAt };
  // No check for a while with the PC still reporting is late checks, not a down site (see the top of this file).
  if (input.pcSilent) return { kind: "down", since: lastCheck.checkedAt, minutes: minutesBetween(lastCheck.checkedAt, now), lastCheckAt: lastCheck.checkedAt };
  return { kind: "late", lastCheckAt: lastCheck.checkedAt, minutes: minutesBetween(lastCheck.checkedAt, now) };
}

/**
 * Uptime in [from, to] as a percentage (one decimal), from the recorded outages and the one going on now (if any).
 * Only time since monitoring started counts; null when it had not started yet.
 */
export function uptimePercent(
  outages: { startedAt: Date; endedAt: Date | null }[],
  window: { from: Date; to: Date },
  monitoringSince: Date | null,
): number | null {
  if (!monitoringSince) return null;
  const from = Math.max(window.from.getTime(), monitoringSince.getTime());
  const to = window.to.getTime();
  if (to <= from) return null;
  // Merge overlaps so a minute is never counted twice.
  const spans = outages
    .map((o) => [Math.max(from, o.startedAt.getTime()), Math.min(to, (o.endedAt ?? window.to).getTime())] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let down = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of spans) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) down += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) down += cur[1] - cur[0];
  return Math.floor((1 - down / (to - from)) * 1000) / 10;
}

// ---- the check the workflow posts ---------------------------------------------------------------------------

export const CHECKED_PAGES = ["/", "/pricing", "/login"] as const;
export type PageResult = { path: string; status: number | null; ms: number | null };
export type UptimeCheckInput = {
  ok: boolean;
  statusCode: number | null;
  statusMs: number | null;
  databaseMs: number | null;
  version: string | null;
  pages: PageResult[];
  retried: boolean;
  afterFailure: boolean;
};

const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 600_000 ? Math.round(v) : null);
const code = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599 ? v : null);

export function parseUptimeCheck(raw: unknown): { ok: true; value: UptimeCheckInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send a JSON object." };
  const o = raw as Record<string, unknown>;
  if (typeof o.ok !== "boolean") return { ok: false, error: "ok must be true or false." };
  const pages: PageResult[] = [];
  for (const p of Array.isArray(o.pages) ? o.pages.slice(0, 10) : []) {
    const r = (p ?? {}) as Record<string, unknown>;
    const path = typeof r.path === "string" ? r.path : "";
    if (!(CHECKED_PAGES as readonly string[]).includes(path) || pages.some((x) => x.path === path)) continue;
    pages.push({ path, status: code(r.status), ms: ms(r.ms) });
  }
  const version = typeof o.version === "string" ? o.version.replace(/[^\w.+-]/g, "").slice(0, 40) || null : null;
  return {
    ok: true,
    value: { ok: o.ok, statusCode: code(o.statusCode), statusMs: ms(o.statusMs), databaseMs: ms(o.databaseMs), version, pages, retried: o.retried === true, afterFailure: o.afterFailure === true },
  };
}

// ---- words for the owner ----------------------------------------------------------------------------------

/** "45 minutes", "1 hour 5 minutes", "2 days 3 hours". */
export function durationWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (m < 60) return plural(m, "minute");
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${plural(h, "hour")} ${plural(m % 60, "minute")}` : plural(h, "hour");
  const d = Math.floor(h / 24);
  return h % 24 ? `${plural(d, "day")} ${plural(h % 24, "hour")}` : plural(d, "day");
}

const KIGALI = "Africa/Kigali";

/** "9 Nov, 14:05" in Kigali time (Rwanda has no daylight saving). */
export function kigaliTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: KIGALI, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** Midnight today in Kigali (UTC+2), as a Date. */
export function kigaliMidnight(now: Date): Date {
  const OFFSET = 2 * 3_600_000;
  const local = new Date(now.getTime() + OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET);
}
