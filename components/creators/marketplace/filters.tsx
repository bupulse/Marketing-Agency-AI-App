import Link from "next/link";
import { Button, Select } from "@/components/ui";
import { CREATOR_NETWORKS, NETWORK_LABEL } from "@/lib/creators/describe";
import { hasFilters, type MarketFilters } from "@/lib/creators/market-filters";

/**
 * The marketplace's filters as a plain GET form, so a filtered list is a link to share (and works without
 * JavaScript). Two columns on phones, one row from md up.
 */
export function MarketFiltersForm({ filters, types }: { filters: MarketFilters; types: { slug: string; name: string }[] }) {
  return (
    <form method="get" action="/creators" aria-label="Filter campaigns" className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
        Platform
        <Select name="platform" defaultValue={filters.platform ?? ""}>
          <option value="">All</option>
          {CREATOR_NETWORKS.map((n) => (
            <option key={n} value={n}>{NETWORK_LABEL[n]}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
        Sort
        <Select name="sort" defaultValue={filters.sort}>
          <option value="new">Newest</option>
          <option value="pay">Best pay</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
        Business type
        <Select name="type" defaultValue={filters.type ?? ""}>
          <option value="">All</option>
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
        When
        <Select name="when" defaultValue={filters.when ?? ""}>
          <option value="">Any time</option>
          <option value="now">Open now</option>
          <option value="soon">Starting soon</option>
        </Select>
      </label>
      <div className="col-span-2 flex items-end gap-2 md:col-span-1">
        <Button type="submit" size="sm" className="min-h-12 flex-1 md:flex-none">Show</Button>
        {hasFilters(filters) && (
          <Link href="/creators" className="inline-flex min-h-12 items-center px-3 text-sm font-semibold text-pulse-blue underline">Clear</Link>
        )}
      </div>
    </form>
  );
}
