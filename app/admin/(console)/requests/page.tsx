import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { Panel, notice } from "@/components/admin/ui";
import { Badge, Button, GlassCard, type BadgeTone } from "@/components/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, param } from "@/lib/admin/format";
import { featureLabel } from "@/lib/features";
import { listPlanRequests } from "@/lib/offers/requests";
import { isRequestStatus, REQUEST_STATUS_LABEL, REQUEST_STATUSES } from "@/lib/offers/shared";
import { setRequestStatusAction } from "./actions";

export const metadata = { title: "Plan requests" };
export const dynamic = "force-dynamic";

const TONE: Record<string, BadgeTone> = { new: "violet", contacted: "blue", offered: "success", closed: "neutral" };
const SOURCE: Record<string, string> = { billing: "Billing", pricing: "Pricing page", upgrade: "Add to your plan", demo: "Demo screen" };

export default async function PlanRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const status = isRequestStatus(param(sp.status)) ? param(sp.status) : "";
  const open = param(sp.open);
  const requests = await listPlanRequests({ status: status || undefined });
  const qs = (s: string) => `/admin/requests${s ? `?status=${s}` : ""}`;

  return (
    <>
      <PageHeader title="Plan requests" description="Clients asking for a custom plan, from the pricing page, Billing, Add to your plan or the demo screen. Open the company, then Customise plan: the editor starts with the features they asked about." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      <Panel
        title={`${requests.length} ${requests.length === 1 ? "request" : "requests"}`}
        action={
          <nav aria-label="Status" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
            {["", ...REQUEST_STATUSES].map((s) => (
              <Link key={s || "all"} href={qs(s)} aria-current={status === s ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium no-underline ${status === s ? "bg-surface text-text shadow-glass" : "text-muted"}`}>
                {s ? REQUEST_STATUS_LABEL[s as keyof typeof REQUEST_STATUS_LABEL] : "All"}
              </Link>
            ))}
          </nav>
        }
      >
        {requests.length === 0 ? (
          <EmptyState icon={MessageSquarePlus} title="No requests here" text="Clients send them from Billing, the pricing page and the demo screen." />
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((r) => (
              <li key={r.id} id={`request-${r.id}`}>
                <GlassCard className={`flex flex-col gap-3 p-4 sm:p-5 ${open === r.id ? "ring-2 ring-pulse-blue" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {r.businessId ? <Link href={`/admin/companies/${r.businessId}`} className="font-semibold underline">{r.companyName}</Link> : <strong>{r.companyName}</strong>}
                      <p className="text-[13px] text-muted">{[r.name, r.email, r.phone].filter(Boolean).join(" · ")} · {dateTime(r.createdAt)} · from {SOURCE[r.source] ?? r.source}{r.demoBookingId ? " · has a demo booked" : ""}</p>
                    </div>
                    <Badge tone={TONE[r.status] ?? "neutral"}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
                    <div><dt className="text-[13px] text-muted">The business</dt><dd className="whitespace-pre-line break-words">{r.description}</dd></div>
                    <div><dt className="text-[13px] text-muted">Goals</dt><dd className="whitespace-pre-line break-words">{r.goals}</dd></div>
                    <div><dt className="text-[13px] text-muted">Interested in</dt><dd>{r.features.map(featureLabel).join(", ") || "Not said"}</dd></div>
                    <div><dt className="text-[13px] text-muted">Budget</dt><dd>{r.budgetLabel ?? "Not said"}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {r.businessId && <Button href={`/admin/offers/new?businessId=${r.businessId}&request=${r.id}`} size="sm">Customise plan</Button>}
                    {REQUEST_STATUSES.filter((s) => s !== r.status && s !== "offered").map((s) => (
                      <form key={s} action={setRequestStatusAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value={s} />
                        <Button type="submit" variant="outline" size="sm">Mark {REQUEST_STATUS_LABEL[s].toLowerCase()}</Button>
                      </form>
                    ))}
                  </div>
                </GlassCard>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
