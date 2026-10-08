import { ShoppingBag, Store } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Button, GlassCard } from "@/components/ui";
import { prisma } from "@/lib/db";
import { isShopifyEnabled } from "@/lib/stores/shopify";

export const metadata = { title: "Import from your store" };

export default async function StoresPage() {
  const { business } = await getAppContext();
  if (!business) return null;
  const rows = await prisma.storeConnection.findMany({ where: { businessId: business.id }, select: { provider: true, storeUrl: true } });
  const byProvider = new Map(rows.map((r) => [r.provider, r.storeUrl]));
  const cards = [
    { id: "shopify", name: "Shopify", icon: ShoppingBag, off: !isShopifyEnabled() },
    { id: "woocommerce", name: "WooCommerce", icon: Store, off: false },
  ];
  return (
    <>
      <PageHeader title="Import from your store" description="Turn your online shop's products into projects, with photos, then create posts from them." />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {cards.map(({ id, name, icon: Icon, off }) => (
          <GlassCard as="li" key={id} className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white"><Icon className="size-5" /></span>
              <div className="min-w-0">
                <p className="font-semibold">{name}</p>
                <p className="truncate text-[13px] text-muted">{byProvider.get(id)?.replace(/^https:\/\//, "") ?? "Not connected"}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              {off ? <Badge tone="neutral">Coming soon</Badge> : byProvider.has(id) ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
              {!off && <Button href={`/dashboard/stores/${id}`} size="sm" variant={byProvider.has(id) ? "primary" : "ghost"}>{byProvider.has(id) ? "Import products" : "Connect"}</Button>}
            </div>
          </GlassCard>
        ))}
      </ul>
    </>
  );
}
