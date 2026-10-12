// Products and campaigns in the database, always scoped to one business (another company's row is "not found").
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { companyRegion } from "@/lib/region";
import { albumItems, signedUrls, type MediaItem } from "@/lib/media/service";
import { albumPaths } from "@/lib/media/albums";
import { dayDate, MAX_CAMPAIGNS_PER_BUSINESS, type CampaignData } from "./campaigns";
import { campaignContext, productContext, type ContextProduct } from "./context";
import { legacyTypeOf } from "./legacy";
import { formatPrice, MAX_PRODUCTS_PER_BUSINESS, productReadiness, type ItemStatusValue, type ProductData, type ProductKindValue } from "./products";

/** A problem the owner can read and act on. */
export class KnowledgeError extends Error {}

export type Subject = { kind: "product"; id: string } | { kind: "campaign"; id: string };

/** The columns that tie content, designs and posts to their subject. */
export function subjectColumns(subject: Subject | null | undefined): { productId: string | null; campaignId: string | null } {
  return { productId: subject?.kind === "product" ? subject.id : null, campaignId: subject?.kind === "campaign" ? subject.id : null };
}

export function subjectHref(subject: Subject): string {
  return subject.kind === "product" ? `/dashboard/knowledge/products/${subject.id}` : `/dashboard/knowledge/campaigns/${subject.id}`;
}

/**
 * Which of the business's products or campaigns an id names. Old project ids work too: the migration kept them.
 */
export async function resolveSubject(businessId: string, id: string | null | undefined): Promise<Subject | null> {
  if (!id || typeof id !== "string" || id.length > 60) return null;
  const [product, campaign] = await Promise.all([
    prisma.product.findFirst({ where: { id, businessId }, select: { id: true } }),
    prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true } }),
  ]);
  if (product) return { kind: "product", id };
  if (campaign) return { kind: "campaign", id };
  return null;
}

/** The currency new products start in: the company's region currency (RWF in Rwanda). */
export async function defaultCurrency(businessId: string): Promise<string> {
  return (await companyRegion(businessId)).currency;
}

// ---- Products ------------------------------------------------------------------------------------------------------

function productRow(data: ProductData) {
  return {
    kind: data.kind,
    name: data.name,
    category: data.category,
    summary: data.summary,
    description: data.description,
    priceModel: data.priceModel,
    priceAmount: data.priceAmount,
    currency: data.currency,
    priceNote: data.priceNote,
    usps: data.usps,
    features: data.features,
    targetCustomer: data.targetCustomer,
    status: data.status,
    details: data.details as Prisma.InputJsonValue,
  };
}

export type ProductFilter = { kind?: ProductKindValue; status?: ItemStatusValue | "all"; q?: string };

export type ProductCard = {
  id: string;
  kind: ProductKindValue;
  name: string;
  category: string | null;
  summary: string;
  price: string;
  status: ItemStatusValue;
  thumb: string | null;
  photoCount: number;
  contentCount: number;
  ready: boolean;
  missing: string[];
  syncedFrom: string | null;
};

/** The product list, newest first. Archived products only when asked for. */
export async function listProducts(businessId: string, filter: ProductFilter = {}): Promise<ProductCard[]> {
  const q = filter.q?.trim().slice(0, 80);
  const rows = await prisma.product.findMany({
    where: {
      businessId,
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.status && filter.status !== "all" ? { status: filter.status } : filter.status === "all" ? {} : { status: { not: "ARCHIVED" } }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 200,
    include: {
      _count: { select: { photos: true, contents: true } },
      photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 1, select: { asset: { select: { path: true } } } },
      storeSync: { select: { connection: { select: { provider: true } } } },
    },
  });
  const urls = await signedUrls(rows.flatMap((r) => (r.photos[0] ? [r.photos[0].asset.path] : [])));
  return rows.map((r) => {
    const readiness = productReadiness({ ...r, photoCount: r._count.photos });
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      category: r.category,
      summary: r.summary,
      price: formatPrice(r),
      status: r.status,
      thumb: r.photos[0] ? (urls.get(r.photos[0].asset.path) ?? null) : null,
      photoCount: r._count.photos,
      contentCount: r._count.contents,
      ready: readiness.ready,
      missing: readiness.missing,
      syncedFrom: r.storeSync?.connection.provider ?? null,
    };
  });
}

export async function getProduct(businessId: string, id: string) {
  return prisma.product.findFirst({
    where: { id, businessId },
    include: {
      campaigns: { select: { campaign: { select: { id: true, name: true, type: true, status: true } } } },
      storeSync: { select: { connection: { select: { provider: true } } } },
      _count: { select: { photos: true } },
    },
  });
}

export async function productAlbum(businessId: string, id: string): Promise<MediaItem[]> {
  return albumItems(businessId, "product", id);
}

export async function createProduct(businessId: string, data: ProductData): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`products:${businessId}`}))`;
    if ((await tx.product.count({ where: { businessId } })) >= MAX_PRODUCTS_PER_BUSINESS) {
      throw new KnowledgeError(`You have reached the limit of ${MAX_PRODUCTS_PER_BUSINESS} products. Archive or delete some to add more.`);
    }
    const row = await tx.product.create({ data: { businessId, ...productRow(data) }, select: { id: true } });
    return row.id;
  });
}

export async function updateProduct(businessId: string, id: string, data: ProductData): Promise<void> {
  const { count } = await prisma.product.updateMany({ where: { id, businessId }, data: productRow(data) });
  if (count === 0) throw new KnowledgeError("We could not find that product.");
}

export async function setProductStatus(businessId: string, id: string, status: ItemStatusValue): Promise<void> {
  const { count } = await prisma.product.updateMany({ where: { id, businessId }, data: { status } });
  if (count === 0) throw new KnowledgeError("We could not find that product.");
}

/** A copy as a draft ("Copy of …"), with the same album photos. Content, designs and store links are not copied. */
export async function duplicateProduct(businessId: string, id: string): Promise<string> {
  const source = await prisma.product.findFirst({ where: { id, businessId }, include: { photos: { select: { assetId: true, position: true } } } });
  if (!source) throw new KnowledgeError("We could not find that product.");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`products:${businessId}`}))`;
    if ((await tx.product.count({ where: { businessId } })) >= MAX_PRODUCTS_PER_BUSINESS) {
      throw new KnowledgeError(`You have reached the limit of ${MAX_PRODUCTS_PER_BUSINESS} products. Archive or delete some to add more.`);
    }
    const copy = await tx.product.create({
      data: {
        businessId,
        kind: source.kind,
        name: `Copy of ${source.name}`.slice(0, 200),
        category: source.category,
        summary: source.summary,
        description: source.description,
        priceModel: source.priceModel,
        priceAmount: source.priceAmount,
        currency: source.currency,
        priceNote: source.priceNote,
        usps: source.usps,
        features: source.features,
        targetCustomer: source.targetCustomer,
        status: "DRAFT",
        details: (source.details ?? undefined) as Prisma.InputJsonValue | undefined,
        photos: { create: source.photos.map((p) => ({ assetId: p.assetId, position: p.position })) },
      },
      select: { id: true },
    });
    return copy.id;
  });
}

/** Deletes the product and its written content. Its photos stay in the gallery; designs and posts keep existing. */
export async function deleteProduct(businessId: string, id: string): Promise<void> {
  const { count } = await prisma.product.deleteMany({ where: { id, businessId } });
  if (count === 0) throw new KnowledgeError("We could not find that product.");
}

// ---- Campaigns -----------------------------------------------------------------------------------------------------

async function ownProductIds(tx: Prisma.TransactionClient, businessId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.product.findMany({ where: { businessId, id: { in: ids } }, select: { id: true } });
  if (rows.length !== ids.length) throw new KnowledgeError("One of the linked products could not be found.");
  return ids;
}

function campaignRow(data: CampaignData) {
  return {
    type: data.type,
    name: data.name,
    description: data.description,
    startsAt: dayDate(data.startsOn),
    endsAt: dayDate(data.endsOn),
    priceInfo: data.priceInfo,
    highlights: data.highlights,
    status: data.status,
  };
}

export async function listCampaigns(businessId: string, filter: { status?: ItemStatusValue | "all"; q?: string } = {}) {
  const q = filter.q?.trim().slice(0, 80);
  const rows = await prisma.campaign.findMany({
    where: {
      businessId,
      ...(filter.status && filter.status !== "all" ? { status: filter.status } : filter.status === "all" ? {} : { status: { not: "ARCHIVED" } }),
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ startsAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    include: {
      _count: { select: { products: true, photos: true, contents: true } },
      photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 1, select: { asset: { select: { path: true } } } },
    },
  });
  const urls = await signedUrls(rows.flatMap((r) => (r.photos[0] ? [r.photos[0].asset.path] : [])));
  return rows.map((r) => ({ ...r, thumb: r.photos[0] ? (urls.get(r.photos[0].asset.path) ?? null) : null }));
}

export async function getCampaign(businessId: string, id: string) {
  return prisma.campaign.findFirst({
    where: { id, businessId },
    include: {
      products: { select: { product: { select: { id: true, name: true, kind: true, status: true, priceModel: true, priceAmount: true, currency: true, priceNote: true } } } },
      _count: { select: { photos: true } },
    },
  });
}

export async function createCampaign(businessId: string, data: CampaignData): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaigns:${businessId}`}))`;
    if ((await tx.campaign.count({ where: { businessId } })) >= MAX_CAMPAIGNS_PER_BUSINESS) {
      throw new KnowledgeError(`You have reached the limit of ${MAX_CAMPAIGNS_PER_BUSINESS} campaigns. Archive or delete some to add more.`);
    }
    const productIds = await ownProductIds(tx, businessId, data.productIds);
    const row = await tx.campaign.create({
      data: { businessId, ...campaignRow(data), products: { create: productIds.map((productId) => ({ productId })) } },
      select: { id: true },
    });
    return row.id;
  });
}

export async function updateCampaign(businessId: string, id: string, data: CampaignData): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.campaign.updateMany({ where: { id, businessId }, data: campaignRow(data) });
    if (count === 0) throw new KnowledgeError("We could not find that campaign.");
    const productIds = await ownProductIds(tx, businessId, data.productIds);
    await tx.campaignProduct.deleteMany({ where: { campaignId: id, productId: { notIn: productIds } } });
    await tx.campaignProduct.createMany({ data: productIds.map((productId) => ({ campaignId: id, productId })), skipDuplicates: true });
  });
}

export async function setCampaignStatus(businessId: string, id: string, status: ItemStatusValue): Promise<void> {
  const { count } = await prisma.campaign.updateMany({ where: { id, businessId }, data: { status } });
  if (count === 0) throw new KnowledgeError("We could not find that campaign.");
}

export async function deleteCampaign(businessId: string, id: string): Promise<void> {
  const { count } = await prisma.campaign.deleteMany({ where: { id, businessId } });
  if (count === 0) throw new KnowledgeError("We could not find that campaign.");
}

// ---- Writing from a product or campaign --------------------------------------------------------------------------

const CONTEXT_SELECT = {
  kind: true,
  name: true,
  category: true,
  summary: true,
  description: true,
  priceModel: true,
  priceAmount: true,
  currency: true,
  priceNote: true,
  usps: true,
  features: true,
  targetCustomer: true,
  details: true,
} as const;

export type WritingSubject = {
  subject: Subject;
  /** The old project type, for the playbook and the design templates. */
  type: string;
  title: string;
  /** The fenced data block for the writer (lib/knowledge/context.ts). */
  context: string;
  price: string | null;
  features: string[];
  /** Album photos, cover first. */
  photoPaths: string[];
};

/** Everything a writer (Studio, Autopilot, designs) needs about a product or campaign, or null when it is not theirs. */
export async function writingSubject(businessId: string, subject: Subject): Promise<WritingSubject | null> {
  if (subject.kind === "product") {
    const p = await prisma.product.findFirst({ where: { id: subject.id, businessId }, select: { ...CONTEXT_SELECT, id: true } });
    if (!p) return null;
    return { subject, type: legacyTypeOf(p), title: p.name, context: productContext(p), price: formatPrice(p), features: [...p.usps, ...p.features].slice(0, 10), photoPaths: await albumPaths("product", p.id) };
  }
  const c = await prisma.campaign.findFirst({
    where: { id: subject.id, businessId },
    include: { products: { take: 5, select: { product: { select: CONTEXT_SELECT } } } },
  });
  if (!c) return null;
  const products: ContextProduct[] = c.products.map((x) => x.product);
  let photoPaths = await albumPaths("campaign", c.id);
  // A campaign without its own photos uses its first product's album.
  if (photoPaths.length === 0) {
    const first = await prisma.campaignProduct.findFirst({ where: { campaignId: c.id }, select: { productId: true } });
    if (first) photoPaths = await albumPaths("product", first.productId);
  }
  return { subject, type: legacyTypeOf(c), title: c.name, context: campaignContext({ ...c, products }), price: c.priceInfo, features: c.highlights, photoPaths };
}

/** Products and campaigns to pick from ("Start from…" in Studio, designs and the composer). Archived ones are left out. */
export async function subjectOptions(businessId: string) {
  const [products, campaigns] = await Promise.all([
    prisma.product.findMany({ where: { businessId, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, kind: true } }),
    prisma.campaign.findMany({ where: { businessId, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, type: true } }),
  ]);
  return { products, campaigns };
}
