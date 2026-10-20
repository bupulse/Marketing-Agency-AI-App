// Link in bio (docs/guide/features/33-link-in-bio.md): loading, saving and counting a company's public page. The page
// shows small JPEG copies of the logo and of each product's first photo, made on save into the company's own "bio"
// folder of the private media bucket and served by /b/<slug>/photo/<file>: the gallery files themselves never become
// public, and a visitor on a slow phone downloads about 40 KB a photo instead of the original.
import "server-only";
import { prisma } from "@/lib/db";
import { isOwnLogoPath, readKnowledge } from "@/lib/brand/schemas";
import { companyEntitlements } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readProfile } from "@/lib/knowledge/profile";
import { smallJpeg } from "@/lib/publishing/jpeg";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccent } from "@/lib/widget/config";
import { suggestSlug, slugProblem } from "./slug";
import { bioSource } from "./source";
import { BIO_LINK_TYPES, type BioLinkType, type BioSettings, type BioSource } from "./view";

const MEDIA = "media";
const PHOTO = { maxSide: 480, square: true };
const LOGO = { maxSide: 320, quality: 85 };
const PRODUCT_PICKER_MAX = 200;
export const STATS_DAYS = 30;

export class BioError extends Error {
  constructor(
    message: string,
    public field: string = "form",
  ) {
    super(message);
  }
}

/** The copy's file name, as the photo route takes it: "<uuid>.jpg". */
export const photoFile = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const BIO_FILE = /^[0-9a-f-]{36}\.jpg$/;

export function bioPhotoUrl(slug: string, path: string): string {
  return `/b/${slug}/photo/${photoFile(path)}`;
}

type BusinessRow = { id: string; userId: string; name: string; description: string | null; profile: unknown; knowledge: unknown; timezone: string; brandColors: string[]; logoUrl: string | null };
const BUSINESS_SELECT = { id: true, userId: true, name: true, description: true, profile: true, knowledge: true, timezone: true, brandColors: true, logoUrl: true } as const;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
const PRODUCT_SELECT = {
  id: true,
  name: true,
  summary: true,
  priceModel: true,
  priceAmount: true,
  currency: true,
  priceNote: true,
  photos: { where: { asset: { kind: "photo" } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 1, select: { asset: { select: { path: true } } } },
} satisfies Prisma.ProductSelect;

const firstPhoto = (p: ProductRow) => p.photos[0]?.asset.path ?? null;

function sourceFor(business: BusinessRow, products: ProductRow[], urls: { logo: string | null; photo: (p: ProductRow) => string | null }, now?: Date): BioSource {
  return bioSource({
    name: business.name,
    tagline: readProfile(business.profile).tagline,
    description: business.description,
    accent: resolveAccent(null, business.brandColors),
    knowledge: readKnowledge(business.knowledge),
    timezone: business.timezone,
    logoUrl: urls.logo,
    products: products.map((p) => ({ ...p, photoUrl: urls.photo(p) })),
    now,
  });
}

function settingsOf(page: { enabled: boolean; slug: string; tagline: string | null; whatsapp: string | null; message: string | null; phone: string | null; location: string | null; landmark: string | null; showHours: boolean; links: string[]; items: { productId: string }[] }): BioSettings {
  return {
    enabled: page.enabled,
    slug: page.slug,
    tagline: page.tagline ?? "",
    whatsapp: page.whatsapp,
    message: page.message ?? "",
    phone: page.phone,
    location: page.location,
    landmark: page.landmark ?? "",
    showHours: page.showHours,
    links: page.links.filter((l): l is BioLinkType => (BIO_LINK_TYPES as readonly string[]).includes(l)),
    productIds: page.items.map((i) => i.productId),
  };
}

// ---- the public page ----

/**
 * The page behind an address, ready to draw, or null: unknown, switched off, the owner suspended or deleting, or the
 * account read-only (demo pending, trial over, payment failed, plan ended: lib/entitlements.ts accountBlock). Nothing
 * says which, so an address never tells a stranger about the business behind it.
 */
export async function loadPublicBio(slug: string, now = new Date()) {
  if (slugProblem(slug)) return null;
  const page = await prisma.bioPage.findUnique({
    where: { slug },
    include: { business: { select: { ...BUSINESS_SELECT, user: { select: { suspendedAt: true, deletionScheduledFor: true } } } }, items: { orderBy: { position: "asc" }, include: { product: { select: { ...PRODUCT_SELECT, status: true } } } } },
  });
  if (!page || !(await isLive(page))) return null;
  const { business } = page;
  const items = page.items.filter((i) => i.product.status === "ACTIVE");
  const photos = new Map(items.map((i) => [i.productId, i.photoPath]));
  const source = sourceFor(business, items.map((i) => i.product), {
    logo: page.logoPath ? bioPhotoUrl(slug, page.logoPath) : null,
    photo: (p) => (photos.get(p.id) ? bioPhotoUrl(slug, photos.get(p.id)!) : null),
  }, now);
  const settings = settingsOf(page);
  // The link preview on WhatsApp: the logo, else the first product's photo.
  const ogPath = page.logoPath ?? items.find((i) => i.photoPath)?.photoPath ?? null;
  return { businessId: business.id, slug, source, settings, ogImage: ogPath ? bioPhotoUrl(slug, ogPath) : null };
}

/** Whether a page may be shown (the checks of loadPublicBio, without loading what it shows). */
async function isLive(page: { enabled: boolean; businessId: string; business: { user: { suspendedAt: Date | null; deletionScheduledFor: Date | null } } } | null): Promise<boolean> {
  if (!page?.enabled || page.business.user.suspendedAt || page.business.user.deletionScheduledFor) return false;
  return !(await companyEntitlements(page.businessId)).block;
}

const LIVE_SELECT = { enabled: true, businessId: true, business: { select: { user: { select: { suspendedAt: true, deletionScheduledFor: true } } } } } as const;

/** The company behind a live page, for counting its visits and taps; null when the page is not live. */
export async function liveBioBusinessId(slug: string): Promise<string | null> {
  if (slugProblem(slug)) return null;
  const page = await prisma.bioPage.findUnique({ where: { slug }, select: LIVE_SELECT });
  return (await isLive(page)) ? page!.businessId : null;
}

/** The storage path of one of a live page's copies, or null when the file is not on that page. */
export async function bioPhotoPath(slug: string, file: string): Promise<string | null> {
  if (slugProblem(slug) || !BIO_FILE.test(file)) return null;
  const page = await prisma.bioPage.findUnique({ where: { slug }, select: { ...LIVE_SELECT, logoPath: true, items: { select: { photoPath: true } } } });
  if (!page || !(await isLive(page))) return null;
  return [page.logoPath, ...page.items.map((i) => i.photoPath)].find((p) => p && photoFile(p) === file) ?? null;
}

export async function downloadBioPhoto(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(MEDIA).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export type BioHit = "view" | "wa" | "call";

/** One visit or tap on today's (UTC) row: one atomic upsert, so parallel taps all count. */
export async function countBioHit(businessId: string, hit: BioHit, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const [views, whatsapp, calls] = [Number(hit === "view"), Number(hit === "wa"), Number(hit === "call")];
  await prisma.$executeRaw`
    INSERT INTO "BioPageDay" ("businessId", "date", "views", "whatsapp", "calls") VALUES (${businessId}, ${day}::date, ${views}, ${whatsapp}, ${calls})
    ON CONFLICT ("businessId", "date") DO UPDATE SET
      "views" = "BioPageDay"."views" + EXCLUDED."views",
      "whatsapp" = "BioPageDay"."whatsapp" + EXCLUDED."whatsapp",
      "calls" = "BioPageDay"."calls" + EXCLUDED."calls"`;
}

// ---- the settings page ----

export type BioDay = { date: string; views: number; whatsapp: number; calls: number };

/** The last STATS_DAYS days, newest first, with a zero row for days nobody came. */
export function fillDays(rows: { date: Date; views: number; whatsapp: number; calls: number }[], now = new Date(), days = STATS_DAYS): BioDay[] {
  const byDay = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = byDay.get(date);
    return { date, views: r?.views ?? 0, whatsapp: r?.whatsapp ?? 0, calls: r?.calls ?? 0 };
  });
}

/** Everything the settings page needs: the saved settings (or a first suggestion), the data to pick from, the counts. */
export async function loadBioEditor(businessId: string, opts: { signedLogoUrl: string | null; signPhotos: (paths: string[]) => Promise<Map<string, string>> }) {
  const [business, page, products, rows] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: BUSINESS_SELECT }),
    prisma.bioPage.findUnique({ where: { businessId }, include: { items: { orderBy: { position: "asc" }, select: { productId: true } } } }),
    prisma.product.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: PRODUCT_PICKER_MAX, select: PRODUCT_SELECT }),
    prisma.bioPageDay.findMany({ where: { businessId, date: { gte: new Date(Date.now() - STATS_DAYS * 24 * 60 * 60 * 1000) } } }),
  ]);
  // The preview shows the gallery originals (signed for the owner only); the public page shows the copies.
  const urls = await opts.signPhotos(products.map(firstPhoto).filter((p): p is string => !!p)).catch(() => new Map<string, string>());
  const source = sourceFor(business, products, { logo: opts.signedLogoUrl, photo: (p) => urls.get(firstPhoto(p) ?? "") ?? null });
  const settings: BioSettings = page
    ? settingsOf(page)
    : {
        enabled: false,
        slug: await freeSlug(suggestSlug(business.name)),
        tagline: "",
        whatsapp: source.whatsappNumbers[0]?.value ?? null,
        message: "",
        phone: source.phoneNumbers[0]?.value ?? null,
        location: source.locations[0]?.address ?? null,
        landmark: "",
        showHours: true,
        links: source.links.map((l) => l.type),
        productIds: products.slice(0, 6).map((p) => p.id),
      };
  return { saved: !!page, settings, source, days: fillDays(rows) };
}

/** `base`, or `base-2`, `base-3`... the first one nobody has taken. */
async function freeSlug(base: string): Promise<string> {
  const taken = new Set((await prisma.bioPage.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((p) => p.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 26)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 21)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

/** A small JPEG copy of a stored image in the company's bio folder, or null when it cannot be made (logged). */
async function makeCopy(userId: string, bucket: "media" | "brand", source: string, size: { maxSide: number; square?: boolean; quality?: number }): Promise<string | null> {
  const storage = createAdminClient().storage;
  try {
    const { data, error } = await storage.from(bucket).download(source);
    if (error || !data) throw error ?? new Error("No file");
    const bytes = await smallJpeg(new Uint8Array(await data.arrayBuffer()), size);
    const path = `${userId}/bio/${globalThis.crypto.randomUUID()}.jpg`;
    const { error: upload } = await storage.from(MEDIA).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (upload) throw upload;
    return path;
  } catch (error) {
    await logError(error, { source: "bio.copy", level: "warn", userId, bucket, path: source });
    return null;
  }
}

/**
 * Saves the owner's settings. Only the company's own numbers, place and active products are accepted (the form only
 * offers those). Copies of new photos are made; copies nobody uses any more are removed. Returns the products whose
 * photo could not be copied: they show without a photo.
 */
export async function saveBioPage(ctx: { userId: string; businessId: string }, settings: BioSettings): Promise<{ missingPhotos: string[] }> {
  const block = (await companyEntitlements(ctx.businessId)).block;
  if (block) throw new BioError("Your account is read-only right now, so the page cannot be changed. Open Billing to see why.");
  const [business, current, products] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: BUSINESS_SELECT }),
    prisma.bioPage.findUnique({ where: { businessId: ctx.businessId }, include: { items: true } }),
    prisma.product.findMany({ where: { businessId: ctx.businessId, status: "ACTIVE", id: { in: settings.productIds } }, select: PRODUCT_SELECT }),
  ]);
  const source = sourceFor(business, products, { logo: null, photo: () => null });
  if (settings.whatsapp && !source.whatsappNumbers.some((n) => n.value === settings.whatsapp)) throw new BioError("Choose one of your WhatsApp numbers from Business info.", "whatsapp");
  if (settings.phone && !source.phoneNumbers.some((n) => n.value === settings.phone)) throw new BioError("Choose one of your phone numbers from Business info.", "phone");
  if (settings.location && !source.locations.some((l) => l.address === settings.location)) throw new BioError("Choose one of your locations from Business info.", "location");
  const byId = new Map(products.map((p) => [p.id, p]));
  const productIds = settings.productIds.filter((id) => byId.has(id));
  if (productIds.length < settings.productIds.length) throw new BioError("One of the products is no longer active in your Knowledge base. Remove it and save again.", "products");

  // Copies: the logo and each product's first photo, made again only when the original changed.
  const oldItems = new Map((current?.items ?? []).map((i) => [i.productId, i]));
  const logo = business.logoUrl && isOwnLogoPath(business.userId, business.logoUrl) ? business.logoUrl : null;
  let logoPath = current?.logoSource === logo ? (current?.logoPath ?? null) : null;
  if (logo && !logoPath) logoPath = await makeCopy(business.userId, "brand", logo, LOGO);
  const missingPhotos: string[] = [];
  const items: { productId: string; position: number; photoPath: string | null; photoSource: string | null }[] = [];
  for (const [position, id] of productIds.entries()) {
    const photo = firstPhoto(byId.get(id)!);
    const old = oldItems.get(id);
    let photoPath = old && old.photoSource === photo ? old.photoPath : null;
    if (photo && !photoPath) photoPath = await makeCopy(business.userId, "media", photo, PHOTO);
    if (photo && !photoPath) missingPhotos.push(byId.get(id)!.name);
    items.push({ productId: id, position, photoPath, photoSource: photoPath ? photo : null });
  }

  const data = {
    enabled: settings.enabled,
    slug: settings.slug,
    tagline: settings.tagline || null,
    whatsapp: settings.whatsapp,
    message: settings.message || null,
    phone: settings.phone,
    location: settings.location,
    landmark: settings.landmark || null,
    showHours: settings.showHours,
    links: settings.links,
    logoPath,
    logoSource: logoPath ? logo : null,
  };
  const made = [logoPath, ...items.map((i) => i.photoPath)].filter((p): p is string => !!p);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.bioPage.upsert({ where: { businessId: ctx.businessId }, create: { businessId: ctx.businessId, ...data }, update: data });
      await tx.bioPageItem.deleteMany({ where: { businessId: ctx.businessId, productId: { notIn: productIds } } });
      for (const item of items) {
        await tx.bioPageItem.upsert({ where: { businessId_productId: { businessId: ctx.businessId, productId: item.productId } }, create: { businessId: ctx.businessId, ...item }, update: item });
      }
    });
  } catch (error) {
    await removeCopies(made.filter((p) => p !== current?.logoPath && !current?.items.some((i) => i.photoPath === p)));
    if ((error as { code?: string }).code === "P2002") throw new BioError("Another business already uses that address. Try another one.", "slug");
    throw error;
  }
  const kept = new Set(made);
  await removeCopies([current?.logoPath, ...(current?.items ?? []).map((i) => i.photoPath)].filter((p): p is string => !!p && !kept.has(p)));
  return { missingPhotos };
}

/** Best effort: a copy left behind is removed by the daily storage sweep (lib/media/storage-sweep.ts). */
async function removeCopies(paths: string[]) {
  if (!paths.length) return;
  try {
    await createAdminClient().storage.from(MEDIA).remove(paths);
  } catch (error) {
    await logError(error, { source: "bio.remove", level: "warn" });
  }
}
