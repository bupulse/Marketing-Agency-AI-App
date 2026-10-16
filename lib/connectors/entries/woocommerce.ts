import { prisma } from "@/lib/db";
import { removeConnection } from "@/lib/stores/connection";
import { relativeSync } from "@/lib/stores/labels";
import type { ConnectorEntry } from "../types";

export const connector: ConnectorEntry = {
  id: "woocommerce",
  name: "WooCommerce",
  group: "store",
  description: "Bring your WordPress shop's products into BuPulse as products, with photos, and keep them up to date.",
  icon: "Store",
  async status({ businessId }) {
    const row = await prisma.storeConnection.findUnique({ where: { businessId_provider: { businessId, provider: "woocommerce" } }, select: { storeUrl: true, status: true, lastSyncAt: true } });
    if (!row) return { state: "not_connected" };
    const label = row.storeUrl.replace(/^https:\/\//, "");
    if (row.status !== "ACTIVE") return { state: "needs_attention", accountLabel: label, detail: "The keys stopped working. Reconnect to keep syncing." };
    return { state: "connected", accountLabel: label, detail: relativeSync(row.lastSyncAt) };
  },
  connectHref: "/dashboard/stores/woocommerce",
  manageHref: "/dashboard/stores/woocommerce",
  async disconnect({ businessId }) {
    await removeConnection(businessId, "woocommerce");
  },
};
