import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { shopifyProvider } from "./shopify";
import { wooProvider } from "./woocommerce";
import type { StoreCredentials, StoreProvider, StoreProviderId } from "./types";

export function providerFor(id: StoreProviderId): StoreProvider {
  return id === "shopify" ? shopifyProvider : wooProvider;
}

export type ConnectionRow = NonNullable<Awaited<ReturnType<typeof getConnection>>>;

export function getConnection(businessId: string, provider: StoreProviderId) {
  return prisma.storeConnection.findUnique({ where: { businessId_provider: { businessId, provider } } });
}

/** Decrypts the stored keys for server-side calls. The result must never reach the browser. */
export async function credentialsOf(row: { provider: string; storeUrl: string; credentialsEncrypted: string; currency: string | null }): Promise<StoreCredentials> {
  return { provider: row.provider as StoreProviderId, storeUrl: row.storeUrl, secret: await decrypt(row.credentialsEncrypted), currency: row.currency };
}

/** Creates or replaces the business's connection to a provider; imported projects keep their mappings only if the store is the same. */
export async function saveConnection(input: { businessId: string; provider: StoreProviderId; storeUrl: string; secret: string; scopes?: string; currency?: string | null }) {
  const credentialsEncrypted = await encrypt(input.secret);
  const existing = await getConnection(input.businessId, input.provider);
  const sameStore = existing?.storeUrl === input.storeUrl;
  if (existing && !sameStore) await prisma.productSync.deleteMany({ where: { connectionId: existing.id } });
  const data = { storeUrl: input.storeUrl, credentialsEncrypted, scopes: input.scopes ?? null, currency: input.currency ?? null, status: "ACTIVE", lastSyncError: null };
  return prisma.storeConnection.upsert({
    where: { businessId_provider: { businessId: input.businessId, provider: input.provider } },
    create: { businessId: input.businessId, provider: input.provider, ...data },
    update: data,
  });
}

/** Removes the keys and the product mappings. Projects that were imported stay. */
export async function removeConnection(businessId: string, provider: StoreProviderId) {
  await prisma.storeConnection.deleteMany({ where: { businessId, provider } });
}

export async function markNeedsAttention(id: string, message: string) {
  await prisma.storeConnection.updateMany({ where: { id }, data: { status: "NEEDS_ATTENTION", lastSyncError: message.slice(0, 300) } });
}

// ---- Pending connections (WooCommerce one-click) ----
// The store's server posts keys to our callback with no browser session, so they must not replace the owner's
// connection on their own. They wait here until the signed-in owner confirms on /dashboard/stores/woocommerce.

export const PENDING_TTL_MS = 30 * 60 * 1000;

export async function savePending(input: { businessId: string; provider: StoreProviderId; storeUrl: string; secret: string; currency?: string | null }, now = Date.now()) {
  const data = { storeUrl: input.storeUrl, credentialsEncrypted: await encrypt(input.secret), currency: input.currency ?? null, expiresAt: new Date(now + PENDING_TTL_MS) };
  return prisma.storeConnectionPending.upsert({
    where: { businessId_provider: { businessId: input.businessId, provider: input.provider } },
    create: { businessId: input.businessId, provider: input.provider, ...data },
    update: data,
  });
}

/** The unexpired pending connection for this business, or null. */
export async function getPending(businessId: string, provider: StoreProviderId, now = Date.now()) {
  const row = await prisma.storeConnectionPending.findUnique({ where: { businessId_provider: { businessId, provider } } });
  return row && row.expiresAt.getTime() > now ? row : null;
}

/** Makes the pending keys the active connection. Mappings are dropped only if the store host changes (saveConnection). */
export async function confirmPending(businessId: string, provider: StoreProviderId, pendingId: string, now = Date.now()): Promise<boolean> {
  const row = await getPending(businessId, provider, now);
  if (!row || row.id !== pendingId) return false;
  await saveConnection({ businessId, provider, storeUrl: row.storeUrl, secret: await decrypt(row.credentialsEncrypted), scopes: "read", currency: row.currency });
  await prisma.storeConnectionPending.deleteMany({ where: { id: row.id } });
  return true;
}

export async function cancelPending(businessId: string, provider: StoreProviderId) {
  await prisma.storeConnectionPending.deleteMany({ where: { businessId, provider } });
}
