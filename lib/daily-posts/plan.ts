// When a company's daily posts are made and what they are about (docs/CONTENT.md "Daily posts"). Pure.
import type { ContentScope } from "@/lib/content-board/filters";
import { dayKey, zonedParts } from "@/lib/publishing/time";

/** The day's posts are made from local midnight; until this hour a company that has none yet still gets them. */
export const CUTOFF_HOUR = 12;
/** The "Your posts for today are ready" notice goes from this local hour. */
export const READY_HOUR = 7;

/**
 * The local day a run makes posts for right now: the new day from midnight (the nightly run), or today's until
 * midday for a company that has none yet (it got the feature during the morning, or the night's run failed). After
 * midday nothing: the next night makes the next day.
 */
export function dueDay(zone: string, now: Date): string | null {
  return zonedParts(now, zone).hour < CUTOFF_HOUR ? dayKey(now, zone) : null;
}

/** The notice may go: from READY_HOUR on the run's own day. */
export function noticeDue(day: string, zone: string, now: Date): boolean {
  return dayKey(now, zone) === day && zonedParts(now, zone).hour >= READY_HOUR;
}

export type Subject = ContentScope;

const keyOf = (s: { kind: string; id?: string | null }) => (s.kind === "general" ? "general" : `${s.kind}:${s.id ?? ""}`);

/**
 * The subject of the day: the product, campaign or General that had daily posts longest ago (never first), so days
 * rotate over all of them and the same subject never comes twice in a row while there is another. Ties keep the
 * candidates' order (running campaigns, then products, then General).
 */
export function chooseSubject(candidates: readonly Subject[], history: readonly { kind: string | null; id: string | null }[]): Subject | null {
  if (candidates.length === 0) return null;
  const last = (s: Subject) => {
    const i = history.findIndex((h) => h.kind && keyOf({ kind: h.kind, id: h.id }) === keyOf(s));
    return i < 0 ? Number.POSITIVE_INFINITY : i; // larger = longer ago
  };
  return candidates.reduce((best, s) => (last(s) > last(best) ? s : best), candidates[0]);
}

/** Posts each app still has room for today: the owner's posts per app (within the plan's), less what it has. */
export function appRoom<N extends string>(apps: readonly N[], perApp: number, planLimit: number, madeToday: Partial<Record<N, number>>): Partial<Record<N, number>> {
  const want = Math.max(1, Math.min(Math.floor(perApp) || 1, Math.max(1, Math.floor(planLimit))));
  return Object.fromEntries(apps.map((n) => [n, Math.max(0, want - (madeToday[n] ?? 0))])) as Partial<Record<N, number>>;
}
