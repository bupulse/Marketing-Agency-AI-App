// Importing store products as Projects and keeping them in step (re-sync).
//
// One ProductSync row maps a store product to one Project, so importing twice or re-syncing updates the same
// Project instead of duplicating it.
//
// OVERWRITE RULE: BuPulse never overwrites an edit silently. ProductSync.baseline holds each field as the last sync
// wrote it. On a re-sync a field (title, price, features, description, photos) is replaced with the store's value
// only while the Project still equals that baseline, meaning the user has not changed it. A field the user changed
// is kept and counted as "kept"; it stays protected until they delete the project or re-import it as new.
import "server-only";
import { disabledServices } from "@/lib/admin/switch";
import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/entitlements";
import { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { extensionFor } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_PROJECT_PHOTOS, MAX_PROJECTS_PER_BUSINESS } from "@/lib/studio/schemas";
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
async function resolvePhotos(userId: string, provider: StoreProviderId, urls: string[], known: Record<string, string>, deps: SyncDeps) {
  const wanted = urls.slice(0, MAX_PROJECT_PHOTOS);
  const results = await Promise.all(
    wanted.map(async (url) => {
      if (known[url]) return { url, path: known[url], fresh: false };
      const image = await deps.fetchImage(url, provider);
      if (!image.ok) return null;
      try {
        return { url, path: await deps.uploadPhoto(userId, image), fresh: true };
      } catch {
        return null;
      }
    }),
  );
  const ok = results.flatMap((r) => (r ? [r] : []));
  return { paths: ok.map((r) => r.path), entries: ok.map((r) => ({ url: r.url, path: r.path })), fresh: ok.filter((r) => r.fresh).map((r) => r.path), failed: wanted.length - ok.length };
}

// ---- Import and re-sync ----

export type ProductResult = {
  externalId: string;
  title: string;
  status: "created" | "updated" | "unchanged" | "missing" | "failed";
  /** Fields that were not overwritten because the user edited them. */
  kept?: FieldName[];
  error?: string;
};

type Context = { conn: ConnectionRow; userId: string; deps: SyncDeps };

function detailsWith(existing: unknown, notes: string | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  if (notes) base.notes = notes;
  else delete base.notes;
  return Object.keys(base).length ? (base as Prisma.InputJsonObject) : Prisma.DbNull;
}

class ProjectCapError extends Error {}

async function createFromProduct(ctx: Context, product: NormalizedProduct): Promise<ProductResult | "exists"> {
  const { conn, userId, deps } = ctx;
  const capReached: ProductResult = { externalId: product.externalId, title: product.title, status: "failed", error: `You have reached the limit of ${MAX_PROJECTS_PER_BUSINESS} projects.` };
  // Cheap early exit before any photo is downloaded; the authoritative check is inside the transaction below.
  if ((await prisma.project.count({ where: { businessId: conn.businessId } })) >= MAX_PROJECTS_PER_BUSINESS) return capReached;
  const photos = await resolvePhotos(userId, conn.provider as StoreProviderId, product.imageUrls, {}, deps);
  try {
    // The count and the create run in one transaction under a per-business advisory lock, so parallel imports cannot
    // all pass the check and go past the cap.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`projects:${conn.businessId}`}))`;
      if ((await tx.project.count({ where: { businessId: conn.businessId } })) >= MAX_PROJECTS_PER_BUSINESS) throw new ProjectCapError();
      await tx.project.create({
      data: {
        businessId: conn.businessId,
        type: "product",
        title: product.title,
        price: product.price,
        features: product.features,
        details: product.description ? { notes: product.description } : undefined,
        photoPaths: photos.paths,
        storeSync: {
          create: { connectionId: conn.id, externalId: product.externalId, baseline: baselineOf(product, photos.paths), imageMap: photos.entries },
        },
      },
      });
    });
    return { externalId: product.externalId, title: product.title, status: "created" };
  } catch (error) {
    await deps.removePhotos(photos.fresh);
    if (error instanceof ProjectCapError) return capReached;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "exists"; // imported by a parallel request
    throw error;
  }
}

async function updateFromProduct(ctx: Context, product: NormalizedProduct): Promise<ProductResult> {
  const { conn, userId, deps } = ctx;
  const mapping = await prisma.productSync.findUnique({ where: { connectionId_externalId: { connectionId: conn.id, externalId: product.externalId } }, include: { project: true } });
  if (!mapping) return { externalId: product.externalId, title: product.title, status: "failed", error: "Not found." };
  const project = mapping.project;
  const baseline = mapping.baseline as Baseline;
  const plan = planUpdate({ title: project.title, price: project.price, features: project.features, notes: notesOf(project.details), photoPaths: project.photoPaths }, baseline, product);

  let photoPaths = project.photoPaths;
  const stored = readImageMap(mapping.imageMap);
  const known = Object.fromEntries(stored.entries.map((e) => [e.url, e.path]));
  let imageMap: ImageEntry[] = stored.entries;
  let removed: string[] = [];
  let fresh: string[] = [];
  const wantedUrls = product.imageUrls.slice(0, MAX_PROJECT_PHOTOS);
  const photosDiffer = photosChanged(wantedUrls, stored);
  if (photosDiffer) {
    if (plan.photosEditable) {
      const resolved = await resolvePhotos(userId, conn.provider as StoreProviderId, product.imageUrls, known, deps);
      // If every download failed keep what we have rather than emptying the project.
      if (resolved.paths.length > 0 || wantedUrls.length === 0) {
        removed = project.photoPaths.filter((p) => !resolved.paths.includes(p));
        fresh = resolved.fresh;
        photoPaths = resolved.paths;
        imageMap = resolved.entries;
        plan.nextBaseline.photoPaths = photoPaths;
        plan.changed.push("photos");
      }
    } else plan.kept.push("photos");
  }

  const projectData: Prisma.ProjectUpdateInput = {};
  if (plan.set.title !== undefined) projectData.title = plan.set.title;
  if (plan.set.price !== undefined) projectData.price = plan.set.price;
  if (plan.set.features !== undefined) projectData.features = plan.set.features;
  if (plan.set.notes !== undefined) projectData.details = detailsWith(project.details, plan.set.notes);
  if (plan.changed.includes("photos")) projectData.photoPaths = photoPaths;

  try {
    await prisma.$transaction([
      ...(Object.keys(projectData).length ? [prisma.project.update({ where: { id: project.id, updatedAt: project.updatedAt }, data: projectData })] : []),
      prisma.productSync.update({ where: { id: mapping.id }, data: { baseline: plan.nextBaseline, imageMap, lastSyncedAt: new Date(), sourceMissing: false } }),
    ]);
  } catch (error) {
    await deps.removePhotos(fresh);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      // The user saved an edit between our read and our write (the project's updatedAt moved): their edit wins, nothing
      // is overwritten, and the next sync decides again from the fresh project.
      await prisma.productSync.update({ where: { id: mapping.id }, data: { lastSyncedAt: new Date() } });
      return { externalId: product.externalId, title: project.title, status: "unchanged", kept: [...new Set([...plan.kept, ...plan.changed])] };
    }
    throw error;
  }
  await deps.removePhotos(removed);
  return {
    externalId: product.externalId,
    title: project.title,
    status: plan.changed.length ? "updated" : "unchanged",
    kept: plan.kept.length ? plan.kept : undefined,
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

export type ResyncSummary = { checked: number; updated: number; unchanged: number; kept: number; missing: number; failed: number; /** Products not yet visited in this pass. */ remaining: number; /** True when the pass has nothing left to do (or cannot make progress), so the caller can stop calling. */ done: boolean };

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
  const summary: ResyncSummary = { checked: 0, updated: 0, unchanged: 0, kept: 0, missing: 0, failed: 0, remaining: 0, done: false };
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
    if (!(await hasFeature(conn.businessId, "storeImport"))) {
      await prisma.storeConnection.updateMany({ where: { id: conn.id }, data: { lastAttemptAt: new Date() } });
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
