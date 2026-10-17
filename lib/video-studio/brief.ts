import "server-only";
import { prisma } from "@/lib/db";
import { priceLine } from "@/lib/knowledge/products";
import { imageSize, sniffMediaType } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BriefPhoto, DesignBrief } from "@/lib/video-engine/designer";

// The Video Studio's brief from the company's own data (docs/VIDEO_APP_INTEGRATION.md, task 5): the business, one of
// its products and up to 4 of its photos, read from Storage for Claude to see. Photos must be the company's own
// (MediaAsset of this business); nothing from the browser becomes a path we read without that check.

/** At most this many photos go to Claude (the designer's limit). */
export const MAX_DESIGN_PHOTOS = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export class BriefError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "invalid_photo",
  ) {
    super(message);
    this.name = "BriefError";
  }
}

/** A photo as the job keeps it (no image bytes): where it is, its size and what the owner wrote about it. */
export type StoredPhoto = { path: string; width: number; height: number; note: string | null };

type ProductRow = { id: string; name: string; summary: string; description: string | null; priceModel: string; priceAmount: number | null; currency: string; priceNote: string | null; usps: string[]; features: string[]; targetCustomer: string | null };

/** The product's price as the designer reads it, or null when none is set (Claude then shows no price). */
export function briefPrice(p: Pick<ProductRow, "priceModel" | "priceAmount" | "currency" | "priceNote">): string | null {
  if (p.priceAmount == null && !p.priceNote) return null;
  return priceLine({ priceModel: p.priceModel as Parameters<typeof priceLine>[0]["priceModel"], priceAmount: p.priceAmount, currency: p.currency, priceNote: p.priceNote });
}

/** The business and product parts of a brief. Throws BriefError("not_found") for a product of another business. */
export async function loadBriefFacts(businessId: string, productId: string): Promise<Pick<DesignBrief, "business" | "product"> & { productId: string }> {
  const [business, product] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true, description: true, industryDescription: true, contentLanguage: true, brandColors: true, phone: true, website: true, country: true, tone: true } }),
    prisma.product.findFirst({ where: { id: productId, businessId }, select: { id: true, name: true, summary: true, description: true, priceModel: true, priceAmount: true, currency: true, priceNote: true, usps: true, features: true, targetCustomer: true } }),
  ]);
  if (!business) throw new BriefError("We could not find your business.", "not_found");
  if (!product) throw new BriefError("We could not find that product.", "not_found");
  return {
    productId: product.id,
    business: { name: business.name, description: business.description ?? business.industryDescription, language: business.contentLanguage, colors: business.brandColors, phone: business.phone, website: business.website, country: business.country, tone: business.tone },
    product: { name: product.name, summary: product.summary, description: product.description, price: briefPrice(product as ProductRow), usps: product.usps, features: product.features, targetCustomer: product.targetCustomer },
  };
}

/**
 * The photos for a design: the paths asked for (each must be this business's gallery photo), or else the product's
 * album in order; at most MAX_DESIGN_PHOTOS. Returns the stored shape (paths, sizes, notes) without reading files.
 */
export async function choosePhotos(businessId: string, productId: string, paths: string[] | null): Promise<(StoredPhoto & { cutoutBox: unknown; cutoutPath: string | null })[]> {
  const select = { path: true, width: true, height: true, description: true, kind: true, cutoutPath: true, cutoutBox: true } as const;
  let assets;
  if (paths && paths.length) {
    const wanted = paths.slice(0, MAX_DESIGN_PHOTOS);
    const found = await prisma.mediaAsset.findMany({ where: { businessId, path: { in: wanted } }, select });
    const unknown = wanted.filter((p) => !found.some((a) => a.path === p && a.kind === "photo"));
    if (unknown.length) throw new BriefError("Use photos from your BuPulse gallery (their storage paths). Upload them in the Gallery first.", "invalid_photo");
    assets = wanted.map((p) => found.find((a) => a.path === p)!);
  } else {
    const album = await prisma.productPhoto.findMany({ where: { productId }, orderBy: { position: "asc" }, take: MAX_DESIGN_PHOTOS, select: { asset: { select } } });
    assets = album.map((r) => r.asset).filter((a) => a.kind === "photo");
  }
  return assets.map((a) => ({ path: a.path, width: a.width ?? 0, height: a.height ?? 0, note: a.description ?? null, cutoutPath: a.cutoutPath, cutoutBox: a.cutoutBox }));
}

/** Reads the chosen photos from Storage for Claude (resized to 1,280 px when Storage can, else the original). */
export async function readPhotos(photos: (StoredPhoto & { cutoutBox: unknown; cutoutPath: string | null })[]): Promise<BriefPhoto[]> {
  if (!photos.length) return [];
  const storage = createAdminClient().storage.from("media");
  const out: BriefPhoto[] = [];
  for (const p of photos) {
    let result = await storage.download(p.path, { transform: { width: 1280, quality: 82 } });
    if (result.error) result = await storage.download(p.path);
    if (result.error || !result.data) throw new BriefError("A photo could not be read from your gallery. Try another one.", "invalid_photo");
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) throw new BriefError("A photo is too large (over 8 MB). Use a smaller one.", "invalid_photo");
    const type = sniffMediaType(bytes);
    if (!type || !(PHOTO_TYPES as readonly string[]).includes(type)) throw new BriefError("Videos need JPG, PNG or WebP photos.", "invalid_photo");
    const size = imageSize(bytes) ?? { width: p.width, height: p.height };
    const box = p.cutoutBox as { x: number; y: number; w: number; h: number } | null;
    out.push({ base64: Buffer.from(bytes).toString("base64"), mediaType: type as BriefPhoto["mediaType"], width: size.width, height: size.height, note: p.note ?? undefined, cutout: !!p.cutoutPath, subject: box && typeof box.x === "number" ? box : null });
  }
  return out;
}
