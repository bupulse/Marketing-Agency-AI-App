import Link from "next/link";
import { Package, Plus, Search, Store } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { ProductGrid } from "@/components/knowledge/product-grid";
import { Button, GlassCard, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/db";
import { KIND_LABEL, PRODUCT_KINDS, type ItemStatusValue, type ProductKindValue } from "@/lib/knowledge/products";
import { listProducts } from "@/lib/knowledge/service";

export const metadata = { title: "Products & services" };

const BASE = "/dashboard/knowledge/products";
const STATUS_VIEWS: { value: string; label: string }[] = [
  { value: "", label: "Active and drafts" },
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Drafts" },
  { value: "ARCHIVED", label: "Archived" },
];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; q?: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const params = await searchParams;
  const kind = (PRODUCT_KINDS as readonly string[]).includes(params.kind ?? "") ? (params.kind as ProductKindValue) : undefined;
  const status = ["ACTIVE", "DRAFT", "ARCHIVED"].includes(params.status ?? "") ? (params.status as ItemStatusValue) : undefined;
  const q = params.q?.slice(0, 80) ?? "";
  const [products, total, stores] = await Promise.all([
    listProducts(business.id, { kind, status, q }),
    prisma.product.count({ where: { businessId: business.id } }),
    prisma.storeConnection.findMany({ where: { businessId: business.id }, select: { provider: true } }),
  ]);
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { kind, status, q: q || undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `${BASE}?${s}` : BASE;
  };
  // One button per connected store ("Import from Shopify"), or a single "Import from your store" before any is connected.
  const importButtons = (stores.length > 0 ? stores.map((s) => ({ href: `/dashboard/stores/${s.provider}`, label: `Import from ${s.provider === "shopify" ? "Shopify" : "WooCommerce"}` })) : [{ href: "/dashboard/stores", label: "Import from your store" }]).map((b) => (
    <Button key={b.href} href={b.href} variant="ghost" leading={<Store aria-hidden className="size-[18px]" />}>
      {b.label}
    </Button>
  ));
  const newButton = (
    <Button href={`${BASE}/new`} leading={<Plus aria-hidden className="size-[18px]" />}>
      Add product or service
    </Button>
  );
  const chip = (active: boolean) =>
    cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-medium whitespace-nowrap no-underline", active ? "bg-brand-gradient text-white" : "glass text-text");

  return (
    <>
      <BackLink />
      <PageHeader
        title="Products & services"
        description="Everything you sell. Each one gets its own photo album, and BuPulse writes posts and designs from its details."
        action={total > 0 ? <div className="flex flex-wrap gap-2">{importButtons}{newButton}</div> : undefined}
      />
      {total === 0 ? (
        <EmptyState
          icon={Package}
          title="Add your first product or service"
          text="A product you sell, a digital product or a service you offer. Add the details once; BuPulse writes the posts."
          points={["Price, reasons to buy and key features", "A photo album for each one", "Captions, designs and Autopilot posts made from it"]}
          action={<div className="flex flex-wrap gap-2">{newButton}{importButtons}</div>}
        />
      ) : (
        <>
          <GlassCard className="flex flex-col gap-3 p-4">
            <nav aria-label="Filter by kind" className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
              <Link href={href({ kind: undefined })} aria-current={!kind ? "page" : undefined} className={chip(!kind)}>
                All
              </Link>
              {PRODUCT_KINDS.map((k) => (
                <Link key={k} href={href({ kind: k })} aria-current={kind === k ? "page" : undefined} className={chip(kind === k)}>
                  {KIND_LABEL[k]}
                </Link>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-3">
              <form action={BASE} className="relative min-w-0 flex-1 basis-60" role="search">
                {kind && <input type="hidden" name="kind" value={kind} />}
                {status && <input type="hidden" name="status" value={status} />}
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
                <Input type="search" name="q" defaultValue={q} aria-label="Search products" placeholder="Search by name or category" className="pl-10" />
              </form>
              <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
                {STATUS_VIEWS.map((s) => (
                  <Link key={s.value} href={href({ status: s.value || undefined })} aria-current={(status ?? "") === s.value ? "page" : undefined} className={cn(chip((status ?? "") === s.value), "px-3 text-[14px]")}>
                    {s.label}
                  </Link>
                ))}
              </nav>
            </div>
          </GlassCard>
          <p role="status" className="px-1 text-[13px] text-muted">
            {products.length} {products.length === 1 ? "item" : "items"}
          </p>
          {products.length === 0 ? <GlassCard className="px-4 py-10 text-center text-[15px] text-muted">Nothing matches. Try another word or filter.</GlassCard> : <ProductGrid products={products} />}
        </>
      )}
    </>
  );
}
