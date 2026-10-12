// Importing store products as Products (Knowledge base) and keeping them in step (re-sync).
//
// One ProductSync row maps a store product to one Product, so importing twice or re-syncing updates the same
// Product instead of duplicating it. Store photos become gallery photos (MediaAsset, source "store") in the
// product's album, in the store's order.
//
// OVERWRITE RULE: BuPulse never overwrites an edit silently. ProductSync.baseline holds each field as the last sync
// wrote it. On a re-sync a field (title, price, features, description, photos) is replaced with the store's value
// only while the Product still equals that baseline, meaning the user has not changed it. A field the user changed
// is kept and counted as "kept"; it stays protected until they delete the product or re-import it as new.
// The fields compared: title = Product.name, price = Product.priceNote (the store's price text; saving the product
// form turns it into an amount and clears the note, which counts as an edit), features, description, and photos =
// the album's paths in order.
import "server-only";
import { disabledServices } from "@/lib/admin/switch";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/entitlements";
import { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { extensionFor } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_PROJECT_PHOTOS } from "@/lib/studio/schemas";
import { MAX_PRODUCTS_PER_BUSINESS, parsePriceText, toMinor } from "@/lib/knowledge/products";
import { defaultCurrency } from "@/lib/knowledge/service";
import { cleanPhotoName, MEDIA_MAX_ASSETS, MEDIA_MAX_TOTAL_BYTES, platformMaxBytes, STORE_SOURCE } from "@/lib/media/rules";
import { mediaUsage, platformBytes } from "@/lib/media/service";
import { credentialsOf, markNeedsAttention, providerFor, type ConnectionRow } from "./connection";
import { fetchImage, isShopifyImageHost, type ImageResult } from "./safe-fetch";
import { StoreApiError, type NormalizedProduct, type StoreProviderId } from "./types";

export type Baseline = { title: string; price: string | null; features: string[]; notes: string | null; photoPaths: string[] };
export type ProjectFields = { title: string; price: string | null; features: string[]; notes: string | null; photoPaths: string[] };
export type FieldName = "title" | "price" | "features" | "description" | "photos";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function notesOf(details: unknown): string | null {
  if (details && typeof details === "object" && "notes" in details) {
    const notes = (details as { notes?: unknown }).notes;
    if (typeof notes === "string" && notes.trim()) return notes;
  }
  return null;
}

export function baselineOf(product: NormalizedProduct, photoPaths: string[]): Baseline {
  return { title: product.title, price: product.price, features: product.features, notes: product.description, photoPaths };
}

/**
 * Decides which fields a re-sync may change. Pure, so the rule is easy to test.
 * `photos` is decided separately because it needs downloads: this only says whether they may be replaced.
 */
export function planUpdate(project: ProjectFields, baseline: Baseline, incoming: NormalizedProduct) {
  const set: { title?: string; price?: string | null; features?: string[]; notes?: string | null } = {};
  const nextBaseline: Baseline = { ...baseline };
  const kept: FieldName[] = [];
  const changed: FieldName[] = [];

  const consider = <K extends "title" | "price" | "features">(key: K, name: FieldName, value: Baseline[K]) => {
    if (same(value, baseline[key])) return; // the store did not change it
    if (same(project[key], baseline[key])) {
      set[key] = value as never;
      nextBaseline[key] = value;
      changed.push(name);
    } else kept.push(name);
  };
  consider("title", "title", incoming.title);
  consider("price", "price", incoming.price);
  consider("features", "features", incoming.features);
  if (!same(incoming.description, baseline.notes)) {
    if (same(project.notes, baseline.notes)) {
      set.notes = incoming.description;
      nextBaseline.notes = incoming.description;
      changed.push("description");
    } else kept.push("description");
  }
  const photosEditable = same(project.photoPaths, baseline.photoPaths);
  return { set, nextBaseline, kept, changed, photosEditable };
}

// ---- Photos ----

export interface SyncDeps {
  fetchImage(url: string, provider: StoreProviderId): Promise<ImageResult>;
  /** Stores the image and returns its object path in the "media" bucket. */
  uploadPhoto(userId: string, image: Extract<ImageResult, { ok: true }>): Promise<string>;
  removePhotos(paths: string[]): Promise<void>;
}

export const defaultDeps: SyncDeps = {
  fetchImage(url, provider) {
    if (provider === "shopify") {
      const u = new URL(url);
      if (u.hostname === "cdn.shopify.com" && !u.searchParams.has("width")) u.searchParams.set("width", "2048"); // Shopify resizes on request
      return fetchImage(u.toString(), isShopifyImageHost);
    }
    return fetchImage(url);
  },
  async uploadPhoto(userId, image) {
    const path = `${userId}/projects/${crypto.randomUUID()}.${extensionFor(image.mimeType)}`;
    const { error } = await createAdminClient().storage.from("media").upload(path, image.bytes, { contentType: image.mimeType, upsert: false });
    if (error) throw error;
    return path;
  },
  async removePhotos(paths) {
    if (paths.length) await createAdminClient().storage.from("media").remove(paths).catch(() => {});
  },
};

export type ImageEntry = { url: string; path: string };

/**
 * ProductSync.imageMap is stored as an ordered array of { url, path }, because a JSON object comes back from a JSONB
 * column with its keys in a different order. Rows written by the first version were objects ({ url: path }); those are
 * read too, but their order is unknown, so they are compared as sets.
 */
export function readImageMap(value: unknown): { entries: ImageEntry[]; ordered: boolean } {
  if (Array.isArray(value)) {
    return { ordered: true, entries: value.flatMap((v) => (v && typeof v === "object" && typeof (v as ImageEntry).url === "string" && typeof (v as ImageEntry).path === "string" ? [{ url: (v as ImageEntry).url, path: (v as ImageEntry).path }] : [])) };
  }
  if (value && typeof value === "object") return { ordered: false, entries: Object.entries(value as Record<string, unknown>).flatMap(([url, path]) => (typeof path === "string" ? [{ url, path }] : [])) };
  return { ordered: true, entries: [] };
}

/** True when the stored images no longer match the store's current list (same set, and same order when the order is known). */
export function photosChanged(wantedUrls: string[], stored: { entries: ImageEntry[]; ordered: boolean }): boolean {
  const have = stored.entries.map((e) => e.url);
  if (stored.ordered) return !same(wantedUrls, have);
  return wantedUrls.length !== have.length || wantedUrls.some((u) => !have.includes(u));
}

/** Downloads the wanted images, reusing files already stored for the same source URL. */
/**
 * How many new store photos still fit: the company's gallery quota (store photos count, like uploads) and the shared
 * storage (MEDIA_PLATFORM_MAX_BYTES). Photos past it are skipped and reported, never half-stored; the next sync tries
 * them again (they stay missing from the image map).
 */
export type PhotoRoom = { count: number; bytes: number; skipped: number };

export async function galleryRoom(businessId: string): Promise<PhotoRoom> {
  const [usage, platform] = await Promise.all([mediaUsage(businessId), platformBytes()]);
  return { count: Math.max(0, MEDIA_MAX_ASSETS - usage.count), bytes: Math.max(0, Math.min(MEDIA_MAX_TOTAL_BYTES - usage.bytes, platformMaxBytes() - platform)), skipped: 0 };
}

async function resolvePhotos(userId: string, provider: StoreProviderId, urls: string[], known: Record<string, string>, deps: SyncDeps, room: PhotoRoom) {
  const wanted = urls.slice(0, MAX_PROJECT_PHOTOS);
  const results = await Promise.all(
    wanted.map(async (url) => {
      if (known[url]) return { url, path: known[url], fresh: false };
      // Reserve a place before downloading, so parallel downloads cannot all take the last one.
      if (room.count <= 0) {
        room.skipped++;
        return null;
      }
      room.count--;
      const image = await deps.fetchImage(url, provider);
      if (!image.ok) {
        room.count++;
        return null;
      }
      if (image.bytes.length > room.bytes) {
        room.count++;
        room.skipped++;
        return null;
      }
      room.bytes -= image.bytes.length;
      try {
        return { url, path: await deps.uploadPhoto(userId, image), fresh: true, bytes: image.bytes.length, mimeType: image.mimeType as string };
      } catch {
        return null;
      }
    }),
  );
  const ok = results.flatMap((r) => (r ? [r] : []));
  const freshRows = ok.flatMap((r) => ("bytes" in r && r.fresh ? [{ path: r.path, bytes: r.bytes ?? 0, mimeType: r.mimeType ?? "image/jpeg" }] : []));
  return { paths: ok.map((r) => r.path), entries: ok.map((r) => ({ url: r.url, path: r.path })), fresh: ok.filter((r) => r.fresh).map((r) => r.path), freshRows, failed: wanted.length - ok.length };
}

type FreshPhoto = { path: string; bytes: number; mimeType: string };

/**
 * Makes the product's album exactly `paths`, in order: gallery rows are created for fresh store photos, links that
 * are no longer wanted are removed, and a store photo nothing uses any more is deleted (its file is returned so the
 * caller removes it from Storage after the transaction). Photos the owner added themselves are never deleted, only
 * unlinked.
 */
async function setAlbum(tx: Prisma.TransactionClient, product: { id: string; businessId: string; name: string }, paths: string[], fresh: FreshPhoto[]): Promise<string[]> {
  for (const [i, f] of fresh.entries()) {
    await tx.mediaAsset.upsert({
      where: { path: f.path },
      create: { id: crypto.randomUUID(), businessId: product.businessId, path: f.path, name: cleanPhotoName(`${product.name} ${i + 1}`), mimeType: f.mimeType, bytes: f.bytes, source: STORE_SOURCE },
      update: {},
    });
  }
  const assets = paths.length ? await tx.mediaAsset.findMany({ where: { businessId: product.businessId, path: { in: paths } }, select: { id: true, path: true } }) : [];
  const idOf = new Map(assets.map((a) => [a.path, a.id]));
  const wanted = paths.flatMap((p) => (idOf.has(p) ? [idOf.get(p)!] : []));
  const before = await tx.productPhoto.findMany({ where: { productId: product.id }, select: { assetId: true, asset: { select: { path: true, source: true, folderId: true } } } });
  const dropped = before.filter((b) => !wanted.includes(b.assetId));
  if (dropped.length) await tx.productPhoto.deleteMany({ where: { productId: product.id, assetId: { in: dropped.map((d) => d.assetId) } } });
  for (const [position, assetId] of wanted.entries()) {
    await tx.productPhoto.upsert({ where: { productId_assetId: { productId: product.id, assetId } }, create: { productId: product.id, assetId, position }, update: { position } });
  }
  const orphans: string[] = [];
  for (const d of dropped) {
    // Only a store photo nobody else uses goes: not one the owner filed in a folder, put in another album, or used in
    // a post (Post.mediaPaths) or an Autopilot design (Design.prompt "photo:<path>").
    if (d.asset.source !== STORE_SOURCE || d.asset.folderId) continue;
    const still =
      (await tx.productPhoto.count({ where: { assetId: d.assetId } })) +
      (await tx.campaignPhoto.count({ where: { assetId: d.assetId } })) +
      (await tx.post.count({ where: { businessId: product.businessId, mediaPaths: { has: d.asset.path } } })) +
      (await tx.design.count({ where: { businessId: product.businessId, prompt: `photo:${d.asset.path}` } }));
    if (still === 0) {
      await tx.mediaAsset.deleteMany({ where: { id: d.assetId } });
      orphans.push(d.asset.path);
    }
  }
  return orphans;
}

/** The structured price of a store price text, or "on request" with the text kept as the note. */
function priceFields(price: string | null, currency: string) {
  const parsed = parsePriceText(price, currency);
  const amount = parsed ? toMinor(parsed.price, parsed.currency) : null;
  return parsed && amount !== null
    ? { priceModel: parsed.priceModel, priceAmount: amount, currency: parsed.currency, priceNote: price }
    : { priceModel: "ON_REQUEST" as const, priceAmount: null, currency, priceNote: price };
}

const summaryOf = (description: string | null, title: string) => (description ?? title).replace(/\s+/g, " ").trim().slice(0, 300) || title;

// ---- Import and re-sync ----

export type ProductResult = {
  externalId: string;
  title: string;
  status: "created" | "updated" | "unchanged" | "missing" | "failed";
  /** Fields that were not overwritten because the user edited them. */
  kept?: FieldName[];
  /** Store photos not imported because the gallery (or BuPulse's shared storage) is full. */
  skippedPhotos?: number;
  error?: string;
};

type Context = { conn: ConnectionRow; userId: string; deps: SyncDeps };

class ProductCapError extends Error {}

async function createFromProduct(ctx: Context, product: NormalizedProduct): Promise<ProductResult | "exists"> {
  const { conn, userId, deps } = ctx;
  const capReached: ProductResult = { externalId: product.externalId, title: product.title, status: "failed", error: `You have reached the limit of ${MAX_PRODUCTS_PER_BUSINESS} products.` };
  // Cheap early exit before any photo is downloaded; the authoritative check is inside the transaction below.
  if ((await prisma.product.count({ where: { businessId: conn.businessId } })) >= MAX_PRODUCTS_PER_BUSINESS) return capReached;
  const room = await galleryRoom(conn.businessId);
  const photos = await resolvePhotos(userId, conn.provider as StoreProviderId, product.imageUrls, {}, deps, room);
  const currency = await defaultCurrency(conn.businessId);
  try {
    // The count and the create run in one transaction under a per-business advisory lock, so parallel imports cannot
    // all pass the check and go past the cap.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`products:${conn.businessId}`}))`;
      if ((await tx.product.count({ where: { businessId: conn.businessId } })) >= MAX_PRODUCTS_PER_BUSINESS) throw new ProductCapError();
      const row = await tx.product.create({
        data: {
          businessId: conn.businessId,
          kind: "PHYSICAL",
          name: product.title.slice(0, 200),
          summary: summaryOf(product.description, product.title),
          description: product.description,
          ...priceFields(product.price, currency),
          features: product.features,
          usps: [],
          storeSync: {
            create: { connectionId: conn.id, externalId: product.externalId, baseline: baselineOf(product, photos.paths), imageMap: photos.entries },
          },
        },
        select: { id: true, businessId: true, name: true },
      });
      await setAlbum(tx, row, photos.paths, photos.freshRows);
    });
    return { externalId: product.externalId, title: product.title, status: "created", ...(room.skipped ? { skippedPhotos: room.skipped } : {}) };
  } catch (error) {
    await deps.removePhotos(photos.fresh);
    if (error instanceof ProductCapError) return capReached;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists"; // imported by a parallel request
    throw error;
  }
}

async function albumOf(productId: string): Promise<string[]> {
  const rows = await prisma.productPhoto.findMany({ where: { productId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { asset: { select: { path: true } } } });
  return rows.map((r) => r.asset.path);
}

async function updateFromProduct(ctx: Context, incoming: NormalizedProduct): Promise<ProductResult> {
  const { conn, userId, deps } = ctx;
  const mapping = await prisma.productSync.findUnique({ where: { connectionId_externalId: { connectionId: conn.id, externalId: incoming.externalId } }, include: { product: true } });
  if (!mapping?.product) return { externalId: incoming.externalId, title: incoming.title, status: "failed", error: "Not found." };
  const product = mapping.product;
  const baseline = mapping.baseline as Baseline;
  const album = await albumOf(product.id);
  const plan = planUpdate({ title: product.name, price: product.priceNote, features: product.features, notes: product.description, photoPaths: album }, baseline, incoming);

  let photoPaths = album;
  const stored = readImageMap(mapping.imageMap);
  const known = Object.fromEntries(stored.entries.map((e) => [e.url, e.path]));
  let imageMap: ImageEntry[] = stored.entries;
  let fresh: string[] = [];
  let freshRows: FreshPhoto[] = [];
  const wantedUrls = incoming.imageUrls.slice(0, MAX_PROJECT_PHOTOS);
  const photosDiffer = photosChanged(wantedUrls, stored);
  let room: PhotoRoom | null = null;
  if (photosDiffer) {
    if (plan.photosEditable) {
      room = await galleryRoom(conn.businessId);
      const resolved = await resolvePhotos(userId, conn.provider as StoreProviderId, incoming.imageUrls, known, deps, room);
      // If every download failed keep what we have rather than emptying the album.
      if (resolved.paths.length > 0 || wantedUrls.length === 0) {
        fresh = resolved.fresh;
        freshRows = resolved.freshRows;
        photoPaths = resolved.paths;
        imageMap = resolved.entries;
        plan.nextBaseline.photoPaths = photoPaths;
        plan.changed.push("photos");
      }
    } else plan.kept.push("photos");
  }

  const data: Prisma.ProductUpdateInput = {};
  if (plan.set.title !== undefined) data.name = plan.set.title.slice(0, 200);
  if (plan.set.price !== undefined) Object.assign(data, priceFields(plan.set.price, product.currency));
  if (plan.set.features !== undefined) data.features = plan.set.features;
  if (plan.set.notes !== undefined) {
    data.description = plan.set.notes;
    // The summary follows the description while it is still the one the import wrote.
    if (product.summary === summaryOf(product.description, product.name)) data.summary = summaryOf(plan.set.notes, plan.set.title ?? product.name);
  }

  let removed: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // Only while the product is unchanged since we read it: a save in between wins (P2025 below).
      if (Object.keys(data).length) await tx.product.update({ where: { id: product.id, updatedAt: product.updatedAt }, data });
      else if (plan.changed.includes("photos")) await tx.product.update({ where: { id: product.id, updatedAt: product.updatedAt }, data: { updatedAt: new Date() } });
      if (plan.changed.includes("photos")) removed = await setAlbum(tx, { id: product.id, businessId: product.businessId, name: product.name }, photoPaths, freshRows);
      await tx.productSync.update({ where: { id: mapping.id }, data: { baseline: plan.nextBaseline, imageMap, lastSyncedAt: new Date(), sourceMissing: false } });
    });
  } catch (error) {
    await deps.removePhotos(fresh);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      // The user saved an edit between our read and our write (the product's updatedAt moved): their edit wins, nothing
      // is overwritten, and the next sync decides again from the fresh product.
      await prisma.productSync.update({ where: { id: mapping.id }, data: { lastSyncedAt: new Date() } });
      return { externalId: incoming.externalId, title: product.name, status: "unchanged", kept: [...new Set([...plan.kept, ...plan.changed])] };
    }
    throw error;
  }
  await deps.removePhotos(removed);
  return {
    externalId: incoming.externalId,
    title: product.name,
    status: plan.changed.length ? "updated" : "unchanged",
    kept: plan.kept.length ? plan.kept : undefined,
    ...(room?.skipped ? { skippedPhotos: room.skipped } : {}),
  };
}

async function contextFor(conn: ConnectionRow, deps: SyncDeps): Promise<Context> {
  const business = await prisma.business.findUnique({ where: { id: conn.businessId }, select: { userId: true } });
  if (!business) throw new Error("Business not found");
  return { conn, userId: business.userId, deps };
}

/** Maps a thrown error to the per-product result, flagging the connection when the keys stopped working. */
async function failure(conn: ConnectionRow, error: unknown, externalId: string, title: string): Promise<ProductResult> {
  if (error instanceof StoreApiError && error.authFailed) await markNeedsAttention(conn.id, "The store no longer accepts BuPulse's access. Reconnect it.");
  else await logError(error, { source: `stores.${conn.provider}.sync`, businessId: conn.businessId, externalId });
  const message = error instanceof StoreApiError ? (error.authFailed ? "The store no longer accepts BuPulse's access. Reconnect it." : error.message) : "We could not import this product.";
  return { externalId, title, status: "failed", error: message };
}

/**
 * Imports the chosen products (new ones are created, ones already imported are re-synced). Products are fetched
 * fresh from the store by id, so the browser only ever sends ids, never product data.
 */
export async function importProducts(conn: ConnectionRow, ids: string[], deps: SyncDeps = defaultDeps): Promise<ProductResult[]> {
  const unique = [...new Set(ids)].slice(0, 50);
  if (!unique.length) return [];
  const ctx = await contextFor(conn, deps);
  let found: Map<string, NormalizedProduct>;
  try {
    found = await providerFor(conn.provider as StoreProviderId).getProducts(await credentialsOf(conn), unique);
  } catch (error) {
    return Promise.all(unique.map((id) => failure(conn, error, id, "Product")));
  }
  const results: ProductResult[] = [];
  for (const id of unique) {
    const product = found.get(id);
    if (!product) {
      results.push({ externalId: id, title: "Product", status: "missing", error: "This product is no longer in your store." });
      continue;
    }
    try {
      const existing = await prisma.productSync.findUnique({ where: { connectionId_externalId: { connectionId: conn.id, externalId: id } }, select: { id: true } });
      let result: ProductResult | "exists" = existing ? await updateFromProduct(ctx, product) : await createFromProduct(ctx, product);
      if (result === "exists") result = await updateFromProduct(ctx, product);
      results.push(result);
    } catch (error) {
      results.push(await failure(conn, error, id, product.title));
    }
  }
  await prisma.storeConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date(), ...(results.some((r) => r.status !== "failed") ? { lastSyncError: null } : {}) } }).catch(() => {});
  return results;
}

/** Cloudflare Workers allow a limited number of subrequests (fetches, Storage calls) per invocation; stay well under. */
export const SUBREQUEST_BUDGET = 800;
export type SubrequestBudget = { used: number; max: number };
export const newBudget = (max = SUBREQUEST_BUDGET): SubrequestBudget => ({ used: 0, max });

/** The same deps, counting every download, upload and removal against the budget. */
function counted(deps: SyncDeps, budget: SubrequestBudget): SyncDeps {
  return {
    fetchImage: (url, provider) => (budget.used++, deps.fetchImage(url, provider)),
    uploadPhoto: (userId, image) => (budget.used++, deps.uploadPhoto(userId, image)),
    removePhotos: (paths) => (paths.length ? (budget.used++, deps.removePhotos(paths)) : Promise.resolve()),
  };
}

export type ResyncSummary = { checked: number; updated: number; unchanged: number; kept: number; missing: number; failed: number; /** Store photos not imported because the gallery is full. */ skippedPhotos: number; /** Products not yet visited in this pass. */ remaining: number; /** True when the pass has nothing left to do (or cannot make progress), so the caller can stop calling. */ done: boolean };

const RESYNC_TAKE = 40;

/**
 * Re-syncs products that were already imported (never adds new ones), one bounded slice per call.
 *
 * A "pass" is every mapped product whose lastSyncedAt is older than `since` (the pass's start time). Each call takes the
 * stalest ones, stops early when the subrequest budget would be exceeded, and stamps what it visited, so calling again
 * with the same `since` continues where it stopped, until `done`. "Sync now" loops over client calls; the daily cron loops
 * inside its own budget.
 */
export async function resyncConnection(conn: ConnectionRow, opts: { limit?: number; since?: Date; budget?: SubrequestBudget } = {}, baseDeps: SyncDeps = defaultDeps): Promise<ResyncSummary> {
  const since = opts.since ?? new Date();
  const budget = opts.budget ?? newBudget();
  const deps = counted(baseDeps, budget);
  const summary: ResyncSummary = { checked: 0, updated: 0, unchanged: 0, kept: 0, missing: 0, failed: 0, skippedPhotos: 0, remaining: 0, done: false };
  const stale = { connectionId: conn.id, lastSyncedAt: { lt: since } };
  const mappings = await prisma.productSync.findMany({ where: stale, orderBy: { lastSyncedAt: "asc" }, take: opts.limit ?? RESYNC_TAKE, select: { externalId: true, imageMap: true } });
  if (!mappings.length) return { ...summary, done: true };
  const ctx = await contextFor(conn, deps);
  let found: Map<string, NormalizedProduct>;
  try {
    budget.used += Math.ceil(mappings.length / 50);
    found = await providerFor(conn.provider as StoreProviderId).getProducts(await credentialsOf(conn), mappings.map((m) => m.externalId));
  } catch (error) {
    await failure(conn, error, "-", "Store");
    return { ...summary, checked: mappings.length, failed: mappings.length, remaining: mappings.length, done: true };
  }
  for (const { externalId, imageMap } of mappings) {
    const product = found.get(externalId);
    // Worst case for this product: a download and an upload per new image, and one removal.
    const known = new Set(readImageMap(imageMap).entries.map((e) => e.url));
    const fresh = product ? product.imageUrls.slice(0, MAX_PROJECT_PHOTOS).filter((u) => !known.has(u)).length : 0;
    const estimate = 1 + (fresh > 0 ? 2 * fresh + 1 : 0);
    if (summary.checked > 0 && budget.used + estimate > budget.max) break;
    summary.checked++;
    if (!product) {
      summary.missing++;
      await prisma.productSync.updateMany({ where: { connectionId: conn.id, externalId }, data: { sourceMissing: true, lastSyncedAt: new Date() } });
      continue;
    }
    try {
      const r = await updateFromProduct(ctx, product);
      if (r.status === "updated") summary.updated++;
      else summary.unchanged++;
      summary.skippedPhotos += r.skippedPhotos ?? 0;
      if (r.kept?.length) summary.kept++;
    } catch (error) {
      summary.failed++;
      await failure(conn, error, externalId, product.title);
      // Stamp it so the pass moves on instead of retrying the same product forever.
      await prisma.productSync.updateMany({ where: { connectionId: conn.id, externalId }, data: { lastSyncedAt: new Date() } });
    }
  }
  summary.remaining = await prisma.productSync.count({ where: stale });
  summary.done = summary.remaining === 0 || summary.failed === summary.checked;
  await prisma.storeConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date(), lastSyncError: summary.failed && summary.failed === summary.checked ? "The last sync did not finish." : null } }).catch(() => {});
  return summary;
}

const CRON_BATCH = 5;

/**
 * One page of the daily sync. Stores are taken stalest first (never tried before, then oldest attempt), and each is
 * stamped with the attempt time before its work starts, so every store gets its turn however many there are and a store
 * that keeps failing cannot hold up the others. `cursor` is the run's start time: only stores not yet tried since then
 * are left. Call again with `nextCursor` until it is null (the cursor-call pattern of /api/cron/autopilot).
 */
export async function runDailyStoreSync(opts: { cursor?: string | null; now?: Date; resync?: typeof resyncConnection; budget?: SubrequestBudget } = {}) {
  const resync = opts.resync ?? resyncConnection;
  const budget = opts.budget ?? newBudget();
  const parsed = opts.cursor ? new Date(opts.cursor) : null;
  const runStart = parsed && !Number.isNaN(parsed.getTime()) ? parsed : (opts.now ?? new Date());
  // Providers switched off in the admin console are skipped (their stores keep their data and are not marked failed).
  const off = await disabledServices();
  const pausedProviders = (["shopify", "woocommerce"] as const).filter((p) => off.has(p));
  const due = { status: "ACTIVE", products: { some: {} }, ...(pausedProviders.length ? { provider: { notIn: [...pausedProviders] } } : {}), OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: runStart } }] };
  const batch = await prisma.storeConnection.findMany({ where: due, orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: CRON_BATCH });
  let updated = 0;
  let failed = 0;
  let processed = 0;
  for (const conn of batch) {
    if (budget.used >= budget.max) break;
    processed++;
    let finished = false;
    // Store import is a plan feature: a store of a company without it is stamped and left as it is (not failed).
    // While the plan cannot be checked (plan_unknown) nothing is written, so the store is simply due again next time.
    const storeImport = await featureStatus(conn.businessId, "storeImport");
    if (storeImport !== "ok") {
      if (storeImport !== "plan_unknown") await prisma.storeConnection.updateMany({ where: { id: conn.id }, data: { lastAttemptAt: new Date() } });
      continue;
    }
    try {
      // Keep going through this store's slices while the call's subrequest budget lasts; a store that does not finish
      // stays due (it is only stamped when done) and the next call continues with it.
      for (let i = 0; i < 50 && !finished && budget.used < budget.max; i++) {
        const s = await resync(conn, { since: runStart, budget });
        updated += s.updated;
        failed += s.failed;
        finished = s.done;
      }
    } catch (error) {
      failed++;
      finished = true; // a store that throws is not retried within this run
      await logError(error, { source: "cron.store-sync", businessId: conn.businessId });
    }
    if (finished) await prisma.storeConnection.updateMany({ where: { id: conn.id }, data: { lastAttemptAt: new Date() } });
  }
  const more = (await prisma.storeConnection.count({ where: due })) > 0;
  return { connections: processed, updated, failed, nextCursor: more ? runStart.toISOString() : null };
}
