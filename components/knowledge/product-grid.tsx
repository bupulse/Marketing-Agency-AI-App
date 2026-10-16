import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { Badge, GlassCard } from "@/components/ui";
import { KIND_SHORT, STATUS_LABEL } from "@/lib/knowledge/products";
import type { ProductCard } from "@/lib/knowledge/service";

export function ProductGrid({ products }: { products: ProductCard[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {products.map((p) => (
        <li key={p.id}>
          <Link href={`/dashboard/knowledge/products/${p.id}`} className="block h-full no-underline">
            <GlassCard interactive padding="none" className="flex h-full flex-col overflow-hidden">
              <div className="relative aspect-[4/3] bg-soft">
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private signed URL
                  <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span aria-hidden className="flex size-full items-center justify-center bg-brand-gradient text-white/80">
                    <ImageIcon className="size-8" />
                  </span>
                )}
                <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                  <Badge tone="blue" className="bg-glass-strong">
                    {KIND_SHORT[p.kind]}
                  </Badge>
                  {p.status !== "ACTIVE" && (
                    <Badge tone="neutral" className="bg-glass-strong">
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  )}
                </div>
                {p.syncedFrom && (
                  <Badge tone="violet" className="absolute top-3 right-3 bg-glass-strong">
                    {p.syncedFrom === "shopify" ? "From Shopify" : "From WooCommerce"}
                  </Badge>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <strong className="line-clamp-2 text-[16px] leading-snug">{p.name}</strong>
                <span className="truncate text-[14px] text-muted">{p.price}</span>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[13px] text-muted">
                  <span>{p.photoCount} {p.photoCount === 1 ? "photo" : "photos"}</span>
                  <span>{p.contentCount} {p.contentCount === 1 ? "text" : "texts"}</span>
                  {!p.ready && <Badge tone="violet">Needs details</Badge>}
                </div>
                {!p.ready && <span className="text-[13px] text-muted">Add {p.missing.join(", ")}</span>}
              </div>
            </GlassCard>
          </Link>
        </li>
      ))}
    </ul>
  );
}
