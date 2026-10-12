// Projects -> Products and Campaigns. The migration 20261013100000_knowledge_base does the copy in SQL; this is the
// same mapping as a pure function, so the rule is documented, tested (tests/knowledge/legacy.test.ts) and reused where
// old project types are still spoken: the Autopilot playbook, the design templates and the public API's legacy routes.

import { legacyPriceModel, type PriceModelValue, type ProductKindValue } from "./products";
import type { CampaignTypeValue } from "./campaigns";

export type LegacyProject = {
  id: string;
  type: string;
  title: string;
  price: string | null;
  features: string[];
  details: unknown;
  photoPaths: string[];
};

export type MappedProduct = {
  target: "product";
  id: string;
  kind: ProductKindValue;
  name: string;
  category: string | null;
  summary: string;
  description: string | null;
  priceModel: PriceModelValue;
  priceAmount: null;
  priceNote: string | null;
  usps: string[];
  features: string[];
  photoPaths: string[];
};

export type MappedCampaign = {
  target: "campaign";
  id: string;
  type: CampaignTypeValue;
  name: string;
  description: string | null;
  priceInfo: string | null;
  highlights: string[];
  photoPaths: string[];
};

/** Old types that become products, and the kind each becomes. */
export const PRODUCT_TYPES: Record<string, ProductKindValue> = { product: "PHYSICAL", listing: "PHYSICAL", service: "SERVICE", project: "SERVICE" };
const CATEGORY: Record<string, string> = { listing: "Listing", project: "Finished work" };

function notesOf(details: unknown): string | null {
  if (details && typeof details === "object" && "notes" in details) {
    const notes = (details as { notes?: unknown }).notes;
    if (typeof notes === "string" && /\S/.test(notes)) return notes;
  }
  return null;
}

const blankToNull = (v: string | null) => (v && /\S/.test(v) ? v.trim() : null);

/**
 * product, listing -> physical product; service, project ("finished work you want to show") -> service; event -> event
 * campaign; offer -> offer campaign; anything else (other, milestone, types sent through the API) -> "other" campaign.
 * The id is kept. The free-text price stays as the price note with the model read from it (no amount: the owner
 * confirms the number when they next edit). Notes become the description, and the first 300 characters the summary.
 */
export function mapLegacyProject(p: LegacyProject): MappedProduct | MappedCampaign {
  const type = p.type.trim().toLowerCase();
  const notes = notesOf(p.details);
  const name = p.title.trim().slice(0, 200);
  const kind = PRODUCT_TYPES[type];
  if (kind) {
    return {
      target: "product",
      id: p.id,
      kind,
      name,
      category: CATEGORY[type] ?? null,
      summary: (notes ?? p.title).replace(/\s+/g, " ").trim().slice(0, 300),
      description: notes,
      priceModel: legacyPriceModel(p.price),
      priceAmount: null,
      priceNote: blankToNull(p.price),
      usps: [],
      features: p.features,
      photoPaths: p.photoPaths,
    };
  }
  return {
    target: "campaign",
    id: p.id,
    type: type === "event" ? "EVENT" : type === "offer" ? "OFFER" : "OTHER",
    name,
    description: notes,
    priceInfo: blankToNull(p.price),
    highlights: p.features,
    photoPaths: p.photoPaths,
  };
}

/**
 * The old project type a product or campaign speaks as, for code that still sorts by it: the Autopilot playbook
 * (`projectTypes`), the design templates (`suits`) and the API's legacy `/projects` shape.
 */
export function legacyTypeOf(subject: { kind: ProductKindValue; category?: string | null } | { type: CampaignTypeValue }): string {
  if ("kind" in subject) {
    if (subject.kind === "SERVICE") return subject.category === "Finished work" ? "project" : "service";
    return subject.category === "Listing" ? "listing" : "product";
  }
  return subject.type === "EVENT" ? "event" : subject.type === "OFFER" || subject.type === "PROMOTION" ? "offer" : subject.type === "LAUNCH" ? "product" : "other";
}

/** The columns of a mapped product (for prisma.product.create; add businessId and currency). */
export function productColumns(m: MappedProduct) {
  return { kind: m.kind, name: m.name, category: m.category, summary: m.summary, description: m.description, priceModel: m.priceModel, priceAmount: m.priceAmount, priceNote: m.priceNote, usps: m.usps, features: m.features };
}

/** The columns of a mapped campaign (for prisma.campaign.create; add businessId). */
export function campaignColumns(m: MappedCampaign) {
  return { type: m.type, name: m.name, description: m.description, priceInfo: m.priceInfo, highlights: m.highlights };
}
