// The one-page creator campaign form (docs/CREATOR_CAMPAIGN_WIZARD.md, "One page"). Pure: the fields and their checks,
// the live summary, the budget warning, picking the product, and how the answers become the campaign and its pay
// rules. The form, the server (createOnePageCampaign in lib/creators/campaigns.ts) and the tests share it.
//
// Owner decision (31 October 2026): making a campaign is one short page, in this order: the language; one description
// of the campaign and its tasks (the AI reads it and writes the brief, the tasks, the hashtags, the do's and don'ts and
// the application questions, in that language); the pay per 1,000 views (500 RWF at least); the budget; the most one
// creator earns; how many creators can join (or unlimited); the networks; a background picture; and the product.
// Everything else gets a default from the description and stays editable in Settings. The campaign runs from today
// for 30 days, one pay period, so the budget and the most one creator earns hold for the whole campaign.

import { z } from "zod";
import { addDaysYmd } from "@/lib/demo/slots";
import { formatAmount, isMention, PLATFORMS, type Platform } from "./company-forms";
import type { PayRules } from "./pay";
import { maxRate, minRate } from "./pay-floor";
import { PERIOD_DAYS } from "./periods";

export const CAMPAIGN_LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "rw", label: "Kinyarwanda", native: "Ikinyarwanda" },
  { code: "fr", label: "French", native: "Français" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
] as const;
export type CampaignLanguage = (typeof CAMPAIGN_LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = CAMPAIGN_LANGUAGES.map((l) => l.code) as [CampaignLanguage, ...CampaignLanguage[]];

export const isCampaignLanguage = (v: unknown): v is CampaignLanguage => typeof v === "string" && (LANGUAGE_CODES as readonly string[]).includes(v);
/** A stored language, English when it is not one of the four (campaigns made before 31 October 2026 are English). */
export const languageOf = (v: unknown): CampaignLanguage => (isCampaignLanguage(v) ? v : "en");
/** The language's English name ("Kinyarwanda"): what the AI is told and what the creators' requirements list (LANGUAGES). */
export const languageLabel = (code: unknown): string => CAMPAIGN_LANGUAGES.find((l) => l.code === code)?.label ?? "English";

/** The campaign language a business's content language is ("Kinyarwanda" → rw), English for any other: the form's start. */
export const languageFromName = (name: string | null | undefined): CampaignLanguage => CAMPAIGN_LANGUAGES.find((l) => l.label.toLowerCase() === (name ?? "").trim().toLowerCase())?.code ?? "en";

/** How long a one-page campaign runs: one pay period, so its budget is the budget of the whole campaign. */
export const ONE_PAGE_DAYS = PERIOD_DAYS;
export const MIN_DESCRIPTION = 20;
export const MAX_DESCRIPTION = 2_000;
export const MAX_PRODUCT_PHOTOS = 20;
export const MAX_PRODUCT_LINKS = 10;

/** "500 RWF is the minimum for 1,000 views": the note under the price, and the refusal when it is lower. */
export const minimumNote = (currency: string) => `${formatAmount(minRate(currency), currency)} is the minimum for 1,000 views.`;

const amount = (missing: string) =>
  z
    .number({ error: missing })
    .int("Use a whole number.")
    .min(1, missing)
    .max(1_000_000_000, "That number is too big.");

const link = z.string().trim().url("Paste full links, starting with https://").max(500);

export const onePageSchema = z
  .object({
    language: z.enum(LANGUAGE_CODES, { error: "Pick the language of the campaign." }),
    description: z
      .string()
      .trim()
      .min(MIN_DESCRIPTION, "Describe the campaign and what creators should post, in a few sentences.")
      .max(MAX_DESCRIPTION, `Keep the description under ${MAX_DESCRIPTION.toLocaleString("en-US")} characters.`),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, "Pick a currency."),
    ratePerThousand: z.number({ error: "Write the pay for 1,000 views." }).int("Use a whole number."),
    budget: amount("Write the campaign budget."),
    maxPerCreator: amount("Write the most one creator can earn."),
    unlimitedCreators: z.boolean(),
    maxCreators: z.number({ error: "Write how many creators can join, or pick Unlimited." }).int("Use a whole number.").min(1, "At least 1 creator.").max(10_000, "At most 10,000 creators.").nullable(),
    platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one network to post on.").max(PLATFORMS.length),
    coverAssetId: z.string().min(1).max(40).nullable(),
    productId: z.string().min(1).max(60).nullable(),
    productName: z.string().trim().max(120, "Keep the product name under 120 characters."),
    productLinks: z.array(link).max(MAX_PRODUCT_LINKS, `Add at most ${MAX_PRODUCT_LINKS} links.`),
    productPhotoIds: z.array(z.string().min(1).max(40)).max(MAX_PRODUCT_PHOTOS, `Add at most ${MAX_PRODUCT_PHOTOS} pictures.`),
  })
  .superRefine((v, ctx) => {
    if (v.ratePerThousand < minRate(v.currency)) ctx.addIssue({ code: "custom", path: ["ratePerThousand"], message: minimumNote(v.currency) });
    else if (v.ratePerThousand > maxRate(v.currency)) ctx.addIssue({ code: "custom", path: ["ratePerThousand"], message: `${formatAmount(v.ratePerThousand, v.currency)} for 1,000 views looks like a typing mistake: the most is ${formatAmount(maxRate(v.currency), v.currency)}.` });
    if (!v.unlimitedCreators && v.maxCreators === null) ctx.addIssue({ code: "custom", path: ["maxCreators"], message: "Write how many creators can join, or pick Unlimited." });
  });
export type OnePageInput = z.input<typeof onePageSchema>;
export type OnePageValues = z.output<typeof onePageSchema>;
export type OnePageField = keyof OnePageInput;

/** The answers checked, or the first problem in words and the field it is about (the form scrolls to it). */
export function checkOnePage(input: unknown): { ok: true; data: OnePageValues } | { ok: false; error: string; field: OnePageField | null } {
  const parsed = onePageSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const key = issue?.path[0];
  return { ok: false, error: issue?.message ?? "Please check the form.", field: typeof key === "string" && key in onePageSchema.shape ? (key as OnePageField) : null };
}

/** How many creators can join: the campaign's number, at most the plan's; unlimited (null) is the plan's. */
export function placeLimit(planLimit: number, maxCreators: number | null | undefined): number {
  return maxCreators && maxCreators > 0 ? Math.min(planLimit, maxCreators) : planLimit;
}

type Money = { budget: number | null; maxPerCreator: number | null; maxCreators: number | null; unlimitedCreators: boolean; planLimit: number; currency: string };

/**
 * The warning when every creator earning the most would cost more than the budget (owner decision: warn, never
 * block). Unlimited counts the plan's creators per campaign. Null when it fits, or before both numbers are written.
 */
export function budgetWarning(p: Money): string | null {
  if (!p.budget || !p.maxPerCreator) return null;
  const creators = p.unlimitedCreators ? p.planLimit : placeLimit(p.planLimit, p.maxCreators);
  if (!creators) return null;
  const need = creators * p.maxPerCreator;
  if (need <= p.budget) return null;
  const money = (n: number) => formatAmount(n, p.currency);
  const who = p.unlimitedCreators ? `Up to ${creators.toLocaleString("en-US")} creators (unlimited, on your plan)` : `${creators.toLocaleString("en-US")} ${creators === 1 ? "creator" : "creators"}`;
  return `${who} earning ${money(p.maxPerCreator)} each is ${money(need)}, more than your budget of ${money(p.budget)}. You can still create it: when the budget runs out, the pay is shared between the creators to fit it.`;
}

/** The live summary under the form: "Up to 20 creators · 500 RWF per 1,000 views · max 50,000 RWF each · budget 500,000 RWF". */
export function summaryParts(p: Money & { ratePerThousand: number | null }): string[] {
  const money = (n: number) => formatAmount(n, p.currency);
  const out: string[] = [];
  if (p.unlimitedCreators) out.push("Unlimited creators");
  else if (p.maxCreators) out.push(`Up to ${p.maxCreators.toLocaleString("en-US")} ${p.maxCreators === 1 ? "creator" : "creators"}`);
  if (p.ratePerThousand) out.push(`${money(p.ratePerThousand)} per 1,000 views`);
  if (p.maxPerCreator) out.push(`max ${money(p.maxPerCreator)} each`);
  if (p.budget) out.push(`budget ${money(p.budget)}`);
  return out;
}

export const summaryLine = (p: Parameters<typeof summaryParts>[0]) => summaryParts(p).join(" · ");

/** The product part of the form: the one picked, its name, and the pictures (`fromProduct`: those that came with it). */
export type ProductState = { productId: string | null; productName: string; productPhotoIds: string[]; fromProduct: string[] };

/**
 * Picking a product (or none): its name fills the product name, and its photos take the place of the previous
 * product's. Pictures the owner added themselves stay. Without a product the name is emptied for them to type.
 */
export function withProduct(s: ProductState, product: { id: string; name: string } | null, photoIds: string[] = []): ProductState {
  const own = s.productPhotoIds.filter((id) => !s.fromProduct.includes(id));
  if (!product) return { productId: null, productName: "", productPhotoIds: own, fromProduct: [] };
  const fresh = [...new Set(photoIds)].slice(0, MAX_PRODUCT_PHOTOS);
  return { productId: product.id, productName: product.name.slice(0, 120), productPhotoIds: [...new Set([...fresh, ...own])].slice(0, MAX_PRODUCT_PHOTOS), fromProduct: fresh };
}

/**
 * The @accounts and #hashtags the owner wrote in the description, in order and without repeats: the captions are
 * checked for them (with the AI's), so "use #LeafJuice and tag @leaf.rw" becomes the campaign's caption check.
 */
export function mentionsInText(text: string, max = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_@#])([@#][\p{L}\p{N}_.]{2,60})/gu)) {
    const value = m[1].replace(/\.+$/, "");
    if (!isMention(value) || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** The pay rules of a one-page campaign: a price for every 1,000 views and the most one creator earns in a pay period. */
export function onePagePayRules(v: Pick<OnePageValues, "ratePerThousand" | "maxPerCreator">): PayRules {
  return { ratePerThousand: v.ratePerThousand, rateViews: 1_000, feePerPost: null, milestones: [], capPerPost: null, capPerCreator: v.maxPerCreator };
}

/**
 * The answers as the campaign stores them: the description is the owner's idea the AI fills the rest from, the pay
 * feeds lib/creators/pay.ts (rate per 1,000 views, capPerCreator), the budget is the one pay period's (the whole
 * campaign's: it runs 30 days from `today`), and unlimited creators is no limit of the campaign's own (null).
 */
export function onePageCampaign(v: OnePageValues, today: string) {
  return {
    language: v.language,
    idea: v.description,
    platforms: v.platforms as Platform[],
    currency: v.currency,
    payRules: onePagePayRules(v),
    budget: v.budget,
    maxCreators: v.unlimitedCreators ? null : v.maxCreators,
    startsOn: today,
    endsOn: addDaysYmd(today, ONE_PAGE_DAYS - 1),
    coverAssetId: v.coverAssetId,
    productIds: v.productId ? [v.productId] : [],
    product: { productName: v.productName || null, productLinks: v.productLinks, productPhotoIds: v.productPhotoIds },
    /** Creators who post in the campaign's language. */
    languages: [languageLabel(v.language)],
  };
}
export type OnePageCampaign = ReturnType<typeof onePageCampaign>;
