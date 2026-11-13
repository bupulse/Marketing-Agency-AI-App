import { ArrowRight, ShoppingBag, Store } from "lucide-react";
import { KitStyles, PageHeader, StatusPill } from "@/components/admin/kit";
import { IconBadge } from "@/components/admin/kit/icon-badge";
import { CARD } from "@/components/admin/kit/tones";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export type StoreCard = { id: "shopify" | "woocommerce"; name: string; off: boolean; storeUrl: string | null };

const ICON = { shopify: ShoppingBag, woocommerce: Store } as const;
const HINT = { shopify: "Your Shopify shop's products, prices and photos.", woocommerce: "The products of your WordPress shop." } as const;

/** /dashboard/stores: one card per online shop, connected or not, with its one next step. Presentational. */
export function StoresView({ cards }: { cards: StoreCard[] }) {
  return (
    <>
      <KitStyles />
      <PageHeader icon={ShoppingBag} title="Import from your store" description="Bring your online shop's products and photos into Business info, then make posts from them." back={{ href: "/dashboard/connectors", label: "Connectors" }} />
      <ul className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map(({ id, name, off, storeUrl }) => (
          <li key={id} className={cn(CARD, "flex flex-col gap-4 p-4 sm:p-5", off && "opacity-80")}>
            <div className="flex items-start gap-3">
              <IconBadge icon={ICON[id]} tone={off ? "slate" : "blue"} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[16px] font-bold">{name}</h2>
                  {off ? (
                    <StatusPill tone="muted">Coming soon</StatusPill>
                  ) : storeUrl ? (
                    <StatusPill tone="good" dot>
                      Connected
                    </StatusPill>
                  ) : (
                    <StatusPill tone="muted">Not connected</StatusPill>
                  )}
                </div>
                <p className="text-[13px] leading-snug text-muted">{HINT[id]}</p>
                {storeUrl && <p className="truncate text-[13px] font-semibold">{storeUrl.replace(/^https:\/\//, "")}</p>}
              </div>
            </div>
            {!off && (
              <Button href={`/dashboard/stores/${id}`} size="sm" variant={storeUrl ? "primary" : "outline"} className="self-start" trailing={<ArrowRight aria-hidden className="size-4" />}>
                {storeUrl ? "Import products" : "Connect"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
