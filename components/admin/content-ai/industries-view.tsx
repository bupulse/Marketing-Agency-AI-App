import Link from "next/link";
import { Briefcase, EyeOff, Plus, Sparkles, Store } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Button, buttonClasses, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { deleteIndustryAction, dismissSuggestionAction, restoreSuggestionAction, setIndustryActiveAction, setIndustryOrderAction } from "@/app/admin/(console)/(content)/industries/actions";
import { CARD, DataList, EmptyState, FilterChips, IconBadge, PageHeader, StatGrid, StatTile, StatusPill, type SearchParamsLike } from "../kit";
import { Section, notice } from "../ui";

export type IndustryRow = { id: string; name: string; slug: string; shortDescription: string; businesses: number; sortOrder: number; active: boolean };
export type SuggestionRow = { key: string; label: string; count: number; samples: string[] };
export const INDUSTRY_FILTERS = ["active", "hidden"] as const;

/**
 * Industries: three numbers, what clients typed after choosing "Other" (add it, or dismiss it), then the industries
 * themselves as a list (a table on a computer, cards on a phone) with chips for offered / hidden.
 */
export function IndustriesView({ industries, suggestions, dismissed, show, params, message }: { industries: IndustryRow[]; suggestions: SuggestionRow[]; dismissed: { key: string; label: string }[]; show: "" | (typeof INDUSTRY_FILTERS)[number]; params: SearchParamsLike; message: { notice?: string; error?: string } }) {
  const active = industries.filter((i) => i.active).length;
  const rows = show === "active" ? industries.filter((i) => i.active) : show === "hidden" ? industries.filter((i) => !i.active) : industries;
  return (
    <>
      <PageHeader
        icon={Briefcase}
        tone="pink"
        title="Industries"
        description="The business sectors offered at sign-up, with the guidance the AI writes from. A company's own description is added to this in every prompt. An industry in use is hidden, never deleted."
        actions={<Link href="/admin/industries/new" className={buttonClasses({ size: "md" })}><Plus aria-hidden className="size-4" /> New industry</Link>}
      />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      <StatGrid cols={3}>
        <StatTile icon={Store} tone="pink" label="Offered at sign-up" value={String(active)} hint="Clients pick one of these when they sign up." href="/admin/industries?show=active" />
        <StatTile icon={EyeOff} tone="pink" label="Hidden" value={String(industries.length - active)} hint="Kept for the companies using them, not offered." href="/admin/industries?show=hidden" />
        <StatTile icon={Sparkles} tone="pink" label="New from sign-ups" value={String(suggestions.length)} alert={suggestions.length > 0} hint="Sectors clients typed after choosing “Other”." className="max-lg:col-span-2" />
      </StatGrid>

      {(suggestions.length > 0 || dismissed.length > 0) && (
        <Section title="New from sign-ups" description="What clients typed after choosing “Other”, grouped. Add one as an industry and those companies move to it; dismiss what does not belong.">
          {suggestions.length === 0 ? (
            <EmptyState tone="good" title="Nothing new from sign-ups." hint="Companies that choose “Other” appear here." />
          ) : (
            <ul className="kit-rise grid items-start gap-3 lg:grid-cols-2">
              {suggestions.map((s) => (
                <li key={s.key} className={cn("flex min-w-0 flex-col gap-3 p-4 sm:p-5", CARD)}>
                  <div className="flex items-start gap-3">
                    <IconBadge icon={Sparkles} tone="pink" size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold">{s.label}</p>
                      <p className="text-[12.5px] text-muted">{s.count} {s.count === 1 ? "company" : "companies"} wrote this</p>
                    </div>
                  </div>
                  {s.samples.length > 0 && (
                    <ul className="flex flex-col gap-1 text-[13px] text-muted">
                      {s.samples.slice(0, 3).map((t) => (<li key={t} className="truncate rounded-xl bg-soft/70 px-3 py-1.5 dark:bg-white/[0.04]">“{t}”</li>))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <Button href={`/admin/industries/new?from=${encodeURIComponent(s.key)}`} size="sm">Add as industry</Button>
                    <ConfirmButton action={dismissSuggestionAction} fields={{ key: s.key }} label="Dismiss" title={`Dismiss “${s.label}”?`} description="It leaves this list; the companies keep what they typed. You can bring it back below." confirmLabel="Dismiss" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {dismissed.length > 0 && (
            <details className={cn("px-4", CARD)}>
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Dismissed ({dismissed.length})</summary>
              <ul className="flex flex-wrap gap-2 pb-4">
                {dismissed.map((d) => (
                  <li key={d.key}>
                    <form action={restoreSuggestionAction} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-soft px-3 text-[13px]">
                      <input type="hidden" name="key" value={d.key} />
                      <span>{d.label}</span>
                      <button type="submit" className="min-h-10 font-semibold underline">Restore</button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>
      )}

      <Section title="All industries" description="Order: lower numbers come first in the sign-up list.">
        <FilterChips label="Show industries" param="show" base="/admin/industries" params={params} current={show} options={[{ value: "", label: "All", count: industries.length }, { value: "active", label: "Offered", count: active }, { value: "hidden", label: "Hidden", count: industries.length - active }]} />
        <div className={cn("p-4 sm:p-5 max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none", CARD)}>
          <DataList<IndustryRow>
            caption="Industries"
            rows={rows}
            rowKey={(i) => i.id}
            rowHref={(i) => `/admin/industries/${encodeURIComponent(i.id)}`}
            columns={[
              { key: "name", header: "Industry", primary: true, cell: (i) => i.name },
              { key: "about", header: "Short description", hideOnPhone: true, className: "max-w-[320px]", cell: (i) => <span className="line-clamp-2 text-[13px] font-normal text-muted">{i.shortDescription}</span> },
              { key: "companies", header: "Companies", align: "right", cell: (i) => i.businesses },
              { key: "status", header: "Status", cell: (i) => <StatusPill tone={i.active ? "good" : "muted"} dot>{i.active ? "Offered" : "Hidden"}</StatusPill> },
              {
                key: "order",
                header: "Order",
                cell: (i) => (
                  <form action={setIndustryOrderAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={i.id} />
                    <Input name="sortOrder" type="number" defaultValue={i.sortOrder} min={-1000} max={1000} aria-label={`Order of ${i.name}`} className="min-h-10 w-20 py-1.5 text-[13px]" />
                    <Button type="submit" size="sm" variant="ghost">Set</Button>
                  </form>
                ),
              },
              {
                key: "actions",
                header: <span className="sr-only">Actions</span>,
                cell: (i) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setIndustryActiveAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="active" value={i.active ? "false" : "true"} />
                      <Button type="submit" size="sm" variant="outline">{i.active ? "Hide" : "Offer again"}</Button>
                    </form>
                    {i.businesses === 0 && <ConfirmButton action={deleteIndustryAction} fields={{ id: i.id }} label="Delete" title={`Delete ${i.name}?`} description="No company uses it. This removes it for good (written to the audit log)." confirmLabel="Delete" />}
                  </div>
                ),
              },
            ]}
            empty={<EmptyState icon={Briefcase} title={industries.length ? "No industry in this list." : "No industries yet."} hint={industries.length ? "Pick another chip above." : "The migration seeds thirteen; create one with New industry."} />}
          />
        </div>
      </Section>
    </>
  );
}
