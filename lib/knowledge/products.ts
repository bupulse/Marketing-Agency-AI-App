// Products & services (Knowledge base): kinds, price models, the form schema and display helpers. Pure: the form,
// the server actions, the AI context and the tests share it. Storage: the Product model (prisma/schema.prisma).

import { z } from "zod";
import { formatMinor, minorDigits } from "@/lib/region-format";

export const PRODUCT_KINDS = ["PHYSICAL", "DIGITAL", "SERVICE"] as const;
export type ProductKindValue = (typeof PRODUCT_KINDS)[number];

export const PRICE_MODELS = ["FIXED", "FROM", "PER_MONTH", "PER_YEAR", "PER_UNIT", "ON_REQUEST"] as const;
export type PriceModelValue = (typeof PRICE_MODELS)[number];

export const ITEM_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
export type ItemStatusValue = (typeof ITEM_STATUSES)[number];

export const MAX_PRODUCTS_PER_BUSINESS = 500;
export const MAX_USPS = 10;
export const MAX_FEATURES = 20;
export const MAX_VARIANTS = 30;
/** Photos in one product's (or campaign's) album. */
export const MAX_ALBUM_PHOTOS = 30;
/** Largest amount in the smallest currency unit (fits a Postgres integer). */
export const MAX_PRICE_MINOR = 2_000_000_000;

export const LIMITS = {
  name: 200,
  category: 80,
  summary: 300,
  description: 4000,
  item: 160,
  targetCustomer: 300,
  priceNote: 200,
  variant: 120,
  delivery: 500,
  warranty: 200,
  platform: 300,
  licence: 500,
  duration: 100,
} as const;

export type KindOption = {
  value: ProductKindValue;
  label: string;
  hint: string;
  namePlaceholder: string;
  summaryPlaceholder: string;
  uspPlaceholder: string;
  featurePlaceholder: string;
  categoryPlaceholder: string;
};

/** Examples suit any kind of business; they only show what to write. */
export const KIND_OPTIONS: KindOption[] = [
  {
    value: "PHYSICAL",
    label: "Physical product",
    hint: "Something people can hold: goods, food, clothes, devices, furniture.",
    namePlaceholder: "Handwoven sisal basket, large",
    summaryPlaceholder: "A large basket woven by hand in Rwanda, for storage or as a gift.",
    uspPlaceholder: "Made by a women's cooperative in Huye",
    featurePlaceholder: "40 cm wide, natural colours",
    categoryPlaceholder: "Home decor",
  },
  {
    value: "DIGITAL",
    label: "Digital product",
    hint: "Delivered online: software, courses, e-books, subscriptions, templates.",
    namePlaceholder: "Bookkeeping app for small shops",
    summaryPlaceholder: "Track sales, stock and MoMo payments from your phone.",
    uspPlaceholder: "Works offline and syncs when you are back online",
    featurePlaceholder: "Prints EBM-ready sales reports",
    categoryPlaceholder: "Business software",
  },
  {
    value: "SERVICE",
    label: "Service",
    hint: "Work you do for people: repairs, lessons, consulting, cleaning, beauty, events.",
    namePlaceholder: "Home deep cleaning",
    summaryPlaceholder: "A full clean of your home by a team of two, with our own products.",
    uspPlaceholder: "Same-week booking, Monday to Saturday",
    featurePlaceholder: "Kitchen, bathrooms and windows included",
    categoryPlaceholder: "Cleaning",
  },
];

export const KIND_LABEL: Record<ProductKindValue, string> = { PHYSICAL: "Physical product", DIGITAL: "Digital product", SERVICE: "Service" };
export const KIND_SHORT: Record<ProductKindValue, string> = { PHYSICAL: "Product", DIGITAL: "Digital", SERVICE: "Service" };

export const PRICE_MODEL_OPTIONS: { value: PriceModelValue; label: string; hint: string }[] = [
  { value: "FIXED", label: "Fixed price", hint: "One price, e.g. 15,000 RWF" },
  { value: "FROM", label: "From", hint: "The lowest price, e.g. from 15,000 RWF" },
  { value: "PER_MONTH", label: "Per month", hint: "A monthly price, e.g. 20,000 RWF a month" },
  { value: "PER_YEAR", label: "Per year", hint: "A yearly price" },
  { value: "PER_UNIT", label: "Per unit", hint: "Per piece, kilo, hour, night or metre: say which in the price note" },
  { value: "ON_REQUEST", label: "On request", hint: "No public price: customers ask for a quote" },
];

export const STATUS_LABEL: Record<ItemStatusValue, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

export const CONDITIONS = ["new", "used", "refurbished"] as const;
export const CONDITION_LABEL: Record<(typeof CONDITIONS)[number], string> = { new: "New", used: "Used", refurbished: "Refurbished" };

export const ACCESS_METHODS = ["download", "online_account", "email", "app", "other"] as const;
export const ACCESS_LABEL: Record<(typeof ACCESS_METHODS)[number], string> = {
  download: "Download",
  online_account: "Online account",
  email: "Sent by email",
  app: "Mobile app",
  other: "Other",
};

export const SERVICE_PLACES = ["on_site", "online", "our_location"] as const;
export const PLACE_LABEL: Record<(typeof SERVICE_PLACES)[number], string> = { on_site: "At the customer's place", online: "Online", our_location: "At our location" };

/** Currencies offered in the price field; the company's region currency comes first. */
export const CURRENCIES = ["RWF", "USD", "EUR", "KES", "UGX", "TZS", "BIF", "CDF", "GBP"] as const;

// ---- Schema -------------------------------------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

/** A list of short lines: trimmed, blanks and duplicates (ignoring case) removed. */
const lines = (max: number, each: number, label: string) =>
  z
    .array(z.string().max(1000))
    .max(100)
    .default([])
    .transform((list) => {
      const seen = new Set<string>();
      return list
        .map((v) => v.trim().replace(/\s+/g, " "))
        .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
    })
    .pipe(z.array(z.string().max(each, `Keep each line under ${each} characters.`)).max(max, `Add up to ${max} ${label}.`));

export const physicalDetailsSchema = z.object({
  variants: lines(MAX_VARIANTS, LIMITS.variant, "variants"),
  condition: z.enum(CONDITIONS).nullish().transform((v) => v ?? null),
  delivery: optionalText(LIMITS.delivery),
  warranty: optionalText(LIMITS.warranty),
});

export const digitalDetailsSchema = z.object({
  access: z
    .array(z.enum(ACCESS_METHODS))
    .max(ACCESS_METHODS.length)
    .default([])
    .transform((list) => [...new Set(list)]),
  platform: optionalText(LIMITS.platform),
  licence: optionalText(LIMITS.licence),
  trial: z.boolean().default(false),
});

export const serviceDetailsSchema = z.object({
  duration: optionalText(LIMITS.duration),
  places: z
    .array(z.enum(SERVICE_PLACES))
    .max(SERVICE_PLACES.length)
    .default([])
    .transform((list) => [...new Set(list)]),
  bookingNeeded: z.boolean().default(false),
});

export type PhysicalDetails = z.output<typeof physicalDetailsSchema>;
export type DigitalDetails = z.output<typeof digitalDetailsSchema>;
export type ServiceDetails = z.output<typeof serviceDetailsSchema>;
export type ProductDetails = PhysicalDetails | DigitalDetails | ServiceDetails;

export function detailsSchemaFor(kind: ProductKindValue) {
  return kind === "PHYSICAL" ? physicalDetailsSchema : kind === "DIGITAL" ? digitalDetailsSchema : serviceDetailsSchema;
}

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Choose a currency.");

/**
 * The price as typed ("15,000", "15 000", "49.99"), in the currency's main unit, to the smallest unit (15000 RWF,
 * 4999 cents). Null when it cannot be read or has more decimals than the currency allows.
 */
export function toMinor(raw: string, currency: string): number | null {
  const cleaned = raw.replace(/[\s,']/g, "").replace(/^(rwf|usd|frw|\$|€|£)/i, "").replace(/(rwf|frw|usd)$/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = minorDigits(currency);
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** The smallest-unit amount as the form shows it: 15000 RWF -> "15000", 4999 USD -> "49.99". */
export function fromMinor(minor: number | null | undefined, currency: string): string {
  if (minor == null) return "";
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const s = (minor / 10 ** digits).toFixed(digits);
  return s.replace(/\.0+$/, "");
}

const baseShape = {
  name: text(LIMITS.name).min(1, "Give it a name."),
  category: optionalText(LIMITS.category),
  summary: text(LIMITS.summary).min(1, "Describe it in a sentence or two."),
  description: optionalText(LIMITS.description),
  priceModel: z.enum(PRICE_MODELS, { error: "Choose how it is priced." }),
  /** The amount as typed, in the main unit; required unless the price is on request. */
  price: z.string().max(40).optional().default(""),
  currency: currencySchema,
  priceNote: optionalText(LIMITS.priceNote),
  usps: lines(MAX_USPS, LIMITS.item, "selling points").pipe(z.array(z.string()).min(1, "Add at least one reason to choose it.")),
  features: lines(MAX_FEATURES, LIMITS.item, "features"),
  targetCustomer: optionalText(LIMITS.targetCustomer),
  status: z.enum(ITEM_STATUSES).default("ACTIVE"),
};

/** The typed price as the smallest unit, or the problem with it. Defensive: it also runs while other fields are invalid. */
function priceProblem(v: { priceModel?: unknown; price?: unknown; currency?: unknown }): { minor: number | null; message?: string } {
  if (v.priceModel === "ON_REQUEST" || typeof v.priceModel !== "string") return { minor: null };
  const raw = typeof v.price === "string" ? v.price.trim() : "";
  const currency = typeof v.currency === "string" && /^[A-Za-z]{3}$/.test(v.currency.trim()) ? v.currency.trim().toUpperCase() : "USD";
  if (!raw) return { minor: null, message: "Enter the price, or choose On request." };
  const minor = toMinor(raw, currency);
  if (minor === null) return { minor: null, message: `Enter a number, e.g. ${minorDigits(currency) === 0 ? "15000" : "49.99"}.` };
  if (minor > MAX_PRICE_MINOR) return { minor: null, message: "That price is too large." };
  return { minor };
}

// Checked with every other field (not only once the rest is valid), so the form shows every problem at once.
const always = { when: () => true };

/** What the product form sends. Kind-specific fields sit under `details` and are checked against the kind. */
export const productInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PHYSICAL"), ...baseShape, details: physicalDetailsSchema.default({ variants: [], condition: null, delivery: null, warranty: null }) }),
  z.object({ kind: z.literal("DIGITAL"), ...baseShape, details: digitalDetailsSchema.default({ access: [], platform: null, licence: null, trial: false }) }),
  z.object({ kind: z.literal("SERVICE"), ...baseShape, details: serviceDetailsSchema.default({ duration: null, places: [], bookingNeeded: false }) }),
], { error: "Choose what kind of thing it is." })
  .superRefine((value, ctx) => {
    const problem = priceProblem((value ?? {}) as Record<string, unknown>).message;
    if (problem) ctx.addIssue({ code: "custom", path: ["price"], message: problem });
  }, always)
  .transform((value) => ({ ...value, priceAmount: priceProblem(value).minor }));

export type ProductInput = z.input<typeof productInputSchema>;
export type ProductData = z.output<typeof productInputSchema>;

/** Field errors keyed by their path ("details.warranty", "usps"); the first message per field. */
export function fieldErrorMap(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.filter((p) => typeof p === "string").join(".") || String(issue.path[0]) : "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Reads stored kind-specific details leniently: a broken value becomes the empty default, never an error. */
export function readDetails(kind: ProductKindValue, value: unknown): ProductDetails {
  const parsed = detailsSchemaFor(kind).safeParse(value && typeof value === "object" ? value : {});
  return parsed.success ? parsed.data : detailsSchemaFor(kind).parse({});
}

// ---- Display ------------------------------------------------------------------------------------------------------

export type PriceFields = { priceModel: PriceModelValue; priceAmount: number | null; currency: string; priceNote?: string | null };

/** "15,000 RWF", "From $49", "20,000 RWF a month", "On request"; the note of a migrated price when there is no amount. */
export function formatPrice(p: PriceFields): string {
  if (p.priceAmount == null) {
    if (p.priceNote) return p.priceNote;
    return p.priceModel === "ON_REQUEST" ? "Price on request" : "Price not set";
  }
  const amount = formatMinor(p.priceAmount, p.currency);
  switch (p.priceModel) {
    case "FROM":
      return `From ${amount}`;
    case "PER_MONTH":
      return `${amount} a month`;
    case "PER_YEAR":
      return `${amount} a year`;
    case "PER_UNIT":
      return `${amount} per unit`;
    case "ON_REQUEST":
      return "Price on request";
    default:
      return amount;
  }
}

/**
 * formatPrice plus the note, for places with room ("15,000 RWF · Discount from 3 pieces"). A note that only repeats
 * the amount (the store's price text kept for the re-sync rule, lib/stores/sync.ts) is not shown twice.
 */
export function priceLine(p: PriceFields): string {
  const main = formatPrice(p);
  if (p.priceAmount == null || !p.priceNote) return main;
  const parsed = parsePriceText(p.priceNote, p.currency);
  if (parsed && toMinor(parsed.price, parsed.currency) === p.priceAmount) return main;
  return `${main} · ${p.priceNote}`;
}

/**
 * A free-text price ("From $49", "15,000 RWF", "20 000 Frw per month") as structured fields, when it can be read.
 * Used to prefill the form for migrated and imported products; null when there is no clear number.
 */
export function parsePriceText(raw: string | null | undefined, fallbackCurrency: string): { priceModel: PriceModelValue; price: string; currency: string } | null {
  if (!raw) return null;
  const textValue = raw.trim();
  const priceModel = legacyPriceModel(textValue);
  if (priceModel === "ON_REQUEST") return null;
  const currency = /\$|usd/i.test(textValue) ? "USD" : /€|eur/i.test(textValue) ? "EUR" : /rwf|frw|\bfr\b/i.test(textValue) ? "RWF" : /kes|ksh/i.test(textValue) ? "KES" : /ugx/i.test(textValue) ? "UGX" : /tzs/i.test(textValue) ? "TZS" : /£|gbp/i.test(textValue) ? "GBP" : fallbackCurrency;
  const numbers = textValue.match(/\d[\d,\s']*(\.\d+)?/g);
  if (!numbers || numbers.length !== 1) return null;
  const price = numbers[0].replace(/[\s,']/g, "");
  return toMinor(price, currency) == null ? null : { priceModel, price, currency };
}

/**
 * The price model of a free-text price, as the migration (20261013100000_knowledge_base) decides it in SQL: no digit
 * is "on request", "from ..." is FROM, "per month" / "monthly" PER_MONTH, "per year" / "yearly" / "annual" PER_YEAR,
 * anything else FIXED. Keep the two in step (tests/knowledge/legacy.test.ts).
 */
export function legacyPriceModel(price: string | null | undefined): PriceModelValue {
  const p = price ?? "";
  if (!/[0-9]/.test(p)) return "ON_REQUEST";
  if (/^\s*from\s/i.test(p)) return "FROM";
  if (/(per|\/|a|an)\s*month|monthly/i.test(p)) return "PER_MONTH";
  if (/(per|\/|a|an)\s*year|yearly|annual/i.test(p)) return "PER_YEAR";
  return "FIXED";
}

export type ProductReadiness = { ready: boolean; missing: string[] };

/** What a product still needs before the AI has enough to write well (shown as "Needs details"). */
export function productReadiness(p: { summary: string; usps: string[]; priceModel: PriceModelValue; priceAmount: number | null; priceNote?: string | null; photoCount?: number }): ProductReadiness {
  const missing: string[] = [];
  if (!p.summary.trim()) missing.push("a short description");
  if (p.usps.length === 0) missing.push("a reason to choose it");
  if (p.priceModel !== "ON_REQUEST" && p.priceAmount == null) missing.push("a price");
  if (p.photoCount === 0) missing.push("a photo");
  return { ready: missing.length === 0, missing };
}

/** Form values for a stored product (or a blank form): amounts back to the typed form, notes parsed when possible. */
export function productFormValues(
  p: {
    kind: ProductKindValue;
    name: string;
    category: string | null;
    summary: string;
    description: string | null;
    priceModel: PriceModelValue;
    priceAmount: number | null;
    currency: string;
    priceNote: string | null;
    usps: string[];
    features: string[];
    targetCustomer: string | null;
    status: ItemStatusValue;
    details: unknown;
  } | null,
  defaultCurrency: string,
): ProductFormValues {
  if (!p) {
    return { kind: "PHYSICAL", name: "", category: "", summary: "", description: "", priceModel: "FIXED", price: "", currency: defaultCurrency, priceNote: "", usps: [], features: [], targetCustomer: "", status: "ACTIVE", details: {} };
  }
  let { priceModel, currency } = p;
  let price = fromMinor(p.priceAmount, p.currency);
  let priceNote = p.priceNote ?? "";
  if (p.priceAmount == null && p.priceNote) {
    const parsed = parsePriceText(p.priceNote, p.currency);
    if (parsed) {
      ({ priceModel, price, currency } = parsed);
      priceNote = "";
    }
  }
  return {
    kind: p.kind,
    name: p.name,
    category: p.category ?? "",
    summary: p.summary,
    description: p.description ?? "",
    priceModel,
    price,
    currency,
    priceNote,
    usps: p.usps,
    features: p.features,
    targetCustomer: p.targetCustomer ?? "",
    status: p.status,
    details: readDetails(p.kind, p.details) as Record<string, unknown>,
  };
}

export type ProductFormValues = {
  kind: ProductKindValue;
  name: string;
  category: string;
  summary: string;
  description: string;
  priceModel: PriceModelValue;
  price: string;
  currency: string;
  priceNote: string;
  usps: string[];
  features: string[];
  targetCustomer: string;
  status: ItemStatusValue;
  details: Record<string, unknown>;
};
