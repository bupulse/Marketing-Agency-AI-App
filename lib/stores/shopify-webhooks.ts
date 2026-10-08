import "server-only";
import { prisma } from "@/lib/db";
import { normalizeShopDomain } from "./shopify";

/**
 * Handles an already-verified Shopify webhook.
 * - app/uninstalled and shop/redact: the access token is dead or must go, so the connection and its product
 *   mappings are deleted. Imported projects stay (they are the merchant's content in BuPulse).
 * - customers/data_request and customers/redact: BuPulse reads products only (read_products) and stores no
 *   Shopify customer data, so there is nothing to export or erase.
 */
export async function handleShopifyWebhook(topic: string, shopHeader: string | null): Promise<{ handled: boolean; removed: number }> {
  const shop = normalizeShopDomain(shopHeader);
  if (topic === "app/uninstalled" || topic === "shop/redact") {
    if (!shop) return { handled: false, removed: 0 };
    const { count } = await prisma.storeConnection.deleteMany({ where: { provider: "shopify", storeUrl: shop } });
    return { handled: true, removed: count };
  }
  if (topic === "customers/data_request" || topic === "customers/redact") return { handled: true, removed: 0 };
  return { handled: false, removed: 0 };
}
