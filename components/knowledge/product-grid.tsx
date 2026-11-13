import { Badge } from "@/components/ui";
import { ProductCard as ShelfCard } from "@/components/media-cards";
import { KIND_SHORT, STATUS_LABEL } from "@/lib/knowledge/products";
import type { ProductCard } from "@/lib/knowledge/service";

/** The products as shelf cards (components/media-cards ProductCard): photo, kind, name, summary, price, counts. */
export function ProductGrid({ products }: { products: ProductCard[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
      {products.map((p, i) => (
        <li key={p.id} className="flex">
          <ShelfCard
            index={i}
            className="w-full"
            href={`/dashboard/knowledge/products/${p.id}`}
            name={p.name}
            imageUrl={p.thumb}
            kindLabel={KIND_SHORT[p.kind]}
            category={p.category}
            summary={p.summary}
            price={p.price}
            status={p.status === "ACTIVE" ? null : p.status === "DRAFT" ? "draft" : "ended"}
            statusLabel={p.status === "ACTIVE" ? null : STATUS_LABEL[p.status]}
            badges={
              p.syncedFrom ? (
                <span className="rounded-full border border-white/25 bg-black/40 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">{p.syncedFrom === "shopify" ? "From Shopify" : "From WooCommerce"}</span>
              ) : undefined
            }
            extra={
              <div className="flex flex-col gap-1 pt-1 text-[13px] text-muted">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    {p.photoCount} {p.photoCount === 1 ? "photo" : "photos"}
                  </span>
                  <span>
                    {p.contentCount} {p.contentCount === 1 ? "text" : "texts"}
                  </span>
                  {!p.ready && <Badge tone="violet">Needs details</Badge>}
                </div>
                {!p.ready && <span>Add {p.missing.join(", ")}</span>}
              </div>
            }
          />
        </li>
      ))}
    </ul>
  );
}
