import Link from "next/link";
import { MessageCircle, PhoneCall } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel, notice } from "@/components/admin/ui";
import { Badge, Button, GlassCard } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { kigaliTime, sourceLabel } from "@/lib/lead-alerts/format";
import { formatPhone } from "@/lib/phone";
import { isQuoteFilter, listQuoteRequests, type QuoteFilter } from "@/lib/quote/admin";
import { telHref, whatsappHref } from "@/lib/quote/phone";
import { setQuoteHandledAction } from "./actions";

export const metadata = { title: "Quote requests" };
export const dynamic = "force-dynamic";

const FILTER_LABEL: Record<QuoteFilter, string> = { open: "To call", handled: "Called", all: "All" };

export default async function QuoteRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("requests"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const filter: QuoteFilter = isQuoteFilter(param(sp.show)) ? (param(sp.show) as QuoteFilter) : "open";
  const after = param(sp.after) || null;
  const { items, next } = await listQuoteRequests({ filter, after });
  const qs = (f: QuoteFilter) => `/admin/quotes${f === "open" ? "" : `?show=${f}`}`;
  const back = `${qs(filter)}${after ? `${filter === "open" ? "?" : "&"}after=${encodeURIComponent(after)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Quote requests"
        description="People who pressed “Get a free quote” on the website (Rwanda visitors) or opened /quote from a bio link. Each one is emailed to the admins, and sent on Telegram once it is connected (Settings, Lead alerts). Call them, then mark them called."
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <Panel
        title={`${items.length}${next ? "+" : ""} ${items.length === 1 ? "request" : "requests"}`}
        action={
          <nav aria-label="Show" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
            {(["open", "handled", "all"] as const).map((f) => (
              <Link key={f} href={qs(f)} aria-current={filter === f ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium no-underline ${filter === f ? "bg-surface text-text shadow-glass" : "text-muted"}`}>
                {FILTER_LABEL[f]}
              </Link>
            ))}
          </nav>
        }
      >
        {items.length === 0 ? (
          <EmptyState icon={PhoneCall} title={filter === "open" ? "Nobody waiting for a call" : "No requests here"} text="Requests arrive from the “Get a free quote” pop-up and from bupulse.com/quote (add ?src=instagram to the link in a bio to see where people come from)." />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((q) => (
              <li key={q.id}>
                <GlassCard className="flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="break-words">{q.businessName ?? q.name}</strong>
                      <p className="text-[13px] text-muted">
                        {q.name} · {kigaliTime(q.createdAt)}
                        {q.source ? ` · from ${sourceLabel(q.source)}` : ""}
                      </p>
                    </div>
                    <Badge tone={q.handled ? "neutral" : "danger"}>{q.handled ? "Called" : "To call"}</Badge>
                  </div>
                  <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
                    <div>
                      <dt className="text-[13px] text-muted">Phone</dt>
                      <dd>{q.phone ? <a href={telHref(q.phone)} className="font-semibold underline">{formatPhone(q.phone)}</a> : "Not given"}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-muted">Email</dt>
                      <dd className="break-all"><a href={`mailto:${q.email}`} className="underline">{q.email}</a></dd>
                    </div>
                    {q.note && (
                      <div className="sm:col-span-2">
                        <dt className="text-[13px] text-muted">Note</dt>
                        <dd className="whitespace-pre-line break-words">{q.note}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[13px] text-muted">Lead of</dt>
                      <dd>{q.leadOf}</dd>
                    </div>
                    {q.link && (
                      <div>
                        <dt className="text-[13px] text-muted">Came via link</dt>
                        <dd className="break-words">{q.link}</dd>
                      </div>
                    )}
                    {q.pageUrl && (
                      <div className="sm:col-span-2">
                        <dt className="text-[13px] text-muted">Sent from</dt>
                        <dd className="break-all">{q.pageUrl}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {q.phone && (
                      <>
                        <Button href={telHref(q.phone)} size="sm" leading={<PhoneCall aria-hidden className="size-4" />}>Call</Button>
                        <Button href={whatsappHref(q.phone)} size="sm" variant="outline" target="_blank" rel="noreferrer noopener" leading={<MessageCircle aria-hidden className="size-4" />}>WhatsApp</Button>
                      </>
                    )}
                    <form action={setQuoteHandledAction}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="handled" value={q.handled ? "0" : "1"} />
                      <input type="hidden" name="back" value={back} />
                      <Button type="submit" variant="outline" size="sm">{q.handled ? "Back to call" : "Mark called"}</Button>
                    </form>
                  </div>
                </GlassCard>
              </li>
            ))}
          </ul>
        )}
        {next && (
          <div className="mt-4">
            <Button href={`${qs(filter)}${filter === "open" ? "?" : "&"}after=${encodeURIComponent(next)}`} variant="outline" size="sm">Older requests</Button>
          </div>
        )}
      </Panel>
    </>
  );
}
