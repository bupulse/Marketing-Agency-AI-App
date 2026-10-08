// Shared shapes for the Shopify and WooCommerce connectors (Phase 7). Providers turn a store's product into a
// NormalizedProduct; lib/stores/sync.ts imports and re-syncs those into Projects and does not know either API.

export type StoreProviderId = "shopify" | "woocommerce";

export const STORE_PROVIDERS: StoreProviderId[] = ["shopify", "woocommerce"];
export const STORE_NAMES: Record<StoreProviderId, string> = { shopify: "Shopify", woocommerce: "WooCommerce" };

export function isStoreProvider(value: string): value is StoreProviderId {
  return value === "shopify" || value === "woocommerce";
}

/** A store product in BuPulse's terms (the fields of a Project). */
export interface NormalizedProduct {
  /** Stable id in the store: the Shopify GID or the WooCommerce numeric id. */
  externalId: string;
  title: string;
  /** Free text with the currency, e.g. "$19.00" or "From $19.00". */
  price: string | null;
  /** Plain-text description (HTML removed), at most 2000 characters. */
  description: string | null;
  /** Category, tags and attributes, at most 20 short lines. */
  features: string[];
  /** Image URLs in the store's order (the importer keeps the first MAX_PROJECT_PHOTOS). */
  imageUrls: string[];
  /** Link to the product page, when the store has one. */
  url: string | null;
}

/** What a provider needs to call a store. `secret` is already decrypted: never send it to the browser. */
export interface StoreCredentials {
  provider: StoreProviderId;
  storeUrl: string;
  secret: string;
  currency?: string | null;
}

export interface ProductPage {
  products: NormalizedProduct[];
  /** Opaque cursor for the next page, null at the end. */
  nextCursor: string | null;
}

export interface StoreProvider {
  listProducts(creds: StoreCredentials, opts: { cursor?: string | null; search?: string; take?: number }): Promise<ProductPage>;
  /** The current version of these products; products that no longer exist are simply absent. */
  getProducts(creds: StoreCredentials, ids: string[]): Promise<Map<string, NormalizedProduct>>;
}

/** An error from a store's API. `status` 401/403 means the stored keys stopped working. */
export class StoreApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
  get authFailed() {
    return this.status === 401 || this.status === 403;
  }
}

/** The import cap for "import all". */
export const IMPORT_ALL_CAP = 200;
/** Products imported per request, so each server action stays short and the screen can show progress. */
export const IMPORT_CHUNK = 5;
