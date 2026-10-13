import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { designsHref, pageList, type DesignsQuery } from "@/lib/designs/list";

// The Designs page's date filter and page links. Plain links and a GET form, so they work without JavaScript and the
// URL can be shared or bookmarked.

const RANGES: { value: DesignsQuery["range"]; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
];

const chip = "inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] font-semibold no-underline transition-colors";

export function DesignsFilter({ base, query, total, extra }: { base: string; query: DesignsQuery; total: number; extra: Record<string, string | undefined> }) {
  return (
    <div className="flex flex-col gap-3 px-1">
      <nav aria-label="Filter designs by date" className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.value}
            href={designsHref(base, query, { range: r.value, page: 1, from: null, to: null }, extra)}
            aria-current={query.range === r.value ? "true" : undefined}
            className={cn(chip, query.range === r.value ? "border-pulse-blue bg-pulse-blue text-white" : "border-line text-text hover:bg-soft")}
          >
            {r.label}
          </Link>
        ))}
      </nav>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2">
        {Object.entries(extra).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="range" value="custom" />
        <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
          From
          <input type="date" name="from" defaultValue={query.from ?? ""} className="min-h-9 rounded-xl border border-line bg-surface px-2 text-[14px] text-text" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
          To
          <input type="date" name="to" defaultValue={query.to ?? ""} className="min-h-9 rounded-xl border border-line bg-surface px-2 text-[14px] text-text" />
        </label>
        <button type="submit" className={cn(chip, "border-line text-text hover:bg-soft")}>
          Show
        </button>
      </form>
      <p className="m-0 text-[13px] text-muted" role="status">
        {total === 0 ? "No designs for these dates." : `${total} ${total === 1 ? "design" : "designs"}`}
      </p>
    </div>
  );
}

export function DesignsPager({ base, query, page, pages, extra }: { base: string; query: DesignsQuery; page: number; pages: number; extra: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const link = (p: number) => designsHref(base, query, { page: p }, extra);
  return (
    <nav aria-label="Design pages" className="flex flex-wrap items-center justify-center gap-2 px-1 pt-2">
      {page > 1 ? (
        <Link href={link(page - 1)} className={cn(chip, "border-line text-text hover:bg-soft")}>
          <ChevronLeft aria-hidden className="size-4" /> Previous
        </Link>
      ) : null}
      {pageList(page, pages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} aria-hidden className="px-1 text-muted">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={link(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={cn(chip, "min-w-9 justify-center", p === page ? "border-pulse-blue bg-pulse-blue text-white" : "border-line text-text hover:bg-soft")}
          >
            {p}
          </Link>
        ),
      )}
      {page < pages ? (
        <Link href={link(page + 1)} className={cn(chip, "border-line text-text hover:bg-soft")}>
          Next <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}
