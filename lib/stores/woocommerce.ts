// WooCommerce: the store's one-click key flow (/wc-auth/v1/authorize), a manual-keys fallback and the REST API v3.
import { decrypt, encrypt } from "@/lib/crypto";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { checkWebhookUrl } from "@/lib/leads/webhook";
import { randomToken } from "@/lib/canva/pkce";
import { storeApiFetch } from "./safe-fetch";
import { cleanFeatures, clip, formatPrice, htmlToText } from "./text";
import { StoreApiError, type NormalizedProduct, type ProductPage, type StoreCredentials, type StoreProvider } from "./types";

export const WOO_CALLBACK_PATH = "/api/stores/woocommerce/callback";
const STATE_TTL_MS = 15 * 60 * 1000;

/** The store's base address: https only, no private or local hosts; query and fragment dropped. */
export function normalizeStoreUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : trimmed ? `https://${trimmed}` : "";
  const checked = checkWebhookUrl(withScheme);
  if (!checked.ok) return checked;
  const path = checked.url.pathname.replace(/\/+$/, "").replace(/\/(wp-admin|wp-json)(\/.*)?$/i, "");
  return { ok: true, url: `${checked.url.origin}${path}` };
}

// ---- Signed state ----
// WooCommerce POSTs the keys to our callback from the store's server, so there is no browser session to check. The
// `user_id` we pass out is an AES-GCM sealed blob (lib/crypto.ts): unreadable and unforgeable without our key.

export type WooState = { userId: string; businessId: string; storeUrl: string; nonce: string; expiresAt: number };

export async function sealWooState(data: Omit<WooState, "expiresAt" | "nonce">, now = Date.now()): Promise<string> {
  return encrypt(JSON.stringify({ ...data, nonce: randomToken(12), expiresAt: now + STATE_TTL_MS } satisfies WooState));
}

/** The state, or null when forged, expired or not a WooCommerce state. */
export async function openWooState(sealed: string | null | undefined, now = Date.now()): Promise<WooState | null> {
  if (!sealed || sealed.length > 2000) return null;
  try {
    const data = JSON.parse(await decrypt(sealed)) as WooState;
    if (typeof data.userId !== "string" || typeof data.businessId !== "string" || typeof data.storeUrl !== "string" || data.expiresAt < now) return null;
    return data;
  } catch {
    return null;
  }
}

/** The address the merchant is sent to to approve read access. */
export function buildWooAuthorizeUrl(storeUrl: string, state: string, returnBase = publicSiteUrl()): string {
  const url = new URL(`${storeUrl}/wc-auth/v1/authorize`);
  url.search = new URLSearchParams({
    app_name: "BuPulse",
    scope: "read",
    user_id: state,
    return_url: `${returnBase}/dashboard/stores/woocommerce?connected=1`,
    // The store posts the keys here server to server: the public address (WooCommerce takes any URL per request).
    callback_url: `${publicSiteUrl()}${WOO_CALLBACK_PATH}`,
  }).toString();
  return url.toString();
}

export const CONSUMER_KEY_RE = /^ck_[A-Za-z0-9]{20,80}$/;
export const CONSUMER_SECRET_RE = /^cs_[A-Za-z0-9]{20,80}$/;

export function packKeys(key: string, secret: string) {
  return `${key}:${secret}`;
}

function authHeader(packed: string) {
  return `Basic ${btoa(packed)}`;
}

async function wooGet(creds: StoreCredentials, path: string, params: Record<string, string> = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(`${creds.storeUrl}/wp-json/wc/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let response = await storeApiFetch(url.toString(), { headers: { authorization: authHeader(creds.secret), accept: "application/json" } }, fetchImpl);
  if (response.status === 401) {
    // Some hosts strip the Authorization header; WooCommerce also accepts the keys as query parameters over https.
    const [key, secret] = creds.secret.split(":");
    url.searchParams.set("consumer_key", key);
    url.searchParams.set("consumer_secret", secret);
    response = await storeApiFetch(url.toString(), { headers: { accept: "application/json" } }, fetchImpl);
  }
  if (!response.ok) throw new StoreApiError(`The store answered ${response.status}`, response.status);
  return response;
}

/** Checks that the keys work, and reads the currency. Throws StoreApiError. */
export async function verifyWooKeys(storeUrl: string, packedKeys: string, fetchImpl: typeof fetch = fetch): Promise<{ currency: string | null }> {
  const creds: StoreCredentials = { provider: "woocommerce", storeUrl, secret: packedKeys };
  await wooGet(creds, "products", { per_page: "1" }, fetchImpl);
  try {
    const body = (await (await wooGet(creds, "data/currencies/current", {}, fetchImpl)).json()) as { code?: string };
    return { currency: body.code && /^[A-Z]{3}$/.test(body.code) ? body.code : null };
  } catch {
    return { currency: null };
  }
}

type WooProduct = {
  id: number;
  name: string;
  type?: string;
  permalink?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  description?: string;
  short_description?: string;
  categories?: { name: string }[];
  tags?: { name: string }[];
  attributes?: { name: string; options?: string[]; visible?: boolean }[];
  images?: { src: string }[];
};

export function normalizeWooProduct(p: WooProduct, currency: string | null | undefined): NormalizedProduct {
  let price: string | null = null;
  if (p.price !== undefined && p.price !== "") {
    const base = formatPrice(p.price, currency);
    price = p.type === "variable" || p.type === "grouped" ? `From ${base}` : base;
  }
  const description = htmlToText(p.short_description) || htmlToText(p.description);
  return {
    externalId: String(p.id),
    title: clip(htmlToText(p.name) || "Untitled product", 200),
    price: price ? clip(price, 100) : null,
    description: description ? clip(description, 2000) : null,
    features: cleanFeatures([
      ...(p.categories ?? []).map((c) => c.name),
      ...(p.tags ?? []).map((t) => t.name),
      ...(p.attributes ?? []).filter((a) => a.visible !== false && a.options?.length).map((a) => `${a.name}: ${a.options!.slice(0, 6).join(", ")}`),
    ]),
    imageUrls: (p.images ?? []).map((i) => i.src).filter(Boolean),
    url: p.permalink ?? null,
  };
}

export const wooProvider: StoreProvider = {
  async listProducts(creds, { cursor, search, take = 25 }): Promise<ProductPage> {
    const page = Math.max(Number(cursor) || 1, 1);
    const response = await wooGet(creds, "products", {
      per_page: String(Math.min(Math.max(take, 1), 50)),
      page: String(page),
      status: "publish",
      orderby: "date",
      order: "desc",
      ...(search?.trim() ? { search: search.trim().slice(0, 80) } : {}),
    });
    const items = (await response.json()) as WooProduct[];
    const totalPages = Number(response.headers.get("x-wp-totalpages") ?? 1);
    return { products: items.map((p) => normalizeWooProduct(p, creds.currency)), nextCursor: page < totalPages ? String(page + 1) : null };
  },

  async getProducts(creds, ids) {
    const out = new Map<string, NormalizedProduct>();
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50).filter((id) => /^\d+$/.test(id));
      if (!batch.length) continue;
      const items = (await (await wooGet(creds, "products", { include: batch.join(","), per_page: "50", status: "publish" })).json()) as WooProduct[];
      for (const p of items) out.set(String(p.id), normalizeWooProduct(p, creds.currency));
    }
    return out;
  },
};
