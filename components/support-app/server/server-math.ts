// The Server page's display maths: which colour a reading gets, minutes down behind a percentage, bar widths. Pure:
// tests/monitor/server-math.test.ts.

export type Level = "good" | "warn" | "bad" | "none";

/** The status palette (dataviz skill): fixed in both themes, always shown with an icon or a word, never colour alone. */
export const LEVEL_COLOR: Record<Level, string> = { good: "#0ca30c", warn: "#fab219", bad: "#d03b3b", none: "#9a9aa0" };
export const LEVEL_WORD: Record<Level, string> = { good: "Good", warn: "Needs a look", bad: "Problem", none: "No data" };

/** How full something is (0-1): fine below `warnAt`, a look from `warnAt`, a problem from `dangerAt`. */
export function fillLevel(v: number | null, warnAt = 0.8, dangerAt = 0.9): Level {
  if (v === null || !Number.isFinite(v)) return "none";
  return v >= dangerAt ? "bad" : v >= warnAt ? "warn" : "good";
}

/** Uptime: 99.9% or more is good (about 43 minutes down a month), 99% or more needs a look, below is a problem. */
export function uptimeLevel(pct: number | null): Level {
  if (pct === null) return "none";
  return pct >= 99.9 ? "good" : pct >= 99 ? "warn" : "bad";
}

/** A page opening from outside: under 1 second is fast, under 3 is OK, more is slow. */
export function speedLevel(ms: number | null): Level {
  if (ms === null) return "none";
  return ms < 1000 ? "good" : ms < 3000 ? "warn" : "bad";
}

/** Roughly how many minutes down a percentage means over a window of `windowMinutes`. */
export function downMinutes(pct: number | null, windowMinutes: number): number | null {
  if (pct === null || windowMinutes <= 0) return null;
  return Math.max(0, Math.round(((100 - pct) / 100) * windowMinutes));
}

/** The minutes a window really covers: from the later of its start and when monitoring began, to now. */
export function windowMinutes(fromMs: number, sinceIso: string | null, nowMs: number): number {
  const start = Math.max(fromMs, sinceIso ? new Date(sinceIso).getTime() : fromMs);
  return Math.max(0, Math.round((nowMs - start) / 60_000));
}

/** A bar's share of the track (0-1) on a scale that ends at `max`; anything slower fills it. */
export function share(value: number | null, max: number): number {
  if (value === null || !Number.isFinite(value) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** "1.2 s" or "640 ms". */
export function seconds(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
