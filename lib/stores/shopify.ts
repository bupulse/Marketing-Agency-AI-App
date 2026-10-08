// Shopify: OAuth (authorization-code grant, HMAC-verified), webhooks and the GraphQL Admin API.
// Scope is read_products only. Env: SHOPIFY_API_KEY, SHOPIFY_API_SECRET (without them the connector is "unavailable").
import { siteUrl } from "@/lib/auth/site-url";
import { hmacBase64, hmacHex, safeEqual } from "./hmac";
import { storeApiFetch } from "./safe-fetch";
import { cleanFeatures, clip, formatPrice } from "./text";
import { StoreApiError, type NormalizedProduct, type ProductPage, type StoreCredentials, type StoreProvider } from "./types";

export const SHOPIFY_SCOPES = "read_products";
/** Admin API version; override with SHOPIFY_API_VERSION when a newer stable one is wanted. */
export const shopifyApiVersion = () => process.env.SHOPIFY_API_VERSION || "2026-07";

export function shopifyConfig(): { apiKey: string; apiSecret: string } | null {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}
export const isShopifyEnabled = () => shopifyConfig() !== null;
export const shopifyRedirectUri = () => `${siteUrl()}/api/stores/shopify/callback`;

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

/**
 * "my-shop", "my-shop.myshopify.com" or "https://admin.shopify.com/store/my-shop" -> "my-shop.myshopify.com".
 * Anything else (another domain, a path, credentials) is null: the shop host is where the secret code is sent,
 * so only *.myshopify.com is accepted.
 */
export function normalizeShopDomain(input: string | null | undefined): string | null {
  let value = (input ?? "").trim().toLowerCase();
  if (!value || value.length > 120) return null;
  const admin = value.match(/^(?:https?:\/\/)?admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/);
  if (admin) value = `${admin[1]}.myshopify.com`;
  value = value.replace(/^https:\/\//, "").replace(/\/+$/, "");
  if (!value.includes(".")) value = `${value}.myshopify.com`;
  return SHOP_RE.test(value) ? value : null;
}

// ---- OAuth ----

/** The URL the merchant is sent to to approve the app. */
export function buildAuthorizeUrl(shop: string, state: string): string {
  const config = shopifyConfig();
  if (!config) throw new Error("Shopify is not configured");
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: config.apiKey, scope: SHOPIFY_SCOPES, redirect_uri: shopifyRedirectUri(), state }).toString();
  return url.toString();
}

/**
 * Verifies the `hmac` Shopify adds to the OAuth callback (and to app-proxy and install requests): all other query
 * parameters, sorted and joined as key=value with &, signed with the app secret (hex).
 */
export async function verifyOAuthHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const given = params.get("hmac");
  if (!given) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .map(([key, value]) => [key.replace(/%/g, "%25").replace(/&/g, "%26").replace(/=/g, "%3D"), value.replace(/%/g, "%25").replace(/&/g, "%26")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return safeEqual(await hmacHex(secret, message), given.toLowerCase());
}

/** Verifies X-Shopify-Hmac-Sha256 (base64 HMAC of the raw body) on a webhook. */
export async function verifyWebhookHmac(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  return safeEqual(await hmacBase64(secret, rawBody), header.trim());
}

/** Swaps the one-time code for a permanent offline access token. */
export async function exchangeCode(shop: string, code: string, fetchImpl: typeof fetch = fetch): Promise<{ accessToken: string; scope: string }> {
  const config = shopifyConfig();
  if (!config) throw new Error("Shopify is not configured");
  const response = await storeApiFetch(
    `https://${shop}/admin/oauth/access_token`,
    { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ client_id: config.apiKey, client_secret: config.apiSecret, code }) },
    fetchImpl,
  );
  if (!response.ok) throw new StoreApiError(`Shopify refused the code (${response.status})`, response.status);
  const body = (await response.json()) as { access_token?: string; scope?: string };
  if (!body.access_token) throw new StoreApiError("Shopify sent no access token");
  return { accessToken: body.access_token, scope: body.scope ?? SHOPIFY_SCOPES };
}

// ---- GraphQL Admin API ----

async function graphql<T>(creds: StoreCredentials, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await storeApiFetch(
    `https://${creds.storeUrl}/admin/api/${shopifyApiVersion()}/graphql.json`,
    { method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": creds.secret }, body: JSON.stringify({ query, variables }) },
    fetchImpl,
  );
  if (!response.ok) throw new StoreApiError(`Shopify answered ${response.status}`, response.status);
  const body = (await response.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (body.errors?.length) {
    const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
    throw new StoreApiError(throttled ? "Shopify asked us to slow down. Try again in a minute." : body.errors[0].message, throttled ? 429 : 400);
  }
  if (!body.data) throw new StoreApiError("Shopify sent an empty answer");
  return body.data;
}

const PRODUCT_FIELDS = `
  id title description(truncateAt: 2000) productType tags onlineStoreUrl status
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  media(first: 10, query: "media_type:IMAGE") { nodes { ... on MediaImage { image { url } } } }
`;

type ShopifyProduct = {
  id: string;
  title: string;
  description?: string | null;
  productType?: string | null;
  tags?: string[];
  onlineStoreUrl?: string | null;
  priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string }; maxVariantPrice: { amount: string; currencyCode: string } };
  media?: { nodes: ({ image?: { url: string } | null } | null)[] };
};

export function normalizeShopifyProduct(p: ShopifyProduct): NormalizedProduct {
  const range = p.priceRangeV2;
  let price: string | null = null;
  if (range) {
    const min = formatPrice(range.minVariantPrice.amount, range.minVariantPrice.currencyCode);
    price = Number(range.minVariantPrice.amount) === Number(range.maxVariantPrice.amount) ? min : `From ${min}`;
  }
  return {
    externalId: p.id,
    title: clip(p.title || "Untitled product", 200),
    price: price ? clip(price, 100) : null,
    description: p.description?.trim() ? clip(p.description, 2000) : null,
    features: cleanFeatures([p.productType, ...(p.tags ?? [])]),
    imageUrls: (p.media?.nodes ?? []).flatMap((n) => (n?.image?.url ? [n.image.url] : [])),
    url: p.onlineStoreUrl ?? null,
  };
}

/** Shopify search syntax: keep letters, numbers and spaces so a search cannot inject operators. */
export function searchQuery(search: string | undefined): string {
  const words = (search ?? "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const text = words.map((w) => `title:*${w}*`).join(" ");
  return text ? `status:active ${text}` : "status:active";
}

export const shopifyProvider: StoreProvider = {
  async listProducts(creds, { cursor, search, take = 25 }): Promise<ProductPage> {
    const data = await graphql<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProduct[] } }>(
      creds,
      `query Products($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes { ${PRODUCT_FIELDS} }
        }
      }`,
      { first: Math.min(Math.max(take, 1), 50), after: cursor || null, query: searchQuery(search) },
    );
    const { pageInfo, nodes } = data.products;
    return { products: nodes.map(normalizeShopifyProduct), nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
  },

  async getProducts(creds, ids) {
    const out = new Map<string, NormalizedProduct>();
    for (let i = 0; i < ids.length; i += 50) {
      const data = await graphql<{ nodes: (ShopifyProduct | null)[] }>(
        creds,
        `query ProductsById($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } } }`,
        { ids: ids.slice(i, i + 50) },
      );
      for (const node of data.nodes) if (node?.id) out.set(node.id, normalizeShopifyProduct(node));
    }
    return out;
  },
};

/** Best effort: ask Shopify to tell us when the app is removed (also configurable in the Partner Dashboard). */
export async function subscribeUninstall(creds: StoreCredentials, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await graphql(
      creds,
      `mutation($callbackUrl: URL!) { webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }) { userErrors { message } } }`,
      { callbackUrl: `${siteUrl()}/api/stores/shopify/webhooks` },
      fetchImpl,
    );
  } catch {
    // The Partner Dashboard subscription covers it.
  }
}

/**
 * Shopify opens the App URL with ?shop, ?hmac, ?host and ?timestamp when a merchant installs the app. Returns the path
 * that starts OAuth for a request Shopify signed (HMAC valid, shop valid, at most 15 minutes old), else null.
 */
export async function installRedirect(query: Record<string, string | string[] | undefined>, secret: string, now = Date.now()): Promise<string | null> {
  if (typeof query.hmac !== "string" || typeof query.shop !== "string") return null;
  const params = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));
  if (!normalizeShopDomain(query.shop)) return null;
  if (!(Math.abs(now / 1000 - Number(query.timestamp)) <= 15 * 60)) return null;
  if (!(await verifyOAuthHmac(params, secret))) return null;
  return `/api/stores/shopify/connect?${params.toString()}`;
}
