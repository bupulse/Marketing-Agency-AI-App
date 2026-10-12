import "server-only";
import type { BillingInterval, BillingProvider } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Plan } from "@/lib/plans";
import { getPlans, planForPriceId, priceIdFor, toPublic, type PlanView, type PublicPlan } from "@/lib/plan-catalog";
import { DEFAULT_REGION_KEY, type PaymentMethod, type RegionInfo } from "@/lib/region-format";
import { companyRegion, getRegion } from "@/lib/region";

// What a region's clients can buy, with the region's prices (PlanRegionPrice). A plan is offered in a region only
// when it has a price there. GLOBAL is special: its prices ARE the plan's own prices from the plan builder (the
// existing Paddle flow, price changes with notice and all), so its rows only say "offered here" and their amounts
// are never read. A plan with no regional price at all (one an admin just created) is offered in GLOBAL at its own
// price, so the plan builder keeps working as before.

export type RegionPriceRow = {
  planKey: string;
  regionKey: string;
  currency: string;
  monthlyMinor: number;
  yearlyMinor: number;
  cardMonthlyUsdCents: number | null;
  cardYearlyUsdCents: number | null;
  paddleMonthlyPriceId: string | null;
  paddleYearlyPriceId: string | null;
};

/** A plan as one region sees it: PublicPlan with the region's amounts and currency, plus how it can be paid. */
export type RegionalPlan = PublicPlan & {
  regionKey: string;
  paymentMethods: PaymentMethod[];
  /** The card (USD) price of a local-currency plan, or null when the price is already in USD. */
  card: { monthlyUsdCents: number; yearlyUsdCents: number } | null;
};

const TTL_MS = 30_000;
let lastGood: RegionPriceRow[] | null = null;
let fetchedAt = 0;

export function clearRegionPriceCache() {
  fetchedAt = 0;
}
export function resetRegionPriceCache() {
  fetchedAt = 0;
  lastGood = null;
}

/** Every regional price. Cached for 30 s; on a database error the last good copy, or none (GLOBAL then falls back to the plans). */
export async function getRegionPrices(opts: { force?: boolean; now?: number; strict?: boolean } = {}): Promise<RegionPriceRow[]> {
  const now = opts.now ?? Date.now();
  if (!opts.force && lastGood && now - fetchedAt < TTL_MS) return lastGood;
  try {
    const rows = await prisma.planRegionPrice.findMany();
    lastGood = rows.map((r) => ({
      planKey: r.planKey,
      regionKey: r.regionKey,
      currency: r.currency.toUpperCase(),
      monthlyMinor: r.monthlyMinor,
      yearlyMinor: r.yearlyMinor,
      cardMonthlyUsdCents: r.cardMonthlyUsdCents,
      cardYearlyUsdCents: r.cardYearlyUsdCents,
      paddleMonthlyPriceId: r.paddleMonthlyPriceId,
      paddleYearlyPriceId: r.paddleYearlyPriceId,
    }));
    fetchedAt = now;
    return lastGood;
  } catch (error) {
    if (opts.strict) throw error;
    return lastGood ?? [];
  }
}

/** Pure: the plans offered in a region with that region's prices (see the rules at the top). Hidden and retired plans are left out. */
export function regionalPlansFor(plans: PlanView[], prices: RegionPriceRow[], region: RegionInfo): RegionalPlan[] {
  const out: RegionalPlan[] = [];
  for (const plan of plans) {
    if (plan.isTrial || plan.status !== "active") continue;
    const row = prices.find((p) => p.planKey === plan.key && p.regionKey === region.key);
    const isGlobal = region.key === DEFAULT_REGION_KEY || region.countries.length === 0;
    if (isGlobal) {
      const pricedAnywhere = prices.some((p) => p.planKey === plan.key);
      if (!row && pricedAnywhere) continue;
      out.push({ ...toPublic(plan), currency: plan.currency, regionKey: region.key, paymentMethods: region.paymentMethods, card: null });
      continue;
    }
    if (!row) continue;
    const local = row.currency !== "USD";
    out.push({
      ...toPublic(plan),
      currency: row.currency,
      monthlyPriceCents: row.monthlyMinor,
      yearlyPriceCents: row.yearlyMinor,
      regionKey: region.key,
      paymentMethods: region.paymentMethods,
      card: local && row.cardMonthlyUsdCents != null && row.cardYearlyUsdCents != null ? { monthlyUsdCents: row.cardMonthlyUsdCents, yearlyUsdCents: row.cardYearlyUsdCents } : null,
    });
  }
  return out;
}

/** The plans a region's visitors or clients can buy, in sort order. */
export async function getRegionPlans(regionKey: string): Promise<RegionalPlan[]> {
  const region = await getRegion(regionKey);
  if (!region) return [];
  const [plans, prices] = await Promise.all([getPlans(), getRegionPrices()]);
  return regionalPlansFor(plans, prices, region);
}

export async function regionPlan(regionKey: string, planKey: string): Promise<RegionalPlan | null> {
  return (await getRegionPlans(regionKey)).find((p) => p.key === planKey) ?? null;
}

/** The plans a company can buy, at its own region's prices. */
export async function companyPlans(businessId: string): Promise<{ region: RegionInfo; plans: RegionalPlan[] }> {
  const region = await companyRegion(businessId);
  const [plans, prices] = await Promise.all([getPlans(), getRegionPrices()]);
  return { region, plans: regionalPlansFor(plans, prices, region) };
}

/**
 * The provider price id a company in `regionKey` checks out with. GLOBAL uses the plan's own ids (lib/plan-catalog.ts);
 * other regions need their own ids on the PlanRegionPrice row, which the Paddle sync (TODO, docs/REGIONS.md) fills.
 * Null when the plan is not offered in the region or the region's prices are not in Paddle yet.
 */
export async function regionPriceIdFor(provider: BillingProvider, planKey: string, regionKey: string, interval: BillingInterval): Promise<string | null> {
  const plan = await regionPlan(regionKey, planKey);
  if (!plan) return null;
  const region = await getRegion(regionKey);
  const isGlobal = !region || region.key === DEFAULT_REGION_KEY || region.countries.length === 0;
  if (isGlobal) return priceIdFor(provider, planKey, interval);
  if (provider !== "PADDLE") return null;
  const row = (await getRegionPrices()).find((p) => p.planKey === planKey && p.regionKey === regionKey);
  return (interval === "YEAR" ? row?.paddleYearlyPriceId : row?.paddleMonthlyPriceId) ?? null;
}

/**
 * Which plan and interval a provider price id stands for: the plans' own ids first (lib/plan-catalog.ts), then a
 * region's own Paddle price (PlanRegionPrice.paddle*PriceId, used by the RW card and EAC prices). `regionKey` is set
 * for the latter. Null when the id is not ours.
 */
export async function planForAnyPriceId(provider: BillingProvider, priceId: string, opts: { strict?: boolean } = {}): Promise<{ plan: Plan; interval: BillingInterval; regionKey?: string } | null> {
  const own = await planForPriceId(provider, priceId, opts);
  if (own || provider !== "PADDLE") return own;
  // `strict` (webhooks): a database error is thrown, never answered as "not ours", so Paddle retries instead of the event
  // being parked as unmapped.
  const rows = await getRegionPrices({ force: true, strict: opts.strict });
  const row = rows.find((p) => p.paddleMonthlyPriceId === priceId || p.paddleYearlyPriceId === priceId);
  if (!row) return null;
  return { plan: row.planKey, interval: row.paddleMonthlyPriceId === priceId ? "MONTH" : "YEAR", regionKey: row.regionKey };
}
