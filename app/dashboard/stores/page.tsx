import { featureGate, pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { StoresView, type StoreCard } from "@/components/connectors/stores-view";
import { prisma } from "@/lib/db";
import { isShopifyEnabled } from "@/lib/stores/shopify";

export const metadata = { title: "Import from your store" };

export default async function StoresPage() {
  const blocked = (await pageGate("connectors")) ?? (await featureGate("storeImport"));
  if (blocked) return blocked;
  const { business } = await getAppContext();
  if (!business) return null;
  const rows = await prisma.storeConnection.findMany({ where: { businessId: business.id }, select: { provider: true, storeUrl: true } });
  const byProvider = new Map(rows.map((r) => [r.provider, r.storeUrl]));
  const cards: StoreCard[] = [
    { id: "shopify", name: "Shopify", off: !isShopifyEnabled(), storeUrl: byProvider.get("shopify") ?? null },
    { id: "woocommerce", name: "WooCommerce", off: false, storeUrl: byProvider.get("woocommerce") ?? null },
  ];
  return <StoresView cards={cards} />;
}
