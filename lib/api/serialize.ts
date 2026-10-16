// The public shapes of the REST API (docs/API.md). Fields are listed one by one, so adding a column to the
// database never leaks it, and private storage paths are never exposed.

import { formatPrice, type PriceFields, type ProductKindValue, type ItemStatusValue } from "@/lib/knowledge/products";
import type { CampaignTypeValue } from "@/lib/knowledge/campaigns";
import { legacyTypeOf } from "@/lib/knowledge/legacy";
import { subjectIds } from "@/lib/webhooks/events";

const iso = (d: Date | null) => d?.toISOString() ?? null;
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

type ProductRow = PriceFields & { id: string; kind: ProductKindValue; name: string; category: string | null; summary: string; description: string | null; usps: string[]; features: string[]; targetCustomer: string | null; status: ItemStatusValue; createdAt: Date; updatedAt: Date; _count?: { photos: number } };
type CampaignRow = { id: string; type: CampaignTypeValue; name: string; description: string | null; startsAt: Date | null; endsAt: Date | null; priceInfo: string | null; highlights: string[]; status: ItemStatusValue; createdAt: Date; updatedAt: Date; products?: { productId: string }[]; _count?: { photos: number } };

export function productJson(p: ProductRow) {
  return {
    id: p.id,
    kind: p.kind.toLowerCase(),
    name: p.name,
    category: p.category,
    summary: p.summary,
    description: p.description,
    price: { model: p.priceModel.toLowerCase(), amountMinor: p.priceAmount, currency: p.currency, note: p.priceNote ?? null, label: formatPrice(p) },
    sellingPoints: p.usps,
    features: p.features,
    targetCustomer: p.targetCustomer,
    status: p.status.toLowerCase(),
    photoCount: p._count?.photos ?? 0,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

export function campaignJson(c: CampaignRow) {
  return {
    id: c.id,
    type: c.type.toLowerCase(),
    name: c.name,
    description: c.description,
    startsOn: day(c.startsAt),
    endsOn: day(c.endsAt),
    priceInfo: c.priceInfo,
    highlights: c.highlights,
    productIds: (c.products ?? []).map((x) => x.productId),
    status: c.status.toLowerCase(),
    photoCount: c._count?.photos ?? 0,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

/** The deprecated /projects shape, filled from a product or a campaign (same id as the project it replaced). */
export function legacyProjectJson(r: { product: ProductRow } | { campaign: CampaignRow }) {
  if ("product" in r) {
    const p = r.product;
    return { id: p.id, type: legacyTypeOf(p), title: p.name, price: formatPrice(p), features: [...p.usps, ...p.features], photoCount: p._count?.photos ?? 0, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) };
  }
  const c = r.campaign;
  return { id: c.id, type: legacyTypeOf(c), title: c.name, price: c.priceInfo, features: c.highlights, photoCount: c._count?.photos ?? 0, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) };
}

export function contentJson(c: { id: string; productId: string | null; campaignId: string | null; projectId: string | null; caption: string; hashtags: string[]; videoScript: string; adHeadlines: string[]; language: string; edited: boolean; createdAt: Date }) {
  return { id: c.id, ...subjectIds(c), caption: c.caption, hashtags: c.hashtags, videoScript: c.videoScript, adHeadlines: c.adHeadlines, language: c.language, edited: c.edited, createdAt: iso(c.createdAt) };
}

export function postJson(p: { id: string; network: string; status: string; format: string; productId: string | null; campaignId: string | null; projectId: string | null; contentId: string | null; title: string | null; text: string; hashtags: string[]; link: string | null; mediaPaths: string[]; scheduledAt: Date | null; publishedAt: Date | null; permalink: string | null; lastError: string | null; createdAt: Date }) {
  return {
    id: p.id,
    network: p.network,
    status: p.status.toLowerCase(),
    format: p.format.toLowerCase(),
    ...subjectIds(p),
    contentId: p.contentId,
    title: p.title,
    text: p.text,
    hashtags: p.hashtags,
    link: p.link,
    mediaCount: p.mediaPaths.length,
    scheduledAt: iso(p.scheduledAt),
    publishedAt: iso(p.publishedAt),
    permalink: p.permalink,
    error: p.lastError,
    createdAt: iso(p.createdAt),
  };
}

export function leadJson(l: { id: string; name: string | null; email: string | null; phone: string | null; interest: string | null; message: string | null; source: string; status: string; notes: string | null; pageUrl: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: l.id, name: l.name, email: l.email, phone: l.phone, interest: l.interest, message: l.message, source: l.source, status: l.status.toLowerCase(), notes: l.notes, pageUrl: l.pageUrl, createdAt: iso(l.createdAt), updatedAt: iso(l.updatedAt) };
}
