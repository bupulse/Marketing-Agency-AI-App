import { prisma } from "@/lib/db";
import { isShopifyEnabled } from "@/lib/stores/shopify";
import { removeConnection } from "@/lib/stores/connection";
import { relativeSync } from "@/lib/stores/labels";
import type { ConnectorEntry } from "../types";

export const connector: ConnectorEntry = {
  id: "shopify",
  name: "Shopify",
  group: "store",
  description: "Bring your products into BuPulse as products, with photos, and keep them up to date.",
  icon: "ShoppingBag",
  async status({ businessId }) {
    if (!isShopifyEnabled()) return { state: "unavailable" };
    const row = await prisma.storeConnection.findUnique({ where: { businessId_provider: { businessId, provider: "shopify" } }, select: { storeUrl: true, status: true, lastSyncAt: true } });
    if (!row) return { state: "not_connected" };
    if (row.status !== "ACTIVE") return { state: "needs_attention", accountLabel: row.storeUrl, detail: "Access was removed. Reconnect to keep syncing." };
    return { state: "connected", accountLabel: row.storeUrl, detail: relativeSync(row.lastSyncAt) };
  },
  connectHref: "/dashboard/stores/shopify",
  manageHref: "/dashboard/stores/shopify",
  async disconnect({ businessId }) {
    await removeConnection(businessId, "shopify");
  },
};
