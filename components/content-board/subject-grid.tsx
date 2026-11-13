import Link from "next/link";
import { Megaphone, Package, Search, Sparkles } from "lucide-react";
import { FilterChips } from "@/components/admin/kit/filter-chips";
import { Button, GlassCard, Input } from "@/components/ui";
import { contentQuery, SUBJECT_SORT_LABEL, SUBJECT_SORTS, type ContentFilters } from "@/lib/content-board/filters";
import type { SubjectCardView } from "@/lib/content-board/queries";
import { cn } from "@/lib/cn";

const ICON = { product: Package, campaign: Megaphone, general: Sparkles } as const;

/** The query a subject card links with: the post filters carry over, the grid's own search and sort do not. */
function drillQuery(f: ContentFilters) {
  return contentQuery({ ...f, q: undefined, sort: "recent" });
}

/**
 * The grid of products, campaigns and General. Search and sort are a plain GET form (works without JavaScript and
 * keeps the URL shareable); the other filters ride along as hidden fields. A card with posts made for it today glows
 * (a brand ring and soft glow, still under reduced motion) with a "Today's posts" label.
 */
export function SubjectGrid({ cards, filters, period, base = "/dashboard/content/all" }: { cards: SubjectCardView[]; filters: ContentFilters; /** The Day / Week / Month label the counts are for. */ period?: string | null; /** The page the grid is on (the sort chips link to it). */ base?: string }) {
  const hidden = new URLSearchParams(contentQuery({ ...filters, q: undefined, sort: "recent" }).slice(1));
  // The sort chips keep every other filter (and the search words: contentQuery keeps ?q=), and change only ?sort=.
  const current = Object.fromEntries(new URLSearchParams(contentQuery({ ...filters, sort: "recent" }).slice(1)));
  return (
    <section aria-labelledby="subjects-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <h2 id="subjects-heading" className="text-xl font-semibold tracking-[-0.02em]">
            Products, campaigns and more
          </h2>
          {period && <p className="text-[14px] text-muted">Posts for {period}</p>}
        </div>
      </div>
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        {[...hidden.entries()].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" name="q" defaultValue={filters.q ?? ""} aria-label="Search products and campaigns" placeholder="Search products and campaigns" className="pl-10" />
        </div>
        {filters.sort !== "recent" && <input type="hidden" name="sort" value={filters.sort} />}
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      <FilterChips label="Sort" param="sort" base={base} params={current} current={filters.sort} allValue="recent" options={SUBJECT_SORTS.map((s) => ({ value: s, label: SUBJECT_SORT_LABEL[s] }))} />

      {cards.length === 0 ? (
        <GlassCard className="flex flex-col items-start gap-3 px-5 py-8">
          <p className="text-[15px] text-muted">{period ? `No posts for ${period} match. Try another day, week or month, or clear the filters.` : "Nothing matches. Try another word or clear the filters."}</p>
          <Button href={base} variant="outline" size="sm">
            Clear filters
          </Button>
        </GlassCard>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {cards.map((c) => {
            const Icon = ICON[c.kind];
            const today = c.madeToday > 0;
            return (
              <li key={c.key} className={cn(today && "bp-today-glow")}>
                <Link href={`${c.href}${drillQuery(filters)}`} className="glass group flex h-full flex-col overflow-hidden rounded-card transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-soft">
                    {c.coverUrl ? (
                      // Signed storage URL: plain lazy <img>.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                    ) : (
                      <span aria-hidden className="flex size-full items-center justify-center bg-brand-gradient text-white">
                        <Icon className="size-10" />
                      </span>
                    )}
                    {today && (
                      <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-2.5 py-1 text-[12px] font-semibold text-white shadow-[0_6px_18px_-8px_rgba(47,107,255,0.9)]">
                        <Sparkles aria-hidden className="size-3.5" />
                        Today&apos;s posts
                        <span className="sr-only">: {c.madeToday === 1 ? "1 post made today" : `${c.madeToday} posts made today`}</span>
                      </span>
                    )}
                    {c.counts.review > 0 && (
                      <span className="absolute top-3 right-3 rounded-full bg-[var(--bp-dialog)]/90 px-2.5 py-1 text-[12px] font-semibold text-new shadow-glass">{c.counts.review} to review</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <span className="text-[13px] font-medium text-muted">{c.label}</span>
                    <span className="line-clamp-2 text-[17px] font-semibold tracking-[-0.01em]">{c.name}</span>
                    <dl className="mt-auto grid grid-cols-3 gap-2 pt-2 text-center">
                      {(
                        [
                          ["Needs review", c.counts.review, "text-new"],
                          ["Scheduled", c.counts.scheduled, "text-ok"],
                          ["Posted", c.counts.posted, "text-success"],
                        ] as const
                      ).map(([label, n, tone]) => (
                        <div key={label} className="flex flex-col-reverse rounded-2xl bg-soft/60 px-1 py-2">
                          <dt className="text-[12px] text-muted">{label}</dt>
                          <dd className={`text-[17px] font-semibold ${n > 0 ? tone : "text-muted"}`}>{n}</dd>
                        </div>
                      ))}
                    </dl>
                    {(c.counts.failed > 0 || c.counts.expired > 0) && (
                      <span className="flex flex-wrap gap-x-3 text-[13px] font-medium">
                        {c.counts.failed > 0 && <span className="text-danger">{c.counts.failed} failed</span>}
                        {c.counts.expired > 0 && <span className="text-muted">{c.counts.expired} expired</span>}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
