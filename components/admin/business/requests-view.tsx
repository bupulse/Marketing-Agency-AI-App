// Admin -> Clients -> Plan requests: clients asking for a custom plan, as cards (status chips on top). Plain data in,
// so the page and the dev preview render the same. Each card keeps its #request-<id> anchor (Demos and the company
// page link to it).
import Link from "next/link";
import { CalendarClock, MessageSquarePlus, Sparkles, Video } from "lucide-react";
import { CARD, EmptyState, FilterChips, PageHeader, StatusPill, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { Button } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import { featureLabel } from "@/lib/features";
import type { listPlanRequests } from "@/lib/offers/requests";
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from "@/lib/offers/shared";
import { cn } from "@/lib/cn";
import { Fact, Notices } from "./shared";

export type PlanRequestRow = Awaited<ReturnType<typeof listPlanRequests>>[number];

const TONE: Record<string, PillTone> = { new: "new", contacted: "info", offered: "good", closed: "muted" };
const SOURCE: Record<string, string> = { billing: "Billing", pricing: "Pricing page", upgrade: "Add to your plan", demo: "Demo screen" };
const CALL: Record<string, { label: string; tone: PillTone }> = {
  booked: { label: "Call booked", tone: "info" },
  done: { label: "Call done", tone: "good" },
  no_show: { label: "Call: no-show", tone: "bad" },
  cancelled: { label: "Call cancelled", tone: "muted" },
};

export function RequestsView({ requests, status, open, sp, setStatusAction }: { requests: PlanRequestRow[]; status: string; open: string; sp: SearchParamsLike; setStatusAction: (f: FormData) => Promise<void> }) {
  return (
    <>
      <PageHeader icon={MessageSquarePlus} tone="blue" title="Plan requests" description="Clients asking for a custom plan. Open the company, then Customise plan: the editor starts with the features they asked about." />
      <Notices sp={sp} />
      <FilterChips
        label="Status"
        param="status"
        base="/admin/requests"
        current={status}
        options={[{ value: "", label: "All" }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABEL[s] }))]}
      />
      <p className="px-1 text-[13px] text-muted">
        {requests.length} {requests.length === 1 ? "request" : "requests"}. They come from the pricing page, Billing, Add to your plan and the demo screen.
      </p>
      {requests.length === 0 ? (
        <EmptyState icon={MessageSquarePlus} title="No requests here" hint="Clients send them from Billing, the pricing page and the demo screen." />
      ) : (
        <ul className="kit-rise grid gap-3 xl:grid-cols-2">
          {requests.map((r) => (
            <li key={r.id} id={`request-${r.id}`} className="scroll-mt-24">
              <article className={cn("flex h-full flex-col gap-3.5 p-4 sm:p-5", CARD, open === r.id && "ring-2 ring-pulse-blue")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-bold leading-snug">
                      {r.businessId ? <Link href={`/admin/companies/${r.businessId}`} className="underline-offset-2 hover:underline">{r.companyName}</Link> : r.companyName}
                    </h2>
                    <p className="text-[13px] text-muted">{[r.name, r.email, r.phone].filter(Boolean).join(" · ")}</p>
                    <p className="text-[12.5px] text-muted">{dateTime(r.createdAt)} · from {SOURCE[r.source] ?? r.source}{r.demoBookingId ? " · has a demo booked" : ""}</p>
                  </div>
                  <StatusPill tone={TONE[r.status] ?? "muted"} dot>{REQUEST_STATUS_LABEL[r.status]}</StatusPill>
                </div>
                {r.call && (
                  <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft/60 px-3 py-2 text-[14px]">
                    <CalendarClock aria-hidden className="size-4 text-muted" />
                    <StatusPill tone={CALL[r.call.status]?.tone ?? "muted"}>{CALL[r.call.status]?.label ?? `Call: ${r.call.status}`}</StatusPill>
                    <span>{r.call.when} (Kigali)</span>
                    {r.call.status === "booked" && r.call.meetingLink && (
                      <a href={r.call.meetingLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">
                        <Video aria-hidden className="size-3.5" /> Join
                      </a>
                    )}
                    <Link href="/admin/demos?when=all" className="text-sm underline">Demos</Link>
                  </p>
                )}
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Fact label="The business" wide><span className="whitespace-pre-line">{r.description}</span></Fact>
                  {r.goals && <Fact label="Goals" wide><span className="whitespace-pre-line">{r.goals}</span></Fact>}
                  <Fact label="Interested in">{r.features.map(featureLabel).join(", ") || "Not said"}</Fact>
                  <Fact label="Budget">{r.budgetLabel ?? "Not said"}</Fact>
                </dl>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {r.businessId && <Button href={`/admin/offers/new?businessId=${r.businessId}&request=${r.id}`} size="sm" leading={<Sparkles aria-hidden className="size-4" />}>Customise plan</Button>}
                  {REQUEST_STATUSES.filter((s) => s !== r.status && s !== "offered").map((s) => (
                    <form key={s} action={setStatusAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value={s} />
                      <Button type="submit" variant="outline" size="sm">Mark {REQUEST_STATUS_LABEL[s].toLowerCase()}</Button>
                    </form>
                  ))}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
