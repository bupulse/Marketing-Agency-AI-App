// Custom plans and offers (docs/OFFERS.md): the add-on catalog, the price maths and the offer rules. Pure (no server
// imports), so the admin editor's live total, the server's frozen total and the tests all compute the same thing.

import { z } from "zod";
import { featureLabel, FEATURES, isFeatureKey, sortFeatureKeys, validateFeatureSet, withPrerequisites, type FeatureKey } from "@/lib/features";
import { addMonths as addMonthsUtc } from "@/lib/billing/period";
import { cardUsdCents } from "@/lib/region-format";
import { SEATS_MAX, SEATS_MIN, VIDEO_PLAN_VIDEOS, VOICE_PLAN_CHARACTERS, type PlanLimits, POSTS_PER_APP_MAX, POSTS_PER_APP_MIN, postsPerAppLimit } from "@/lib/plans";

/** A yearly custom plan costs this many months (the regional plans' rule: yearly = 10 months). */
export const YEARLY_MONTHS = 10;
/** How long a sent offer stays open by default. */
export const OFFER_VALID_DAYS = 7;
export const OFFER_VALID_DAYS_MAX = 60;
export const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIMIT = 10_000_000;
export const MAX_OFFER_MINOR = 2_000_000_000;

// ---- the add-on catalog ---------------------------------------------------------------------------------------------

/** The limits an offer can raise by blocks (videos and voice characters stay the base plan's). */
export const OFFER_METRICS = ["text", "image", "chat"] as const;
export type OfferMetric = (typeof OFFER_METRICS)[number];

export const MANAGED_TIERS = ["light", "full"] as const;
export type ManagedTier = (typeof MANAGED_TIERS)[number];
export const MANAGED_TIER_LABEL: Record<ManagedTier, string> = {
  light: "Light: 12 posts a month made and published for you",
  full: "Full: 20 posts a month, designs, comment replies and a monthly report",
};

export type AddonDef =
  | { key: string; kind: "feature"; feature: FeatureKey; label: string; includes?: { metric: OfferMetric; amount: number } }
  | { key: string; kind: "block"; metric: OfferMetric; blockSize: number; label: string }
  | { key: "seat"; kind: "seat"; label: string };

const FEATURE_INCLUDES: Partial<Record<FeatureKey, { metric: OfferMetric; amount: number }>> = {
  aiPhotos: { metric: "image", amount: 30 },
  websiteChat: { metric: "chat", amount: 500 },
  // "Social replies" in docs/bizdev/PLAN.md: the automations' AI replies.
  automations: { metric: "chat", amount: 1000 },
};

/**
 * Every priced add-on. Features use their registry key, except Managed by BuPulse, which has two tiers. A feature with
 * no price in a region is shown as "no price set" in the editor (the core features usually come with the base plan).
 */
export const ADDONS: readonly AddonDef[] = [
  ...FEATURES.filter((f) => f.status === "built" && f.key !== "managed").map((f): AddonDef => ({ key: f.key, kind: "feature", feature: f.key, label: f.label, ...(FEATURE_INCLUDES[f.key] ? { includes: FEATURE_INCLUDES[f.key] } : {}) })),
  { key: "managed:light", kind: "feature", feature: "managed", label: "Managed by BuPulse, Light" },
  { key: "managed:full", kind: "feature", feature: "managed", label: "Managed by BuPulse, Full" },
  { key: "block:text", kind: "block", metric: "text", blockSize: 100, label: "+100 AI texts" },
  { key: "block:image", kind: "block", metric: "image", blockSize: 50, label: "Image pack (+50 AI images)" },
  { key: "block:chat", kind: "block", metric: "chat", blockSize: 1000, label: "+1,000 chat replies" },
  { key: "seat", kind: "seat", label: "Extra user" },
];
export const ADDON_KEYS = ADDONS.map((a) => a.key);
export const isAddonKey = (v: unknown): v is string => typeof v === "string" && ADDON_KEYS.includes(v);
export const addonOf = (key: string) => ADDONS.find((a) => a.key === key) ?? null;

/** The price key of a feature in an offer (Managed by BuPulse is priced by tier). */
export const featureAddonKey = (key: FeatureKey, tier: ManagedTier = "light") => (key === "managed" ? `managed:${tier}` : key);

export const METRIC_LABEL: Record<OfferMetric | "seats" | "postsPerAppPerDay", string> = { text: "AI texts a month", image: "AI images a month", chat: "Chat replies a month", seats: "Users", postsPerAppPerDay: "Posts per app per day" };

// ---- pricing ------------------------------------------------------------------------------------------------------

export type AddonPriceRow = { addonKey: string; regionKey: string; currency: string; monthlyMinor: number };
/** A regional plan to start from: its price in the region's currency, what it includes. */
export type OfferBase = { key: string; name: string; monthlyMinor: number; yearlyMinor: number; features: readonly FeatureKey[]; limits: PlanLimits };
/** `postsPerAppPerDay` (1 to 10) is set, not priced: how many posts per app a day the custom plan makes (docs/CONTENT.md). */
export type OfferLimits = Pick<PlanLimits, OfferMetric | "seats"> & { postsPerAppPerDay?: number };

export type PricedLine = { key: string; label: string; quantity: number; unitMinor: number; totalMinor: number; missingPrice?: boolean };

export type OfferQuoteInput = {
  base: OfferBase | null;
  features: readonly string[];
  limits: OfferLimits;
  managedTier?: ManagedTier;
  interval: "MONTH" | "YEAR";
  currency: string;
  regionKey: string;
  prices: readonly AddonPriceRow[];
};

export type OfferQuote = {
  /** The plan's features: the base plan's, what was ticked, and every prerequisite (Managed Full brings Analytics). */
  features: FeatureKey[];
  /** The features the offer adds on top of the base plan. */
  added: FeatureKey[];
  /** The custom plan's limits (videos and voiceCharacters stay the base plan's, except video added as an add-on). */
  limits: PlanLimits;
  /** What the base plan and the add-ons already include before any block is bought. */
  included: OfferLimits;
  lines: PricedLine[];
  computedMinor: number;
  /** Labels of the lines that have no price in this region (priced at 0 until the admin adds one). */
  missing: string[];
};

/** The ticked features with their prerequisites; Managed Full also needs Analytics. Coming-soon and unknown keys are dropped. */
export function resolveOfferFeatures(features: readonly string[], managedTier: ManagedTier = "light", base: readonly FeatureKey[] = []): FeatureKey[] {
  const keys = new Set<string>([...base, ...features]);
  if (keys.has("managed") && managedTier === "full") keys.add("analytics");
  return withPrerequisites([...keys].filter((k) => isFeatureKey(k) && FEATURES.find((f) => f.key === k)?.status === "built"));
}

function priceOf(prices: readonly AddonPriceRow[], key: string, regionKey: string, currency: string): number | null {
  const row = prices.find((p) => p.addonKey === key && p.regionKey === regionKey && p.currency.toUpperCase() === currency.toUpperCase());
  return row && Number.isInteger(row.monthlyMinor) && row.monthlyMinor >= 0 ? row.monthlyMinor : null;
}

const EMPTY_LIMITS: PlanLimits = { text: 0, image: 0, videos: 0, voiceCharacters: 0, chat: 0, seats: SEATS_MIN };

/**
 * What a custom plan includes before any block is bought: the base plan's limits plus what each added feature brings
 * (website chat: 500 chat replies; AI photos: 30 images). The editor's fields start there and never go below it.
 */
export function offerIncluded(base: OfferBase | null, features: readonly string[], managedTier: ManagedTier = "light"): OfferLimits {
  const baseFeatures = base?.features ?? [];
  const baseLimits = base?.limits ?? EMPTY_LIMITS;
  const included: OfferLimits = { text: baseLimits.text, image: baseLimits.image, chat: baseLimits.chat, seats: baseLimits.seats, postsPerAppPerDay: postsPerAppLimit(baseLimits) };
  for (const key of resolveOfferFeatures(features, managedTier, baseFeatures)) {
    if (baseFeatures.includes(key)) continue;
    const addon = addonOf(featureAddonKey(key, managedTier));
    const inc = addon?.kind === "feature" ? addon.includes : undefined;
    if (inc) included[inc.metric] += inc.amount;
  }
  return included;
}

/**
 * A plan's limits with every included amount kept: a feature in the plan that brings units (website chat, AI photos)
 * never ends up with less than it includes. A limit of 0 would refuse every use (lib/usage.ts consumeUsage), so the
 * client's chat would never answer. Used when a custom plan is made from an offer that was saved before this rule.
 */
export function withIncludedLimits<T extends Pick<PlanLimits, OfferMetric>>(limits: T, features: readonly string[]): T {
  const out = { ...limits };
  for (const key of features) {
    const inc = isFeatureKey(key) ? FEATURE_INCLUDES[key] : undefined;
    if (inc && !(out[inc.metric] >= inc.amount)) out[inc.metric] = inc.amount;
  }
  return out;
}

/**
 * The offer's priced lines and total for its interval, from the base plan's regional price and the region's add-on
 * prices: one line per feature added on top of the base plan, then blocks for limits above what is included, then
 * extra users. Yearly add-ons cost YEARLY_MONTHS months; a yearly base plan costs its own yearly price.
 */
export function quoteOffer(input: OfferQuoteInput): OfferQuote {
  const tier = input.managedTier ?? "light";
  const yearly = input.interval === "YEAR";
  const months = yearly ? YEARLY_MONTHS : 1;
  const baseFeatures = input.base?.features ?? [];
  const baseLimits = input.base?.limits ?? EMPTY_LIMITS;
  const features = resolveOfferFeatures(input.features, tier, baseFeatures);
  const added = features.filter((k) => !baseFeatures.includes(k));
  const lines: PricedLine[] = [];
  const missing: string[] = [];
  const line = (key: string, label: string, quantity: number, monthly: number | null) => {
    const unitMinor = (monthly ?? 0) * months;
    lines.push({ key, label, quantity, unitMinor, totalMinor: unitMinor * quantity, ...(monthly === null ? { missingPrice: true } : {}) });
    if (monthly === null) missing.push(label);
  };
  if (input.base) lines.push({ key: `plan:${input.base.key}`, label: `${input.base.name} plan`, quantity: 1, unitMinor: yearly ? input.base.yearlyMinor : input.base.monthlyMinor, totalMinor: yearly ? input.base.yearlyMinor : input.base.monthlyMinor });

  const included = offerIncluded(input.base, input.features, tier);
  for (const key of added) {
    const def = FEATURES.find((f) => f.key === key);
    if (!def) continue;
    const addonKey = featureAddonKey(key, tier);
    const addon = addonOf(addonKey);
    const label = addon?.label ?? def.label;
    line(addonKey, label, 1, priceOf(input.prices, addonKey, input.regionKey, input.currency));
  }
  // A limit is never below what the plan and its features include (they are paid for already): 0 chat replies with
  // website chat in the plan would refuse every reply.
  const limit = (m: OfferMetric | "seats") => Math.max(input.limits[m], included[m]);
  for (const metric of OFFER_METRICS) {
    const extra = limit(metric) - included[metric];
    if (extra <= 0) continue;
    const block = ADDONS.find((a) => a.kind === "block" && a.metric === metric) as Extract<AddonDef, { kind: "block" }>;
    line(block.key, block.label, Math.ceil(extra / block.blockSize), priceOf(input.prices, block.key, input.regionKey, input.currency));
  }
  const extraSeats = limit("seats") - included.seats;
  if (extraSeats > 0) line("seat", "Extra user", extraSeats, priceOf(input.prices, "seat", input.regionKey, input.currency));

  return {
    features,
    added,
    // Video sold on top of a plan without it brings the video plans' seconds (8 videos of up to 30 s a month).
    limits: { ...baseLimits, text: limit("text"), image: limit("image"), chat: limit("chat"), seats: limit("seats"), postsPerAppPerDay: postsPerAppLimit({ postsPerAppPerDay: input.limits.postsPerAppPerDay ?? postsPerAppLimit(baseLimits) }), ...(added.includes("video") ? { videos: Math.max(baseLimits.videos, VIDEO_PLAN_VIDEOS) } : {}), ...(added.includes("voice") ? { voiceCharacters: Math.max(baseLimits.voiceCharacters, VOICE_PLAN_CHARACTERS) } : {}) },
    included,
    lines,
    computedMinor: lines.reduce((s, l) => s + l.totalMinor, 0),
    missing,
  };
}

/**
 * Removing a feature from an offer: the ticked features that need it (directly, through another one, or Analytics for
 * Managed Full). Empty when it can be removed. A base plan feature is never removable (the editor shows it as included).
 */
export function removalBlockedBy(key: FeatureKey, selected: readonly FeatureKey[], managedTier: ManagedTier = "light"): FeatureKey[] {
  return sortFeatureKeys(selected.filter((k) => k !== key && (withPrerequisites([k]).includes(key) || (k === "managed" && managedTier === "full" && withPrerequisites(["analytics"]).includes(key)))));
}

// ---- adding features to a running plan (mid-period) ---------------------------------------------------------------------

/**
 * Adding features to a plan that is paid and running (docs/OFFERS.md, "Adding features to a paid plan"): the client
 * pays now only for the added features, prorated for the days left in the current period; the period end does not move;
 * from the next renewal the price is the full new total (plan + added features).
 */
export type CurrentPlanForAddition = { key: string; name: string; priceMinor: number; features: readonly FeatureKey[]; limits: PlanLimits };

/** Days in the period of `interval` that ends at `end` (a month ending 1 November: the 31 days of October). */
export function periodDaysEnding(end: Date, interval: "MONTH" | "YEAR"): number {
  return Math.max(1, Math.round((end.getTime() - addMonthsUtc(end, interval === "YEAR" ? -12 : -1).getTime()) / DAY_MS));
}

/** Whole days left until `end` (a part of a day counts as one; 0 once it has passed). */
export const additionDaysLeft = (end: Date, now: Date) => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

/** `amountMinor` (a whole period's price) for `daysLeft` of `periodDays`, rounded to the currency's smallest unit (whole RWF, US cents). */
export function prorateMinor(amountMinor: number, daysLeft: number, periodDays: number): number {
  if (amountMinor <= 0 || daysLeft <= 0 || periodDays <= 0) return 0;
  return Math.round((amountMinor * daysLeft) / periodDays);
}

export type AdditionQuote = {
  /** The plan's features once the added ones are on (prerequisites included). */
  features: FeatureKey[];
  /** What is added on top of the current plan. */
  added: FeatureKey[];
  /** The plan's limits once the added features are on (an added feature's allowance raises its limit; no blocks are bought). */
  limits: PlanLimits;
  /** One line per added feature, for a whole period of the interval. */
  lines: PricedLine[];
  /** The sum of the lines (a whole period). */
  computedMinor: number;
  /** What the added features cost a whole period: the computed sum, or the admin's price. */
  addonMinor: number;
  missing: string[];
  currentMinor: number;
  /** From the next renewal: the current plan plus the added features. */
  nextRenewalMinor: number;
  daysLeft: number;
  periodDays: number;
  /** What the client pays now: `addonMinor` prorated for the days left. */
  dueNowMinor: number;
  /** The computed sum prorated the same way (the "before discount" figure). */
  computedDueMinor: number;
};

export function quoteAddition(input: {
  current: CurrentPlanForAddition;
  features: readonly string[];
  managedTier?: ManagedTier;
  interval: "MONTH" | "YEAR";
  currency: string;
  regionKey: string;
  prices: readonly AddonPriceRow[];
  periodEnd: Date;
  now: Date;
  /** The admin's price for the added features, a whole period (rounding or discount). */
  addonMinor?: number | null;
}): AdditionQuote {
  const base: OfferBase = { key: input.current.key, name: input.current.name, monthlyMinor: input.current.priceMinor, yearlyMinor: input.current.priceMinor, features: input.current.features, limits: input.current.limits };
  const cur = input.current.limits;
  const common = { base, features: input.features, managedTier: input.managedTier, interval: input.interval, currency: input.currency, regionKey: input.regionKey, prices: input.prices };
  // First what the added features include, then the limits raised to it, so no block is ever bought here.
  const first = quoteOffer({ ...common, limits: { text: cur.text, image: cur.image, chat: cur.chat, seats: cur.seats, postsPerAppPerDay: postsPerAppLimit(cur) } });
  const inc = first.included;
  const quote = quoteOffer({ ...common, limits: { text: Math.max(cur.text, inc.text), image: Math.max(cur.image, inc.image), chat: Math.max(cur.chat, inc.chat), seats: cur.seats, postsPerAppPerDay: postsPerAppLimit(cur) } });
  const lines = quote.lines.filter((l) => !l.key.startsWith("plan:"));
  const computedMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);
  const addonMinor = input.addonMinor ?? computedMinor;
  const periodDays = periodDaysEnding(input.periodEnd, input.interval);
  const daysLeft = additionDaysLeft(input.periodEnd, input.now);
  return {
    features: quote.features,
    added: quote.added,
    limits: quote.limits,
    lines,
    computedMinor,
    addonMinor,
    missing: quote.missing,
    currentMinor: input.current.priceMinor,
    nextRenewalMinor: input.current.priceMinor + addonMinor,
    daysLeft,
    periodDays,
    dueNowMinor: prorateMinor(addonMinor, daysLeft, periodDays),
    computedDueMinor: prorateMinor(computedMinor, daysLeft, periodDays),
  };
}

/** What an add-features offer stores (PlanOffer.options.addition), frozen when it is saved and again when accepted. */
export type OfferAddition = {
  currentPlanKey: string;
  currentPlanName: string;
  currentMinor: number;
  addonMinor: number;
  nextRenewalMinor: number;
  periodEnd: string;
  daysLeft: number;
  periodDays: number;
  /** Made by the client on Billing ("Add features"), not by the BuPulse team. */
  selfServe: boolean;
};

export function readAddition(options: unknown): OfferAddition | null {
  const o = options && typeof options === "object" ? (options as { mode?: unknown; addition?: unknown }) : {};
  const a = o.mode === "addon" && o.addition && typeof o.addition === "object" ? (o.addition as Record<string, unknown>) : null;
  if (!a) return null;
  const int = (k: string) => (typeof a[k] === "number" && Number.isInteger(a[k]) ? (a[k] as number) : 0);
  if (typeof a.currentPlanKey !== "string" || typeof a.periodEnd !== "string") return null;
  return { currentPlanKey: a.currentPlanKey, currentPlanName: typeof a.currentPlanName === "string" ? a.currentPlanName : a.currentPlanKey, currentMinor: int("currentMinor"), addonMinor: int("addonMinor"), nextRenewalMinor: int("nextRenewalMinor"), periodEnd: a.periodEnd, daysLeft: int("daysLeft"), periodDays: int("periodDays"), selfServe: a.selfServe === true };
}

/** Why an add-features quote was cancelled, as the client reads it on Billing (the period it was priced for changed). */
export const STALE_ADDITION_REASON = "Your plan's period changed after these features were priced (for example, it was renewed), so that quote was cancelled. Add the features again, or ask us, for a new quote.";

/**
 * Whether an addition still fits the running subscription: the same plan and interval, paid by Mobile Money, ACTIVE,
 * and exactly the period end it was prorated for. Anything else (a renewal moved the end, another plan) makes the
 * prorated amount wrong, so the quote is cancelled and priced again.
 */
export function additionFits(addition: Pick<OfferAddition, "currentPlanKey" | "periodEnd">, sub: { plan: string; interval: string; provider: string | null; status: string; currentPeriodEnd: Date | null }, interval: string, now: Date): boolean {
  return (
    sub.provider === "MANUAL_MOMO" &&
    sub.status === "ACTIVE" &&
    sub.currentPeriodEnd !== null &&
    sub.currentPeriodEnd.getTime() > now.getTime() &&
    sub.plan === addition.currentPlanKey &&
    sub.interval === interval &&
    sub.currentPeriodEnd.getTime() === new Date(addition.periodEnd).getTime()
  );
}

/**
 * The features a client can add by themselves on Billing ("Add features"): built, set up (not in `notSetUp`: none of
 * their services has BuPulse's keys yet, lib/feature-setup.ts), not in the plan yet, and priced in the region (with
 * every prerequisite they would pull in). Managed by BuPulse (two tiers) and anything unpriced go through "Request a custom
 * change".
 */
export function selfServeFeatures(owned: readonly FeatureKey[], prices: readonly AddonPriceRow[], regionKey: string, currency: string, notSetUp: readonly FeatureKey[] = []): FeatureKey[] {
  const has = new Set(owned);
  const priced = (k: FeatureKey) => prices.some((p) => p.addonKey === k && p.regionKey === regionKey && p.currency.toUpperCase() === currency.toUpperCase() && p.monthlyMinor >= 0);
  return FEATURES.filter((f) => f.status === "built" && f.key !== "managed" && !has.has(f.key) && withPrerequisites([f.key]).every((k) => has.has(k) || (priced(k) && !notSetUp.includes(k)))).map((f) => f.key);
}

/** Features not in the plan that cannot be sold yet because they are not set up: "Coming soon" on Billing and in the editor. */
export const comingSoonAddons = (owned: readonly FeatureKey[], notSetUp: readonly FeatureKey[]): FeatureKey[] => notSetUp.filter((k) => !owned.includes(k));

/** An offer may not sell a feature that is not set up (it may keep one its base plan already has). Null when fine. */
export function notSetUpProblem(added: readonly FeatureKey[], notSetUp: readonly FeatureKey[]): string | null {
  const bad = added.find((k) => notSetUp.includes(k));
  return bad ? `${featureLabel(bad)} is coming soon (it is not set up yet), so it cannot be sold. Untick it, or set it up first in Admin → Services.` : null;
}

/** How an accepted offer is paid (PlanOffer.payMethod; the database's PlanOffer_pay_method_check must allow each). */
export const OFFER_PAY_METHODS = ["momo", "invoice", "card"] as const;

// ---- card payment of an offer or added features ----------------------------------------------------------------------

/**
 * What an offer (or added features) costs by card: its price converted to US dollars with the same rule as the card
 * price of an RWF plan (lib/region-format.ts cardUsdCents: the Settings USD->RWF rate plus the card margin, rounded up to
 * whole dollars). An offer priced in USD (GLOBAL) is charged as it is. Pure: Billing shows it, the server charges it.
 */
export type OfferCardQuote = { usdCents: number; quoteMinor: number; quoteCurrency: string; usdToRwf: number; marginPercent: number };
export function offerCardQuote(minor: number, currency: string, usdToRwf: number, marginPercent: number): OfferCardQuote {
  const cur = currency.toUpperCase();
  return { usdCents: cardUsdCents(minor, cur, usdToRwf, marginPercent), quoteMinor: minor, quoteCurrency: cur, usdToRwf, marginPercent: cur === "USD" ? 0 : marginPercent };
}

// ---- added features on a card plan -----------------------------------------------------------------------------------

/**
 * A card plan (a Paddle subscription that renews by itself) takes added features as recurring items on that same
 * subscription (docs/OFFERS.md, "Adding features to a card plan"): one item per added feature, in US dollars, at the
 * card rule of plans (cardUsdCents on the feature's regional price for a whole period), charged now prorated by the card
 * provider and from then on with every renewal. Each item's price carries this kind in its custom data, signed, so a
 * subscription event can tell an added feature from the plan itself.
 */
export const CARD_ADDON_KIND = "bupulse_addon";

/** The message signed into an added feature's item: whose it is and which add-features offer made it. */
export const cardAddonMessage = (offerId: string, userId: string) => `addon:${offerId}:${userId}`;

/** One added feature as a card item: its add-on key and label, and its price per period in US cents. */
export type CardAddonItem = { key: string; label: string; usdCents: number };

export type CardAdditionQuote = {
  items: CardAddonItem[];
  /** What the added features add to the card plan per period (a month, or a year). */
  perPeriodUsdCents: number;
  /** Our estimate of what is charged now for the days left (the card provider prorates to the second). */
  dueNowUsdCents: number;
  daysLeft: number;
  periodDays: number;
};

/** The card items of an addition's priced lines (each a whole period, in the region's currency), and the charge now. */
export function cardAdditionQuote(input: { lines: readonly PricedLine[]; currency: string; usdToRwf: number; marginPercent: number; interval: "MONTH" | "YEAR"; periodEnd: Date; now: Date }): CardAdditionQuote {
  const items = input.lines.filter((l) => l.totalMinor > 0).map((l) => ({ key: l.key, label: l.label, usdCents: cardUsdCents(l.totalMinor, input.currency, input.usdToRwf, input.marginPercent) }));
  const perPeriodUsdCents = items.reduce((sum, i) => sum + i.usdCents, 0);
  const periodDays = periodDaysEnding(input.periodEnd, input.interval);
  const daysLeft = additionDaysLeft(input.periodEnd, input.now);
  return { items, perPeriodUsdCents, dueNowUsdCents: prorateMinor(perPeriodUsdCents, daysLeft, periodDays), daysLeft, periodDays };
}

/**
 * What a change to a card plan's added features stores (PlanOffer.options.cardPlan): an add-features offer, or a
 * removal (options.mode "removal": one feature taken off, nothing paid).
 */
export type OfferCardPlan = {
  /** The card subscription the items were added to. */
  subscriptionId: string;
  /** The plan the subscription's own price is (the custom plan is that plan plus the added features). */
  basePlanKey: string;
  interval: "MONTH" | "YEAR";
  /** This offer's items (none for a removal). */
  items: CardAddonItem[];
  /** A removal's item taken off the card plan. */
  removed: CardAddonItem[];
  /**
   * The added features' keys on the card plan once this change is on: the subscription's items then say which change
   * it is on (lib/offers/card-plan-items.ts). Null for the first add-features offers, made before removals existed.
   */
  keys: string[] | null;
  /** This offer's items per period. */
  addedUsdCents: number;
  /** Every added feature on the card plan once this offer is on (earlier ones included), per period. */
  addonsUsdCents: number;
  /** The estimate shown before confirming. */
  dueNowUsdCents: number;
  usdToRwf: number;
  marginPercent: number;
  /** When the card provider was asked. */
  at: string;
};

export function readCardPlan(options: unknown): OfferCardPlan | null {
  const c = options && typeof options === "object" ? (options as { cardPlan?: unknown }).cardPlan : null;
  if (!c || typeof c !== "object") return null;
  const v = c as Record<string, unknown>;
  const num = (k: string) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k] as number) : 0);
  if (typeof v.subscriptionId !== "string" || typeof v.basePlanKey !== "string") return null;
  const itemsOf = (list: unknown) => (Array.isArray(list) ? list.filter((i): i is CardAddonItem => Boolean(i) && typeof i.key === "string" && typeof i.label === "string" && Number.isSafeInteger(i.usdCents)) : []);
  const keys = Array.isArray(v.keys) ? v.keys.filter((k): k is string => typeof k === "string") : null;
  return { subscriptionId: v.subscriptionId, basePlanKey: v.basePlanKey, interval: v.interval === "YEAR" ? "YEAR" : "MONTH", items: itemsOf(v.items), removed: itemsOf(v.removed), keys, addedUsdCents: num("addedUsdCents"), addonsUsdCents: num("addonsUsdCents"), dueNowUsdCents: num("dueNowUsdCents"), usdToRwf: num("usdToRwf"), marginPercent: num("marginPercent"), at: typeof v.at === "string" ? v.at : "" };
}

/**
 * What removing a feature from a card plan leaves behind, for the confirm dialog: the feature gate switches it off
 * everywhere; what it made stays; usage above the new limits is not refunded and new use waits for the next period.
 */
export function cardRemovalEffects(key: string): string[] {
  const own = key === "websiteChat" ? ["Your website chat stops answering visitors; the leads it already captured stay."] : key === "aiPhotos" ? ["AI photos stop, and your AI images a month go back to your plan's own number; the designs you made stay."] : [];
  return [...own, "Anything already used above the plan's new limits is not refunded; new use waits for the next period."];
}

/** Two sets of add-on keys are the same (order does not matter). */
export const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

// ---- the request form: what the client already has ------------------------------------------------------------------

/** The features ticked and locked on the request form: the plan's own, with their prerequisites. */
export const lockedRequestFeatures = (owned: readonly string[]): FeatureKey[] => withPrerequisites(owned);

/**
 * The request form's ticks after ticking (or unticking) one feature: ticking pulls in its prerequisites; a feature the
 * client already has stays ticked; a feature another ticked one needs cannot be unticked. Returns only what is new.
 */
export function toggleRequestFeature(owned: readonly string[], selected: readonly FeatureKey[], key: FeatureKey, on: boolean): FeatureKey[] {
  const locked = new Set(lockedRequestFeatures(owned));
  if (locked.has(key)) return selected.filter((k) => !locked.has(k));
  if (on) return withPrerequisites([...selected, key]).filter((k) => !locked.has(k));
  if (selected.some((k) => k !== key && withPrerequisites([k]).includes(key))) return [...selected];
  return selected.filter((k) => k !== key);
}

/** What a request asks for on top of the plan: the ticked features with their prerequisites, minus what the client has. */
export function requestedFeatures(owned: readonly string[], ticked: readonly string[]): FeatureKey[] {
  const locked = new Set(lockedRequestFeatures(owned));
  return withPrerequisites(ticked).filter((k) => !locked.has(k));
}

// ---- offer statuses --------------------------------------------------------------------------------------------------

export const OFFER_STATUSES = ["draft", "sent", "accepted", "paid", "expired", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const isOfferStatus = (v: unknown): v is OfferStatus => typeof v === "string" && (OFFER_STATUSES as readonly string[]).includes(v);
export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted, waiting for payment", paid: "Paid", expired: "Expired", withdrawn: "Withdrawn" };

/** Which status may follow which. paid, expired and withdrawn are final. */
export const OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  draft: ["sent", "withdrawn"],
  sent: ["accepted", "expired", "withdrawn"],
  accepted: ["paid", "withdrawn"],
  paid: [],
  expired: [],
  withdrawn: [],
};
export const canMoveOffer = (from: string, to: OfferStatus) => isOfferStatus(from) && OFFER_TRANSITIONS[from].includes(to);

/**
 * A sent offer past its date is expired (the lists and the client's Billing page mark it so on read). An accepted offer
 * does not expire: the client may already have paid; the admin withdraws it if it is never paid.
 */
export function isOfferExpired(o: { status: string; validUntil: Date | string | null }, now: Date = new Date()): boolean {
  return o.status === "sent" && o.validUntil !== null && new Date(o.validUntil).getTime() <= now.getTime();
}

/** "Accepted today", "Accepted 1 day ago", "Accepted 9 days ago": how long an accepted offer has waited for payment. */
export function acceptedAgoText(acceptedAt: Date | string, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(acceptedAt).getTime()) / DAY_MS));
  return days === 0 ? "Accepted today" : `Accepted ${days} ${days === 1 ? "day" : "days"} ago`;
}

export const validUntilOf = (sentAt: Date, days: number = OFFER_VALID_DAYS) => new Date(sentAt.getTime() + days * DAY_MS);

/** The private plan key prepared for an offer: deterministic, so accepting twice can never make two plans. */
export const customPlanKeyFor = (offerId: string) => `CUSTOM-${offerId.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase()}`;

// ---- the admin's draft --------------------------------------------------------------------------------------------

const count = (max: number) => z.number().int().min(0).max(max);
export const offerDraftSchema = z.object({
  basePlanKey: z.string().trim().max(64).nullish().transform((v) => v || null),
  features: z.array(z.string().max(40)).max(40).default([]),
  limits: z.object({ text: count(MAX_LIMIT), image: count(MAX_LIMIT), chat: count(MAX_LIMIT), seats: z.number().int().min(SEATS_MIN).max(SEATS_MAX), postsPerAppPerDay: z.number().int().min(POSTS_PER_APP_MIN).max(POSTS_PER_APP_MAX).default(POSTS_PER_APP_MIN) }),
  managedTier: z.enum(MANAGED_TIERS).default("light"),
  interval: z.enum(["MONTH", "YEAR"]),
  adjustedMinor: z.number().int().min(1, "The price must be more than zero.").max(MAX_OFFER_MINOR).nullish().transform((v) => v ?? null),
  adjustReason: z.string().trim().max(200, "Keep the reason under 200 characters.").nullish().transform((v) => v || null),
  note: z.string().trim().max(1000, "Keep the message under 1,000 characters.").nullish().transform((v) => v || null),
  validDays: z.number().int().min(1).max(OFFER_VALID_DAYS_MAX).default(OFFER_VALID_DAYS),
  requestId: z.string().trim().max(64).nullish().transform((v) => v || null),
  /** "addon": add features to the client's running plan (prorated now, full price from the next renewal). */
  mode: z.enum(["plan", "addon"]).default("plan"),
});
export type OfferDraftInput = z.input<typeof offerDraftSchema>;
export type OfferDraft = z.output<typeof offerDraftSchema>;

/**
 * Checks a draft against its quote: the features are valid (prerequisites are added, never silently dropped: an unknown
 * or coming-soon key is refused), the total is above zero, and a changed price says why. Returns what the client pays.
 */
export function checkOfferDraft(draft: OfferDraft, quote: OfferQuote): { ok: true; adjustedMinor: number; adjustReason: string | null } | { ok: false; error: string } {
  const bad = draft.features.find((k) => !isFeatureKey(k) || FEATURES.find((f) => f.key === k)?.status !== "built");
  if (bad) return { ok: false, error: isFeatureKey(bad) ? `${featureLabel(bad)} is coming soon and cannot be offered yet.` : `"${bad}" is not a feature.` };
  const checked = validateFeatureSet(quote.features);
  if (!checked.ok) return { ok: false, error: checked.message };
  if (quote.added.length === 0 && quote.lines.every((l) => l.key.startsWith("plan:"))) return { ok: false, error: "Add a feature or raise a limit: this offer is the same as the base plan." };
  const adjusted = draft.adjustedMinor ?? quote.computedMinor;
  if (adjusted <= 0) return { ok: false, error: "The offer has no price yet. Set the add-on prices for this region, or type the price the client pays." };
  if (adjusted > MAX_OFFER_MINOR) return { ok: false, error: "That price is too high." };
  if (adjusted !== quote.computedMinor && (!draft.adjustReason || draft.adjustReason.length < 3)) return { ok: false, error: "Say why the price differs from the computed total (rounding, discount...)." };
  return { ok: true, adjustedMinor: adjusted, adjustReason: adjusted === quote.computedMinor ? null : draft.adjustReason };
}

/** "10% off" style text for a lower price, "rounded up" for a higher one, null when the price is the computed total. */
export function adjustmentText(computedMinor: number, adjustedMinor: number): string | null {
  if (computedMinor <= 0 || computedMinor === adjustedMinor) return null;
  if (adjustedMinor > computedMinor) return "Rounded up";
  const pct = Math.round(((computedMinor - adjustedMinor) / computedMinor) * 100);
  return pct >= 1 ? `${pct}% off` : "Rounded down";
}

export function readFeatureKeys(value: unknown): FeatureKey[] {
  return Array.isArray(value) ? sortFeatureKeys(value.filter(isFeatureKey)) : [];
}
export function readLinesJson(value: unknown): PricedLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((l): l is PricedLine => !!l && typeof l === "object" && typeof (l as PricedLine).label === "string" && Number.isInteger((l as PricedLine).totalMinor));
}
export function readManagedTier(options: unknown): ManagedTier {
  const t = options && typeof options === "object" ? (options as { managedTier?: unknown }).managedTier : undefined;
  return t === "full" ? "full" : "light";
}

// ---- what the client sees -----------------------------------------------------------------------------------------

export type ClientOfferView = {
  id: string;
  status: OfferStatus;
  interval: "MONTH" | "YEAR";
  currency: string;
  totalMinor: number;
  computedMinor: number;
  adjustment: string | null;
  basePlanName: string | null;
  features: { key: FeatureKey; label: string; description: string; added: boolean }[];
  limits: OfferLimits;
  managedTier: ManagedTier | null;
  lines: PricedLine[];
  note: string | null;
  validUntil: string | null;
  payMethod: "momo" | "invoice" | "card" | null;
  invoiceId: string | null;
  /** Set for features added to the running plan: pay `totalMinor` now, then `nextRenewalMinor` a period from `renewsOn`. */
  addition: { addonMinor: number; nextRenewalMinor: number; renewsOn: string; daysLeft: number; periodDays: number; currentPlanName: string; selfServe: boolean } | null;
};

/** What the client sees, from an offer's stored fields. Pure: Billing and the admin editor's live preview share it. */
export function toClientOffer(o: {
  id: string;
  status: OfferStatus;
  interval: "MONTH" | "YEAR";
  currency: string;
  adjustedMinor: number;
  computedMinor: number;
  basePlanName: string | null;
  features: readonly FeatureKey[];
  added: readonly FeatureKey[];
  limits: OfferLimits;
  managedTier: ManagedTier;
  lines: PricedLine[];
  note: string | null;
  validUntil: Date | string | null;
  payMethod: string | null;
  invoiceId: string | null;
  addition?: OfferAddition | null;
}): ClientOfferView {
  return {
    id: o.id,
    status: o.status,
    interval: o.interval,
    currency: o.currency,
    totalMinor: o.adjustedMinor,
    computedMinor: o.computedMinor,
    adjustment: adjustmentText(o.computedMinor, o.adjustedMinor),
    basePlanName: o.basePlanName,
    features: o.features.map((key) => ({ key, label: featureLabel(key), description: FEATURES.find((f) => f.key === key)?.description ?? "", added: o.added.includes(key) })),
    limits: { text: o.limits.text, image: o.limits.image, chat: o.limits.chat, seats: o.limits.seats, postsPerAppPerDay: o.limits.postsPerAppPerDay },
    managedTier: o.features.includes("managed") ? o.managedTier : null,
    lines: o.lines,
    note: o.note,
    validUntil: o.validUntil ? new Date(o.validUntil).toISOString() : null,
    payMethod: o.payMethod === "momo" || o.payMethod === "invoice" || o.payMethod === "card" ? o.payMethod : null,
    invoiceId: o.invoiceId,
    addition: o.addition ? { addonMinor: o.addition.addonMinor, nextRenewalMinor: o.addition.nextRenewalMinor, renewsOn: o.addition.periodEnd, daysLeft: o.addition.daysLeft, periodDays: o.addition.periodDays, currentPlanName: o.addition.currentPlanName, selfServe: o.addition.selfServe } : null,
  };
}

// ---- custom plan requests (R5) --------------------------------------------------------------------------------------

export const REQUEST_STATUSES = ["new", "contacted", "offered", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const isRequestStatus = (v: unknown): v is RequestStatus => typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { new: "New", contacted: "Contacted", offered: "Offer sent", closed: "Closed" };

export const REQUEST_SOURCES = ["billing", "pricing", "upgrade", "demo"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/** Budget ranges a client can pick (per month, in the region's money); optional. */
export const BUDGET_RANGES = [
  { key: "under_50k", label: "Under 50,000 RWF ($35)" },
  { key: "50k_100k", label: "50,000 to 100,000 RWF ($35 to $70)" },
  { key: "100k_200k", label: "100,000 to 200,000 RWF ($70 to $140)" },
  { key: "over_200k", label: "More than 200,000 RWF ($140)" },
  { key: "unsure", label: "Not sure yet" },
] as const;
export const budgetLabel = (key: string | null | undefined) => BUDGET_RANGES.find((b) => b.key === key)?.label ?? null;

/** The features a client can ask about: everything built, plus coming-soon ones (interest is worth knowing). */
export const REQUESTABLE_FEATURES = FEATURES.map((f) => ({ key: f.key, label: f.label, description: f.description, soon: f.status === "coming_soon" }));

export const requestSchema = z.object({
  description: z.string().trim().min(10, "Tell us in a sentence or two what your business does.").max(2000, "Keep it under 2,000 characters."),
  features: z.array(z.string().max(40)).max(40).default([]).transform((keys) => sortFeatureKeys(keys.filter(isFeatureKey))),
  budget: z.string().max(20).nullish().transform((v) => (v && BUDGET_RANGES.some((b) => b.key === v) ? v : null)),
  phone: z.string().trim().max(40).nullish().transform((v) => v || null),
  source: z.enum(REQUEST_SOURCES).catch("billing"),
});
export type RequestInput = z.input<typeof requestSchema>;
