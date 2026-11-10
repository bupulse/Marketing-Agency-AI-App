// The Server page's uptime timeline (components/support-app/server/uptime-timeline.tsx): the last 24 hours as one bar
// per hour and the last 30 days as one bar per Kigali day, each with its uptime and, for hours, the outside checks in
// it. Pure, no server imports: tests/monitor/timeline.test.ts. Rwanda is UTC+2 all year, so whole UTC hours are whole
// Kigali hours.

import { kigaliMidnight, uptimePercent, type PageResult } from "./uptime-rules";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type HourBar = { start: string; checks: number; failed: number; avgMs: number | null; uptime: number | null };
export type DayBar = { day: string; uptime: number | null };
export type BarState = "good" | "partial" | "down" | "none";
type Span = { startedAt: Date; endedAt: Date | null };

/** One bar per hour, oldest first, the last one being the hour going on now (up to `now`). */
export function hourlyBars(
  checks: { checkedAt: Date; ok: boolean; pages: PageResult[] }[],
  spans: Span[],
  since: Date | null,
  now: Date,
  hours = 24,
): HourBar[] {
  const current = Math.floor(now.getTime() / HOUR) * HOUR;
  const bars: HourBar[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const from = current - i * HOUR;
    const to = Math.min(from + HOUR, now.getTime());
    let n = 0;
    let failed = 0;
    let total = 0;
    let timed = 0;
    for (const c of checks) {
      const t = c.checkedAt.getTime();
      if (t < from || t >= from + HOUR) continue;
      n++;
      if (!c.ok) failed++;
      for (const p of c.pages) {
        if (p.ms !== null && p.status !== null && p.status < 500) {
          total += p.ms;
          timed++;
        }
      }
    }
    bars.push({
      start: new Date(from).toISOString(),
      checks: n,
      failed,
      avgMs: timed ? Math.round(total / timed) : null,
      uptime: to > from ? uptimePercent(spans, { from: new Date(from), to: new Date(to) }, since) : null,
    });
  }
  return bars;
}

/** One bar per Kigali day, oldest first, the last one being today (up to `now`). */
export function dailyBars(spans: Span[], since: Date | null, now: Date, days = 30): DayBar[] {
  const today = kigaliMidnight(now).getTime();
  const bars: DayBar[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = today - i * DAY;
    const to = Math.min(from + DAY, now.getTime());
    bars.push({ day: new Date(from).toISOString(), uptime: to > from ? uptimePercent(spans, { from: new Date(from), to: new Date(to) }, since) : null });
  }
  return bars;
}

/** The colour a bar gets: no data, all fine, partly down (or a failed check), or mostly down. */
export function barState(b: { uptime: number | null; failed?: number }): BarState {
  if (b.uptime === null) return "none";
  if (b.uptime >= 100 && !b.failed) return "good";
  if (b.uptime <= 50) return "down";
  return "partial";
}
