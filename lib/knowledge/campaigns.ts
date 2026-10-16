// Campaigns (Knowledge base): events, offers, promotions and launches, with dates and the products they are about.
// Pure: the form, the actions, the AI context and the tests share it. Storage: the Campaign model.

import { z } from "zod";
import { ITEM_STATUSES, type ItemStatusValue } from "./products";

export const CAMPAIGN_TYPES = ["EVENT", "OFFER", "PROMOTION", "LAUNCH", "OTHER"] as const;
export type CampaignTypeValue = (typeof CAMPAIGN_TYPES)[number];

export const MAX_CAMPAIGNS_PER_BUSINESS = 300;
export const MAX_CAMPAIGN_PRODUCTS = 30;
export const MAX_HIGHLIGHTS = 10;

export const CAMPAIGN_LIMITS = { name: 200, description: 3000, priceInfo: 200, highlight: 160 } as const;

export const CAMPAIGN_TYPE_OPTIONS: { value: CampaignTypeValue; label: string; hint: string; namePlaceholder: string; pricePlaceholder: string }[] = [
  { value: "EVENT", label: "Event", hint: "Something with a date and a place: an open day, a workshop, a tasting, a show.", namePlaceholder: "Saturday open day", pricePlaceholder: "Free entry, or 5,000 RWF a ticket" },
  { value: "OFFER", label: "Offer", hint: "A deal or a discount for a while.", namePlaceholder: "Month-end 20% off", pricePlaceholder: "20% off everything in store" },
  { value: "PROMOTION", label: "Promotion", hint: "A push for something you already sell, without a discount.", namePlaceholder: "Back-to-school week", pricePlaceholder: "Free delivery in Kigali" },
  { value: "LAUNCH", label: "Launch", hint: "Something new: a product, a branch, a service, a menu.", namePlaceholder: "New branch in Kimironko", pricePlaceholder: "Opening price for the first week" },
  { value: "OTHER", label: "Other", hint: "Anything else you want to tell people about for a while.", namePlaceholder: "Our 5th anniversary", pricePlaceholder: "Optional" },
];

export const CAMPAIGN_TYPE_LABEL: Record<CampaignTypeValue, string> = { EVENT: "Event", OFFER: "Offer", PROMOTION: "Promotion", LAUNCH: "Launch", OTHER: "Other" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A "YYYY-MM-DD" that is a real calendar day. */
export function isDay(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const day = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => v || null)
  .refine((v) => v === null || isDay(v), "Pick a date.");

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const campaignInputSchema = z
  .object({
    type: z.enum(CAMPAIGN_TYPES, { error: "Choose what kind of campaign it is." }),
    name: z.string().trim().min(1, "Give it a name.").max(CAMPAIGN_LIMITS.name, `Use ${CAMPAIGN_LIMITS.name} characters or fewer.`),
    description: optional(CAMPAIGN_LIMITS.description),
    startsOn: day,
    endsOn: day,
    priceInfo: optional(CAMPAIGN_LIMITS.priceInfo),
    highlights: z
      .array(z.string().max(1000))
      .max(100)
      .default([])
      .transform((list) => {
        const seen = new Set<string>();
        return list.map((v) => v.trim().replace(/\s+/g, " ")).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
      })
      .pipe(z.array(z.string().max(CAMPAIGN_LIMITS.highlight, `Keep each line under ${CAMPAIGN_LIMITS.highlight} characters.`)).max(MAX_HIGHLIGHTS, `Add up to ${MAX_HIGHLIGHTS} highlights.`)),
    productIds: z
      .array(z.string().min(1).max(60))
      .max(MAX_CAMPAIGN_PRODUCTS, `Link up to ${MAX_CAMPAIGN_PRODUCTS} products.`)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    status: z.enum(ITEM_STATUSES).default("ACTIVE"),
  })
  // Runs with the other checks (not only once they pass), so the form shows every problem at once.
  .superRefine(
    (v, ctx) => {
      const startsOn = typeof v.startsOn === "string" && isDay(v.startsOn.trim()) ? v.startsOn.trim() : null;
      const endsOn = typeof v.endsOn === "string" && isDay(v.endsOn.trim()) ? v.endsOn.trim() : null;
      if (v.type === "EVENT" && !startsOn && !(typeof v.startsOn === "string" && v.startsOn.trim())) ctx.addIssue({ code: "custom", path: ["startsOn"], message: "Add the date of the event." });
      if (startsOn && endsOn && endsOn < startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The end date must be on or after the start date." });
    },
    { when: () => true },
  );

export type CampaignInput = z.input<typeof campaignInputSchema>;
export type CampaignData = z.output<typeof campaignInputSchema>;

/** A stored date column (UTC midnight) as "YYYY-MM-DD". */
export function dayString(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" as the Date Prisma writes to a DATE column. */
export function dayDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export type CampaignPhase = "upcoming" | "running" | "ended" | "undated";

/** Where a campaign is in time, on the business's local day "YYYY-MM-DD". */
export function campaignPhase(c: { startsOn: string | null; endsOn: string | null }, today: string): CampaignPhase {
  const end = c.endsOn ?? c.startsOn;
  if (!c.startsOn && !c.endsOn) return "undated";
  if (c.startsOn && today < c.startsOn) return "upcoming";
  if (end && today > end) return "ended";
  return "running";
}

export const PHASE_LABEL: Record<CampaignPhase, string> = { upcoming: "Upcoming", running: "On now", ended: "Ended", undated: "No dates" };

/** "12 Oct 2026", "12–14 Oct 2026", "30 Oct – 2 Nov 2026"; empty without dates. */
export function formatDateRange(startsOn: string | null, endsOn: string | null): string {
  const fmt = (v: string, opts: Intl.DateTimeFormatOptions) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
  if (!startsOn && !endsOn) return "";
  if (!startsOn || !endsOn || startsOn === endsOn) return fmt((startsOn ?? endsOn)!, { day: "numeric", month: "short", year: "numeric" });
  const sameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
  const sameMonth = sameYear && startsOn.slice(5, 7) === endsOn.slice(5, 7);
  if (sameMonth) return `${Number(startsOn.slice(8, 10))}–${fmt(endsOn, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${fmt(startsOn, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })} – ${fmt(endsOn, { day: "numeric", month: "short", year: "numeric" })}`;
}

export type CampaignFormValues = {
  type: CampaignTypeValue;
  name: string;
  description: string;
  startsOn: string;
  endsOn: string;
  priceInfo: string;
  highlights: string[];
  productIds: string[];
  status: ItemStatusValue;
};

export function campaignFormValues(
  c: { type: CampaignTypeValue; name: string; description: string | null; startsAt: Date | null; endsAt: Date | null; priceInfo: string | null; highlights: string[]; status: ItemStatusValue; productIds: string[] } | null,
): CampaignFormValues {
  if (!c) return { type: "OFFER", name: "", description: "", startsOn: "", endsOn: "", priceInfo: "", highlights: [], productIds: [], status: "ACTIVE" };
  return {
    type: c.type,
    name: c.name,
    description: c.description ?? "",
    startsOn: dayString(c.startsAt) ?? "",
    endsOn: dayString(c.endsAt) ?? "",
    priceInfo: c.priceInfo ?? "",
    highlights: c.highlights,
    productIds: c.productIds,
    status: c.status,
  };
}
