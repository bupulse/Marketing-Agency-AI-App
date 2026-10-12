// Custom plans and offers (docs/OFFERS.md): the add-on catalog, the price maths and the offer rules. Pure (no server
// imports), so the admin editor's live total, the server's frozen total and the tests all compute the same thing.

import { z } from "zod";
import { featureLabel, FEATURES, isFeatureKey, sortFeatureKeys, validateFeatureSet, withPrerequisites, type FeatureKey } from "@/lib/features";
import { SEATS_MAX, SEATS_MIN, type PlanLimits } from "@/lib/plans";

/** A yearly custom plan costs this many months (the regional plans' rule: yearly = 10 months). */
export const YEARLY_MONTHS = 10;
/** How long a sent offer stays open by default. */
export const OFFER_VALID_DAYS = 7;
export const OFFER_VALID_DAYS_MAX = 60;
export const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIMIT = 10_000_000;
export const MAX_OFFER_MINOR = 2_000_000_000;

// ---- the add-on catalog ---------------------------------------------------------------------------------------------

/** The limits an offer can raise by blocks (videoSeconds and voiceCharacters belong to coming-soon features). */
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
  { key: "block:image", kind: "block", metric: "image", blockSize: 50, label: "+50 designs" },
  { key: "block:chat", kind: "block", metric: "chat", blockSize: 1000, label: "+1,000 chat replies" },
  { key: "seat", kind: "seat", label: "Extra user" },
];
export const ADDON_KEYS = ADDONS.map((a) => a.key);
export const isAddonKey = (v: unknown): v is string => typeof v === "string" && ADDON_KEYS.includes(v);
export const addonOf = (key: string) => ADDONS.find((a) => a.key === key) ?? null;

/** The price key of a feature in an offer (Managed by BuPulse is priced by tier). */
export const featureAddonKey = (key: FeatureKey, tier: ManagedTier = "light") => (key === "managed" ? `managed:${tier}` : key);

export const METRIC_LABEL: Record<OfferMetric | "seats", string> = { text: "AI texts a month", image: "Designs a month", chat: "Chat replies a month", seats: "Users" };

// ---- pricing ------------------------------------------------------------------------------------------------------

export type AddonPriceRow = { addonKey: string; regionKey: string; currency: string; monthlyMinor: number };
/** A regional plan to start from: its price in the region's currency, what it includes. */
export type OfferBase = { key: string; name: string; monthlyMinor: number; yearlyMinor: number; features: readonly FeatureKey[]; limits: PlanLimits };
export type OfferLimits = Pick<PlanLimits, OfferMetric | "seats">;

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
  /** The custom plan's limits (videoSeconds and voiceCharacters stay the base plan's). */
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

const EMPTY_LIMITS: PlanLimits = { text: 0, image: 0, videoSeconds: 0, voiceCharacters: 0, chat: 0, seats: SEATS_MIN };

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

  const included: OfferLimits = { text: baseLimits.text, image: baseLimits.image, chat: baseLimits.chat, seats: baseLimits.seats };
  for (const key of added) {
    const def = FEATURES.find((f) => f.key === key);
    if (!def) continue;
    const addonKey = featureAddonKey(key, tier);
    const addon = addonOf(addonKey);
    const label = addon?.label ?? def.label;
    line(addonKey, label, 1, priceOf(input.prices, addonKey, input.regionKey, input.currency));
    const inc = addon?.kind === "feature" ? addon.includes : undefined;
    if (inc) included[inc.metric] += inc.amount;
  }
  for (const metric of OFFER_METRICS) {
    const want = input.limits[metric];
    const extra = want - included[metric];
    if (extra <= 0) continue;
    const block = ADDONS.find((a) => a.kind === "block" && a.metric === metric) as Extract<AddonDef, { kind: "block" }>;
    line(block.key, block.label, Math.ceil(extra / block.blockSize), priceOf(input.prices, block.key, input.regionKey, input.currency));
  }
  const extraSeats = input.limits.seats - included.seats;
  if (extraSeats > 0) line("seat", "Extra user", extraSeats, priceOf(input.prices, "seat", input.regionKey, input.currency));

  return {
    features,
    added,
    limits: { ...baseLimits, text: input.limits.text, image: input.limits.image, chat: input.limits.chat, seats: input.limits.seats },
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
  limits: z.object({ text: count(MAX_LIMIT), image: count(MAX_LIMIT), chat: count(MAX_LIMIT), seats: z.number().int().min(SEATS_MIN).max(SEATS_MAX) }),
  managedTier: z.enum(MANAGED_TIERS).default("light"),
  interval: z.enum(["MONTH", "YEAR"]),
  adjustedMinor: z.number().int().min(1, "The price must be more than zero.").max(MAX_OFFER_MINOR).nullish().transform((v) => v ?? null),
  adjustReason: z.string().trim().max(200, "Keep the reason under 200 characters.").nullish().transform((v) => v || null),
  note: z.string().trim().max(1000, "Keep the message under 1,000 characters.").nullish().transform((v) => v || null),
  validDays: z.number().int().min(1).max(OFFER_VALID_DAYS_MAX).default(OFFER_VALID_DAYS),
  requestId: z.string().trim().max(64).nullish().transform((v) => v || null),
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
  payMethod: "momo" | "invoice" | null;
  invoiceId: string | null;
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
    limits: { text: o.limits.text, image: o.limits.image, chat: o.limits.chat, seats: o.limits.seats },
    managedTier: o.features.includes("managed") ? o.managedTier : null,
    lines: o.lines,
    note: o.note,
    validUntil: o.validUntil ? new Date(o.validUntil).toISOString() : null,
    payMethod: o.payMethod === "momo" || o.payMethod === "invoice" ? o.payMethod : null,
    invoiceId: o.invoiceId,
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
  goals: z.string().trim().min(10, "Tell us what you want to achieve.").max(2000, "Keep it under 2,000 characters."),
  features: z.array(z.string().max(40)).max(40).default([]).transform((keys) => sortFeatureKeys(keys.filter(isFeatureKey))),
  budget: z.string().max(20).nullish().transform((v) => (v && BUDGET_RANGES.some((b) => b.key === v) ? v : null)),
  phone: z.string().trim().max(40).nullish().transform((v) => v || null),
  source: z.enum(REQUEST_SOURCES).catch("billing"),
});
export type RequestInput = z.input<typeof requestSchema>;
