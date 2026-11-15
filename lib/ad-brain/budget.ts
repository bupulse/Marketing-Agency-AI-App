// The Ad Brain's spend limits (owner decision, 10 November 2026): $3 per ad and $30 a month, set in Admin -> Settings.
// Every paid call is checked here first with its estimate; the ad stops before passing either limit and says why.
// The real cost of each call is in the AI ledger (feature "adBrain"). Unit prices from docs/AD_BRAIN.md section 4
// (verify them against the bills; docs/AI_COSTS.md "Ad Brain"). Pure.

export const AD_BRAIN_FEATURE = "adBrain";
export const DEFAULT_AD_LIMITS = { perAdUsd: 3, monthlyUsd: 30 } as const;
export type AdLimits = { perAdUsd: number; monthlyUsd: number };

/** What one unit of each paid thing costs, in USD (10 Nov 2026 list prices and measured calls). */
export const UNIT_USD = {
  /** Nano Banana 2.1, one 1K image (a portrait or an identity edit). */
  frame: 0.034,
  /** Gemini Omni Flash at 720p, per second of clip. */
  clipSecond: 0.1014,
  /** Lyria 3 Clip, one 30 s track. */
  music: 0.04,
  /** Gemini TTS, one short line. */
  voice: 0.002,
  /** Gemini 3.8 Flash, one brain step (brand brief, concept, script). */
  think: 0.01,
  /** Gemini 3.8 Flash word timings of one clip or line. */
  words: 0.004,
  /** Gemini 3.8 Flash watching and listening to the finished ad. */
  judge: 0.02,
} as const;

export type CostLine = { label: string; usd: number };

const round = (n: number) => Math.round(n * 10_000) / 10_000;
export const usd = (n: number) => `$${n.toFixed(2)}`;

/** The estimate of a list of paid things, with its lines (for Admin and the stop message). */
export function estimate(lines: CostLine[]): { totalUsd: number; lines: CostLine[] } {
  return { totalUsd: round(lines.reduce((s, l) => s + l.usd, 0)), lines };
}

export const clipCost = (seconds: number) => round(seconds * UNIT_USD.clipSecond);

export type SpendCheck = { ok: true } | { ok: false; limit: "ad" | "month"; message: string };

/**
 * May a paid step costing about `nextUsd` go ahead? It may not take the ad past its limit, nor the month past the
 * monthly limit. `what` names the step for the message ("a 7 s AI clip").
 */
export function checkSpend(input: { adSpentUsd: number; monthSpentUsd: number; nextUsd: number; limits: AdLimits; what: string }): SpendCheck {
  const { adSpentUsd, monthSpentUsd, nextUsd, limits, what } = input;
  if (adSpentUsd + nextUsd > limits.perAdUsd + 1e-9)
    return { ok: false, limit: "ad", message: `Stopped before passing this ad's ${usd(limits.perAdUsd)} limit: it has spent ${usd(adSpentUsd)} and the next step (${what}, about ${usd(nextUsd)}) would pass it. Raise the limit in Admin -> Settings or make a shorter ad.` };
  if (monthSpentUsd + nextUsd > limits.monthlyUsd + 1e-9)
    return { ok: false, limit: "month", message: `Stopped before passing this month's ${usd(limits.monthlyUsd)} Ad Brain limit: ${usd(monthSpentUsd)} is spent and the next step (${what}, about ${usd(nextUsd)}) would pass it. It starts again on the 1st, or raise the limit in Admin -> Settings.` };
  return { ok: true };
}

/**
 * Before any asset is paid for: does the whole plan fit the ad's limit (what is left of it) with a margin for one
 * re-roll and the judge? Returns the message to stop with, or null.
 */
export function planFits(input: { planUsd: number; adSpentUsd: number; monthSpentUsd: number; limits: AdLimits }): string | null {
  const need = input.planUsd + UNIT_USD.judge * 2;
  if (input.adSpentUsd + need > input.limits.perAdUsd + 1e-9)
    return `This plan would cost about ${usd(input.adSpentUsd + need)}, more than the ${usd(input.limits.perAdUsd)} limit per ad, so nothing was paid for. The brain is asked for a shorter plan.`;
  if (input.monthSpentUsd + need > input.limits.monthlyUsd + 1e-9)
    return `This ad would take the month to about ${usd(input.monthSpentUsd + need)}, past the ${usd(input.limits.monthlyUsd)} monthly limit, so it stopped before paying for anything. It starts again on the 1st, or raise the limit in Admin -> Settings.`;
  return null;
}
