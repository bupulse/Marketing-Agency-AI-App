import { decrypt, encrypt } from "@/lib/crypto";

// A short-lived sealed cookie for the Shopify connect flow: state, shop and user, AES-GCM sealed (httpOnly).
export const SHOPIFY_COOKIE = "bp_shopify_oauth";
const TTL_MS = 10 * 60 * 1000;

export type ShopifyState = { state: string; shop: string; userId: string; expiresAt: number };

export async function sealShopifyState(data: Omit<ShopifyState, "expiresAt">, now = Date.now()): Promise<string> {
  return encrypt(JSON.stringify({ ...data, expiresAt: now + TTL_MS } satisfies ShopifyState));
}

export async function openShopifyState(sealed: string | undefined, userId: string, now = Date.now()): Promise<ShopifyState | null> {
  if (!sealed) return null;
  try {
    const data = JSON.parse(await decrypt(sealed)) as ShopifyState;
    if (typeof data.state !== "string" || typeof data.shop !== "string" || data.userId !== userId || data.expiresAt < now) return null;
    return data;
  } catch {
    return null;
  }
}
