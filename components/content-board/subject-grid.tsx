import Link from "next/link";
import { Megaphone, Package, Search, Sparkles } from "lucide-react";
import { Button, GlassCard, Input } from "@/components/ui";
import { contentQuery, SUBJECT_SORT_LABEL, SUBJECT_SORTS, type ContentFilters } from "@/lib/content-board/filters";
import type { SubjectCardView } from "@/lib/content-board/queries";

const ICON = { product: Package, campaign: Megaphone, general: Sparkles } as const;

/** The query a subject card links with: the post filters carry over, the grid's own search and sort do not. */
function drillQuery(f: ContentFilters) {
  return contentQuery({ ...f, q: undefined, sort: "recent" });
}

/**
 * The grid of products, campaigns and General. Search and sort are a plain GET form (works without JavaScript and
 * keeps the URL shareable); the other filters ride along as hidden fields.
 */
export function SubjectGrid({ cards, filters }: { cards: SubjectCardView[]; filters: ContentFilters }) {
  const hidden = new URLSearchParams(contentQuery({ ...filters, q: undefined, sort: "recent" }).slice(1));
  return (
    <section aria-labelledby="subjects-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <h2 id="subjects-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Products, campaigns and more
        </h2>
      </div>
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        {[...hidden.entries()].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" name="q" defaultValue={filters.q ?? ""} aria-label="Search products and campaigns" placeholder="Search products and campaigns" className="pl-10" />
        </div>
        <label className="sr-only" htmlFor="subject-sort">
          Sort
        </label>
        <select id="subject-sort" name="sort" defaultValue={filters.sort} className="min-h-11 rounded-[14px] border border-line bg-glass px-3 text-[15px] text-text">
          {SUBJECT_SORTS.map((s) => (
            <option key={s} value={s}>
              {SUBJECT_SORT_LABEL[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      {cards.length === 0 ? (
        <GlassCard className="flex flex-col items-start gap-3 px-5 py-8">
          <p className="text-[15px] text-muted">Nothing matches. Try another word or clear the filters.</p>
          <Button href="/dashboard/content" variant="outline" size="sm">
            Clear filters
          </Button>
        </GlassCard>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {cards.map((c) => {
            const Icon = ICON[c.kind];
            return (
              <li key={c.key}>
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
                    {c.counts.failed > 0 && <span className="text-[13px] font-medium text-danger">{c.counts.failed} failed</span>}
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
