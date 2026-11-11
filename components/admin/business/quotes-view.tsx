// Admin -> Sales -> Quote requests: people who asked for a free quote, as cards with one-tap Call and WhatsApp. Plain
// data in, so the page and the dev preview render the same.
import { CheckCircle2, MessageCircle, PhoneCall, RotateCcw } from "lucide-react";
import { CARD, ExpandCard, FilterChips, EmptyState, PageHeader, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { Button } from "@/components/ui";
import { kigaliTime, sourceLabel } from "@/lib/lead-alerts/format";
import { formatPhone } from "@/lib/phone";
import type { QuoteFilter, listQuoteRequests } from "@/lib/quote/admin";
import { telHref, whatsappHref } from "@/lib/quote/phone";
import { cn } from "@/lib/cn";
import { Fact, MoreLink, Notices } from "./shared";

export type QuoteRow = Awaited<ReturnType<typeof listQuoteRequests>>["items"][number];

export function QuotesView({ items, filter, next, back, sp, setHandledAction }: { items: QuoteRow[]; filter: QuoteFilter; next: string | null; back: string; sp: SearchParamsLike; setHandledAction: (f: FormData) => Promise<void> }) {
  const qs = (f: QuoteFilter) => `/admin/quotes${f === "open" ? "" : `?show=${f}`}`;
  return (
    <>
      <PageHeader icon={PhoneCall} tone="orange" title="Quote requests" description="People who asked for a free quote on the website or from a bio link. Call them, then mark them called." />
      <Notices sp={sp} />
      <ExpandCard icon={PhoneCall} tone="orange" title="Where these come from" summary="The “Get a free quote” pop-up and bupulse.com/quote.">
        <p className="text-[14px] leading-relaxed">
          Rwanda visitors see a “Get a free quote” pop-up on the website, and anyone can open <strong>bupulse.com/quote</strong> from a bio link (add <code className="font-mono text-[13px]">?src=instagram</code> to see where people come from). Each request is emailed to the admins, and sent on Telegram once it is connected (Settings, Lead alerts).
        </p>
      </ExpandCard>
      <FilterChips label="Show" param="show" base="/admin/quotes" current={filter} allValue="open" options={[{ value: "open", label: "To call" }, { value: "handled", label: "Called" }, { value: "all", label: "All" }]} />
      <p className="px-1 text-[13px] text-muted">
        {items.length}
        {next ? "+" : ""} {items.length === 1 ? "request" : "requests"}{filter === "open" ? " waiting for a call, oldest first" : ""}.
      </p>
      {items.length === 0 ? (
        <EmptyState icon={PhoneCall} tone={filter === "open" ? "good" : "calm"} title={filter === "open" ? "Nobody waiting for a call" : "No requests here"} hint="Requests arrive from the “Get a free quote” pop-up and from bupulse.com/quote." />
      ) : (
        <ul className="kit-rise grid gap-3 xl:grid-cols-2">
          {items.map((q) => (
            <li key={q.id}>
              <article className={cn("flex h-full flex-col gap-3.5 p-4 sm:p-5", CARD, !q.handled && "ring-1 ring-[#f59e0b]/35")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words text-[16px] font-bold leading-snug">{q.businessName ?? q.name}</h2>
                    <p className="text-[13px] text-muted">
                      {q.name} · {kigaliTime(q.createdAt)}
                      {q.source ? ` · from ${sourceLabel(q.source)}` : ""}
                    </p>
                  </div>
                  <StatusPill tone={q.handled ? "muted" : "warn"} dot>{q.handled ? "Called" : "To call"}</StatusPill>
                </div>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Fact label="Phone">{q.phone ? <a href={telHref(q.phone)} className="font-semibold underline">{formatPhone(q.phone)}</a> : "Not given"}</Fact>
                  <Fact label="Email"><a href={`mailto:${q.email}`} className="break-all underline">{q.email}</a></Fact>
                  {q.note && <Fact label="Note" wide><span className="whitespace-pre-line">{q.note}</span></Fact>}
                  <Fact label="Lead of">{q.leadOf}</Fact>
                  {q.link && <Fact label="Came via link">{q.link}</Fact>}
                  {q.pageUrl && <Fact label="Sent from" wide><span className="break-all">{q.pageUrl}</span></Fact>}
                </dl>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {q.phone && (
                    <>
                      <Button href={telHref(q.phone)} size="sm" leading={<PhoneCall aria-hidden className="size-4" />}>Call</Button>
                      <Button href={whatsappHref(q.phone)} size="sm" variant="outline" target="_blank" rel="noreferrer noopener" leading={<MessageCircle aria-hidden className="size-4" />}>WhatsApp</Button>
                    </>
                  )}
                  <form action={setHandledAction}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="handled" value={q.handled ? "0" : "1"} />
                    <input type="hidden" name="back" value={back} />
                    <Button type="submit" variant="outline" size="sm" leading={q.handled ? <RotateCcw aria-hidden className="size-4" /> : <CheckCircle2 aria-hidden className="size-4" />}>{q.handled ? "Back to call" : "Mark called"}</Button>
                  </form>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <MoreLink href={next ? `${qs(filter)}${filter === "open" ? "?" : "&"}after=${encodeURIComponent(next)}` : null}>Older requests</MoreLink>
    </>
  );
}
