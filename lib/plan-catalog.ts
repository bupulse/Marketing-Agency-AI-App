import "server-only";
import { prisma } from "@/lib/db";
import {
  CAPABILITIES,
  SEATS_MAX,
  SEATS_MIN,
  SEED_PLANS,
  USAGE_METRICS,
  type Capability,
  type Plan,
  type PlanLimits,
  type PlanStatus,
  type UsageMetric,
} from "@/lib/plans";
import type { BillingInterval, BillingProvider } from "@/lib/generated/prisma/client";

export type PaddlePriceRecord = { id: string; interval: BillingInterval; amountCents: number; createdAt: string; archivedAt?: string };

/** A plan as the rest of the app sees it. */
export interface PlanView {
  id: string;
  key: Plan;
  name: string;
  description: string;
  isTrial: boolean;
  trialDays: number | null;
  status: PlanStatus;
  sortOrder: number;
  highlight: boolean;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  currency: string;
  limits: PlanLimits;
  features: string[];
  capabilities: Record<Capability, boolean>;
  paddleProductId: string | null;
  paddleMonthlyPriceId: string | null;
  paddleYearlyPriceId: string | null;
  paddlePrices: PaddlePriceRecord[];
  syncState: "not_synced" | "synced" | "failed";
  syncError: string | null;
  /** The row's last change, to detect two admins editing at once. Null for the built-in fallback. */
  updatedAt: Date | null;
}

/** The part of a plan that is safe to send to the browser (no Paddle ids). */
export interface PublicPlan {
  key: Plan;
  name: string;
  description: string;
  isTrial: boolean;
  trialDays: number | null;
  highlight: boolean;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  limits: PlanLimits;
  features: string[];
  capabilities: Record<Capability, boolean>;
}

export function toPublic(p: PlanView): PublicPlan {
  return {
    key: p.key,
    name: p.name,
    description: p.description,
    isTrial: p.isTrial,
    trialDays: p.trialDays,
    highlight: p.highlight,
    monthlyPriceCents: p.monthlyPriceCents,
    yearlyPriceCents: p.yearlyPriceCents,
    limits: p.limits,
    features: p.features,
    capabilities: p.capabilities,
  };
}

const TTL_MS = 30_000;
// lastGood survives cache clears and database errors, so a blip never brings the defaults back over the admin's edits.
let lastGood: PlanView[] | null = null;
let fetchedAt = 0;

/** Marks the cache stale. The writer calls this so its own isolate sees a change at once; others catch up within 30 s. */
export function clearPlanCache() {
  fetchedAt = 0;
}
/** For tests: forget everything, including the last good copy. */
export function resetPlanCache() {
  fetchedAt = 0;
  lastGood = null;
}

export function cleanLimits(value: unknown, base?: PlanLimits): PlanLimits {
  const out: PlanLimits = { ...(base ?? { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0, chat: 0, seats: SEATS_MIN }) };
  if (value && typeof value === "object") {
    for (const m of USAGE_METRICS) {
      const v = (value as Record<string, unknown>)[m];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[m as UsageMetric] = v;
    }
    const seats = (value as Record<string, unknown>).seats;
    if (typeof seats === "number" && Number.isInteger(seats)) out.seats = Math.min(Math.max(seats, SEATS_MIN), SEATS_MAX);
  }
  return out;
}

function cleanCapabilities(value: unknown): Record<Capability, boolean> {
  const out = Object.fromEntries(CAPABILITIES.map((c) => [c, false])) as Record<Capability, boolean>;
  if (value && typeof value === "object") for (const c of CAPABILITIES) out[c] = (value as Record<string, unknown>)[c] === true;
  return out;
}

function cleanFeatures(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function cleanPrices(value: unknown): PaddlePriceRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is PaddlePriceRecord => !!v && typeof v === "object" && typeof (v as PaddlePriceRecord).id === "string");
}

type Row = Record<string, unknown>;
export function viewOf(row: Row): PlanView {
  const status = row.status === "hidden" || row.status === "retired" ? row.status : "active";
  const sync = row.syncState === "synced" || row.syncState === "failed" ? row.syncState : "not_synced";
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description ?? ""),
    isTrial: row.isTrial === true,
    trialDays: typeof row.trialDays === "number" ? row.trialDays : null,
    status,
    sortOrder: Number(row.sortOrder ?? 0),
    highlight: row.highlight === true,
    monthlyPriceCents: Number(row.monthlyPriceCents ?? 0),
    yearlyPriceCents: Number(row.yearlyPriceCents ?? 0),
    currency: String(row.currency ?? "USD"),
    // A plan saved before seats existed gets the seats it was seeded with (1 for plans created later).
    limits: cleanLimits(row.limits, { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0, chat: 0, seats: SEED_PLANS[String(row.key)]?.limits.seats ?? SEATS_MIN }),
    features: cleanFeatures(row.features),
    capabilities: cleanCapabilities(row.capabilities),
    paddleProductId: (row.paddleProductId as string | null) ?? null,
    paddleMonthlyPriceId: (row.paddleMonthlyPriceId as string | null) ?? null,
    paddleYearlyPriceId: (row.paddleYearlyPriceId as string | null) ?? null,
    paddlePrices: cleanPrices(row.paddlePrices),
    syncState: sync,
    syncError: (row.syncError as string | null) ?? null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
  };
}

function seedViews(): PlanView[] {
  return Object.entries(SEED_PLANS).map(([key, c]) =>
    viewOf({
      id: `seed_${key}`,
      key,
      name: c.name,
      description: c.description,
      isTrial: c.isTrial,
      trialDays: c.trialDays,
      status: "active",
      sortOrder: c.sortOrder,
      highlight: c.highlight,
      monthlyPriceCents: c.priceUsdMonthly * 100,
      yearlyPriceCents: c.priceUsdYearly * 100,
      currency: "USD",
      limits: c.limits,
      features: c.features,
      capabilities: c.capabilities,
    }),
  );
}

/** Every plan (any status), in sort order. Cached for 30 s; on a database error the last good copy (or the seed plans) is used. */
export async function getPlans(opts: { force?: boolean; now?: number } = {}): Promise<PlanView[]> {
  const now = opts.now ?? Date.now();
  if (!opts.force && lastGood && now - fetchedAt < TTL_MS) return lastGood;
  try {
    const rows = (await prisma.planDefinition.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })) as Row[];
    if (!rows || rows.length === 0) throw new Error("no plans in the database");
    lastGood = rows.map(viewOf).sort((a, b) => a.sortOrder - b.sortOrder);
    fetchedAt = now;
    return lastGood;
  } catch {
    // The database blinking must never stop generation or reset limits: keep the last good copy, and retry on the next call.
    return lastGood ?? seedViews();
  }
}

export async function getPlan(key: string): Promise<PlanView | null> {
  return (await getPlans()).find((p) => p.key === key) ?? null;
}

/** The free trial plan. */
export async function getTrialPlan(): Promise<PlanView> {
  const plans = await getPlans();
  return plans.find((p) => p.isTrial) ?? seedViews().find((p) => p.isTrial)!;
}

/** Plans a new client can buy: active, not the trial, in sort order. */
export async function getSellablePlans(): Promise<PlanView[]> {
  return (await getPlans()).filter((p) => p.status === "active" && !p.isTrial);
}

/** A plan's capability. An unknown plan has none. */
export async function planHasCapability(key: string, capability: Capability): Promise<boolean> {
  return (await getPlan(key))?.capabilities[capability] === true;
}

export async function getPlanLimits(key: string): Promise<PlanLimits> {
  return (await getPlan(key))?.limits ?? cleanLimits(null);
}

export function priceCents(plan: Pick<PlanView, "monthlyPriceCents" | "yearlyPriceCents">, interval: BillingInterval): number {
  return interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
}

// ---- Paddle price ids ---------------------------------------------------------------------------------------------

/** Env fallback: PADDLE_PRICE_<KEY>_<MONTH|YEAR>. The seed source for the original plans (their price ids are not in the migration). */
export function envPriceName(provider: BillingProvider, planKey: string, interval: BillingInterval) {
  return `${provider}_PRICE_${planKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${interval}`;
}

/** The current provider price id of a plan: the database first, the environment for plans that were never synced. */
export function currentPriceId(provider: BillingProvider, plan: PlanView, interval: BillingInterval): string | null {
  const own = provider === "PADDLE" ? (interval === "YEAR" ? plan.paddleYearlyPriceId : plan.paddleMonthlyPriceId) : null;
  return own || process.env[envPriceName(provider, plan.key, interval)] || null;
}

export async function priceIdFor(provider: BillingProvider, planKey: string, interval: BillingInterval): Promise<string | null> {
  const plan = await getPlan(planKey);
  return plan ? currentPriceId(provider, plan, interval) : null;
}

/**
 * Which plan and interval a provider price id stands for, or null if it is not ours. Current ids and every old id in a
 * plan's price history count, so subscriptions still on an old price keep their plan.
 */
export async function planForPriceId(provider: BillingProvider, priceId: string): Promise<{ plan: Plan; interval: BillingInterval } | null> {
  const plans = await getPlans();
  for (const plan of plans) {
    for (const interval of ["MONTH", "YEAR"] as const) {
      if (currentPriceId(provider, plan, interval) === priceId) return { plan: plan.key, interval };
    }
    if (provider === "PADDLE") {
      const old = plan.paddlePrices.find((p) => p.id === priceId);
      if (old) return { plan: plan.key, interval: old.interval };
    }
  }
  return null;
}

/** What a subscriber's price id actually costs (their old price until the plan's price change reaches them), in cents. */
export function subscriberPriceCents(plan: PlanView, priceId: string | null | undefined, interval: BillingInterval): number {
  const known = priceId ? plan.paddlePrices.find((p) => p.id === priceId) : undefined;
  return known ? known.amountCents : priceCents(plan, interval);
}

/** The plans' current prices by key, for MRR sums. */
export async function getPriceTable(): Promise<Record<string, { monthlyPriceCents: number; yearlyPriceCents: number }>> {
  return Object.fromEntries((await getPlans()).map((p) => [p.key, { monthlyPriceCents: p.monthlyPriceCents, yearlyPriceCents: p.yearlyPriceCents }]));
}

/** The trial as marketing copy needs it: length and the limits it includes. */
export async function getTrialInfo(): Promise<{ days: number; text: number; images: number }> {
  const t = await getTrialPlan();
  return { days: t.trialDays ?? 7, text: t.limits.text, images: t.limits.image };
}
