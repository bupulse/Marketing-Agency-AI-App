"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { isServiceEnabled, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { featureBlocked, upgradeHref } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, RateLimitError, rateLimitMessage } from "@/lib/rate-limit";
import { cancelPending, confirmPending, credentialsOf, getConnection, providerFor, removeConnection, saveConnection } from "@/lib/stores/connection";
import { importProducts, resyncConnection, type ProductResult, type ResyncSummary } from "@/lib/stores/sync";
import { IMPORT_CHUNK, isStoreProvider, StoreApiError, type StoreProviderId } from "@/lib/stores/types";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { buildWooAuthorizeUrl, CONSUMER_KEY_RE, CONSUMER_SECRET_RE, normalizeStoreUrl, packKeys, sealWooState, verifyWooKeys } from "@/lib/stores/woocommerce";
import { linkSiteUrl } from "@/lib/auth/request-site";

export type ListedProduct = { externalId: string; title: string; price: string | null; thumb: string | null; imported: boolean };
export type ListResult = { ok: true; products: ListedProduct[]; nextCursor: string | null } | { ok: false; error: string };
export type ImportResult = { ok: true; results: ProductResult[] } | { ok: false; error: string };
export type SyncResult = { ok: true; summary: ResyncSummary; since: string } | { ok: false; error: string };

const NOT_CONNECTED = "Connect your store first.";

async function connectionFor(provider: string) {
  const user = await requireActiveUser("connectors");
  if (!isStoreProvider(provider)) return null;
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return null;
  const conn = await getConnection(business.id, provider);
  return conn ? { user, conn, businessId: business.id } : null;
}

/**
 * Store import missing from the plan, or Shopify / WooCommerce switched off in the admin console: stop with a friendly
 * message; stored products stay.
 */
async function paused(provider: string, businessId: string): Promise<string | null> {
  const missing = await featureBlocked(businessId, "storeImport");
  if (missing) return missing;
  return (provider === "shopify" || provider === "woocommerce") && !(await isServiceEnabled(provider)) ? UNAVAILABLE_MESSAGE : null;
}

async function limited(userId: string): Promise<string | null> {
  try {
    await rateLimit(`store-import:${userId}`, RATE_LIMITS.storeImport);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitMessage(error);
    throw error;
  }
}

function friendly(error: unknown) {
  if (error instanceof StoreApiError) return error.authFailed ? "The store no longer accepts BuPulse's access. Reconnect it." : error.message;
  return "We could not reach your store. Please try again.";
}

/** One page of the store's products with their images, for the picker. */
export async function listProductsAction(provider: string, opts: { cursor?: string | null; search?: string }): Promise<ListResult> {
  const found = await connectionFor(provider);
  if (!found) return { ok: false, error: NOT_CONNECTED };
  const off = await paused(found.conn.provider, found.businessId);
  if (off) return { ok: false, error: off };
  const tooMany = await limited(found.user.id);
  if (tooMany) return { ok: false, error: tooMany };
  try {
    const page = await providerFor(found.conn.provider as StoreProviderId).listProducts(await credentialsOf(found.conn), {
      cursor: typeof opts.cursor === "string" && opts.cursor.length <= 500 ? opts.cursor : null,
      search: typeof opts.search === "string" ? opts.search.slice(0, 80) : undefined,
      take: 25,
    });
    const mapped = await prisma.productSync.findMany({ where: { connectionId: found.conn.id, externalId: { in: page.products.map((p) => p.externalId) } }, select: { externalId: true } });
    const done = new Set(mapped.map((m) => m.externalId));
    return {
      ok: true,
      nextCursor: page.nextCursor,
      products: page.products.map((p) => ({ externalId: p.externalId, title: p.title, price: p.price, thumb: p.imageUrls[0] ?? null, imported: done.has(p.externalId) })),
    };
  } catch (error) {
    if (!(error instanceof StoreApiError)) await logError(error, { source: "stores.list", userId: found.user.id });
    if (error instanceof StoreApiError && error.authFailed) await prisma.storeConnection.update({ where: { id: found.conn.id }, data: { status: "NEEDS_ATTENTION" } });
    return { ok: false, error: friendly(error) };
  }
}

/** Imports (or re-syncs) a few products. The screen calls this in chunks to show progress. */
export async function importChunkAction(provider: string, ids: string[]): Promise<ImportResult> {
  const found = await connectionFor(provider);
  if (!found) return { ok: false, error: NOT_CONNECTED };
  const off = await paused(found.conn.provider, found.businessId);
  if (off) return { ok: false, error: off };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > IMPORT_CHUNK || ids.some((id) => typeof id !== "string" || id.length > 100)) return { ok: false, error: "Choose some products first." };
  const tooMany = await limited(found.user.id);
  if (tooMany) return { ok: false, error: tooMany };
  try {
    const results = await importProducts(found.conn, ids);
    revalidatePath("/dashboard/knowledge/products");
    revalidatePath(`/dashboard/stores/${provider}`);
    return { ok: true, results };
  } catch (error) {
    await logError(error, { source: "stores.import", userId: found.user.id });
    return { ok: false, error: friendly(error) };
  }
}

/**
 * "Sync now": one slice per call (a Workers invocation may only make so many subrequests). The screen calls again with
 * the returned `since` until `done`, the same way the import shows progress. Your own edits are kept.
 */
export async function resyncAction(provider: string, since?: string): Promise<SyncResult> {
  const found = await connectionFor(provider);
  if (!found) return { ok: false, error: NOT_CONNECTED };
  const off = await paused(found.conn.provider, found.businessId);
  if (off) return { ok: false, error: off };
  const tooMany = await limited(found.user.id);
  if (tooMany) return { ok: false, error: tooMany };
  const parsed = since ? new Date(since) : new Date();
  const passStart = Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 1000 ? new Date() : parsed;
  try {
    const summary = await resyncConnection(found.conn, { since: passStart });
    revalidatePath("/dashboard/knowledge/products");
    revalidatePath(`/dashboard/stores/${provider}`);
    return { ok: true, summary, since: passStart.toISOString() };
  } catch (error) {
    await logError(error, { source: "stores.resync", userId: found.user.id });
    return { ok: false, error: friendly(error) };
  }
}

/** Forgets the store's keys and product mappings (imported products stay). The screen then reloads the page. */
export async function disconnectStoreAction(provider: string): Promise<{ ok: boolean }> {
  const user = await requireActiveUser("connectors");
  if (!isStoreProvider(provider)) return { ok: false };
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (business) await removeConnection(business.id, provider);
  revalidatePath("/dashboard/knowledge/products");
  revalidatePath(`/dashboard/stores/${provider}`);
  return { ok: true };
}

/** `values` hands back what was typed (never the secret), because React clears the form after each submit. */
export type ManualState = { error?: string; values?: { store: string; key: string } };

/** WooCommerce fallback for stores where the one-click key page is blocked: paste the REST API keys by hand. */
export async function connectWooManualAction(_prev: ManualState, formData: FormData): Promise<ManualState> {
  const user = await requireActiveUser("connectors");
  if (!(await isServiceEnabled("woocommerce"))) return { error: UNAVAILABLE_MESSAGE };
  const typedStore = String(formData.get("store") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const values = { store: typedStore.slice(0, 300), key: key.slice(0, 100) };
  const store = normalizeStoreUrl(typedStore);
  if (!store.ok) return { error: store.error, values };
  if (!CONSUMER_KEY_RE.test(key)) return { error: "The consumer key starts with ck_. Copy it exactly from WooCommerce.", values };
  if (!CONSUMER_SECRET_RE.test(secret)) return { error: "The consumer secret starts with cs_. Copy it exactly from WooCommerce.", values };
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return { error: "Finish setting up your business first.", values };
  const missing = await featureBlocked(business.id, "storeImport");
  if (missing) return { error: missing, values };
  try {
    await rateLimit(`store-connect:${user.id}`, RATE_LIMITS.storeConnect);
    const packed = packKeys(key, secret);
    const { currency } = await verifyWooKeys(store.url, packed);
    await saveConnection({ businessId: business.id, provider: "woocommerce", storeUrl: store.url, secret: packed, scopes: "read", currency });
  } catch (error) {
    if (error instanceof RateLimitError) return { error: rateLimitMessage(error), values };
    if (error instanceof StoreApiError) return { error: error.authFailed ? "The store did not accept those keys. Check them and that they have Read access." : `The store answered with an error (${error.status ?? "no answer"}). Check the address.`, values };
    return { error: error instanceof Error && /redirect|https|address|network/i.test(error.message) ? error.message : "We could not reach that store. Check the address.", values };
  }
  revalidatePath("/dashboard/stores/woocommerce");
  redirect("/dashboard/stores/woocommerce?connected=1");
}

const wooBack = (error: string): never => redirect(`/dashboard/stores/woocommerce?error=${error}`);

/**
 * Starts the one-click WooCommerce flow. A server action (POST with Next's origin check) rather than a link, so another
 * website cannot send a signed-in owner into an attacker's store approval page.
 */
export async function startWooConnectAction(formData: FormData): Promise<void> {
  const user = await requireActiveUser("connectors");
  if (!(await isServiceEnabled("woocommerce"))) return wooBack("unavailable");
  const store = normalizeStoreUrl(String(formData.get("store") ?? ""));
  if (!store.ok) return wooBack("invalid_store");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return wooBack("no_business");
  if (await featureBlocked(business.id, "storeImport")) return redirect(upgradeHref("storeImport"));
  // WooCommerce only posts keys to an https callback, so a plain-http BuPulse (local development) must use manual keys.
  if (!publicSiteUrl().startsWith("https://")) return wooBack("needs_https");
  let target: string;
  try {
    await rateLimit(`store-connect:${user.id}`, RATE_LIMITS.storeConnect);
    target = buildWooAuthorizeUrl(store.url, await sealWooState({ userId: user.id, businessId: business.id, storeUrl: store.url }), await linkSiteUrl());
  } catch (error) {
    if (error instanceof RateLimitError) return wooBack("rate_limited");
    await logError(error, { source: "stores.woocommerce.connect", userId: user.id });
    return wooBack("error");
  }
  redirect(target);
}

/**
 * The owner confirms the keys the store sent. Only then does the connection change (and mappings drop if the host
 * changed). Returns where to go; the screen does a full page load, so the new state always shows.
 */
export async function confirmPendingAction(pendingId: string): Promise<{ ok: boolean }> {
  const user = await requireActiveUser("connectors");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  const allowed = !!business && !(await featureBlocked(business.id, "storeImport"));
  const ok = allowed && typeof pendingId === "string" && pendingId.length <= 64 && (await confirmPending(business.id, "woocommerce", pendingId));
  revalidatePath("/dashboard/stores/woocommerce");
  return { ok };
}

export async function cancelPendingAction(): Promise<{ ok: boolean }> {
  const user = await requireActiveUser("connectors");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (business) await cancelPending(business.id, "woocommerce");
  revalidatePath("/dashboard/stores/woocommerce");
  return { ok: true };
}
