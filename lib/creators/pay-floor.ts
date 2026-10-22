// The fair range of a rate per views (docs/CREATOR_CAMPAIGN_WIZARD.md, "Pay"). Pure, so the wizard's meter, the server
// check and the tests agree.
//
// Owner decision (22 October 2026): the owner picks both the number of views and the price, but the price cannot be
// low: at least 1,000 RWF for every 1,000 views (about $0.68). For comparison, clipping and UGC campaigns paid about
// $0.30-$6 per 1,000 views in 2026, typically $1. Other currencies use about the same value in whole units.

import type { PayRules } from "./pay";

/** The views a rate can be priced for. */
export const RATE_VIEWS = [1_000, 10_000, 100_000, 1_000_000] as const;
export type RateViews = (typeof RATE_VIEWS)[number];

/** The least a campaign pays for 1,000 views, in whole units of each currency (about $0.68). */
export const MIN_RATE_PER_THOUSAND: Record<string, number> = { RWF: 1_000, USD: 1, KES: 90, UGX: 2_500, TZS: 1_800, BIF: 2_000 };

/** "Fair" up to this many times the floor, "Generous" above; more than the max is refused as a typing mistake. */
const GENEROUS_FROM = 3;
const MAX_TIMES = 20;

export type RateLevel = "LOW" | "FAIR" | "GENEROUS" | "TOO_HIGH";
export const RATE_LEVEL_LABEL: Record<RateLevel, string> = { LOW: "Too low", FAIR: "Fair", GENEROUS: "Generous", TOO_HIGH: "Too high" };

/** The floor for `views` views in `currency` (the RWF floor when the currency is not listed). */
export function minRate(currency: string, views: number = 1_000): number {
  return Math.ceil(((MIN_RATE_PER_THOUSAND[currency] ?? MIN_RATE_PER_THOUSAND.RWF) * views) / 1_000);
}

/** The most a rate can be for `views` views: higher is taken as a typing mistake. */
export function maxRate(currency: string, views: number = 1_000): number {
  return minRate(currency, views) * MAX_TIMES;
}

/** A starting suggestion: 1.5 times the floor, a round number. */
export function suggestedRate(currency: string, views: number = 1_000): number {
  const raw = minRate(currency, views) * 1.5;
  const step = raw >= 1_000 ? 500 : raw >= 100 ? 50 : 1;
  return Math.ceil(raw / step) * step;
}

/** Where `amount` for `views` views sits, for the meter under the price. */
export function rateLevel(amount: number, views: number, currency: string): RateLevel {
  const floor = minRate(currency, views);
  if (amount < floor) return "LOW";
  if (amount > maxRate(currency, views)) return "TOO_HIGH";
  return amount >= floor * GENEROUS_FROM ? "GENEROUS" : "FAIR";
}

/** Why the rules' rate per views is refused, or null when it is fine (no rate is fine: fees or milestones pay). */
export function rateProblem(rules: PayRules, currency: string): string | null {
  if (!rules.ratePerThousand) return null;
  const views = rules.rateViews ?? 1_000;
  const level = rateLevel(rules.ratePerThousand, views, currency);
  const per = `${views.toLocaleString("en-US")} views`;
  if (level === "LOW") return `Pay at least ${minRate(currency, views).toLocaleString("en-US")} ${currency} for every ${per}: less is below what creators earn elsewhere.`;
  if (level === "TOO_HIGH") return `${rules.ratePerThousand.toLocaleString("en-US")} ${currency} for every ${per} looks like a typing mistake: the most is ${maxRate(currency, views).toLocaleString("en-US")} ${currency}.`;
  return null;
}
