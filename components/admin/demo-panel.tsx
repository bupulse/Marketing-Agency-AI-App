import Link from "next/link";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel } from "@/components/admin/ui";
import { Badge, Button, Select, type BadgeTone } from "@/components/ui";
import { demoPanel } from "@/lib/admin/demos";
import { dateTime } from "@/lib/admin/format";
import { getRegions } from "@/lib/region";
import { companyRegionAction, demoStatusAction } from "@/app/admin/(console)/demos/actions";
import { ActivateAccount } from "./activate-account";

const SUB: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING_DEMO: { label: "Waiting for demo", tone: "violet" },
  TRIALING: { label: "On trial", tone: "blue" },
  ACTIVE: { label: "Paying", tone: "success" },
  PAST_DUE: { label: "Past due", tone: "danger" },
  CANCELED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};
const DEMO: Record<string, string> = { booked: "Booked", done: "Done", no_show: "No-show", cancelled: "Cancelled" };

/** The company page's "Demo and trial" panel: where the company is in the demo-first flow, its region, and the admin buttons. */
export async function DemoPanel({ businessId, back }: { businessId: string; back: string }) {
  const [p, regions] = await Promise.all([demoPanel(businessId), getRegions()]);
  const sub = p.subscription;
  const status = sub ? (SUB[sub.status] ?? { label: sub.status, tone: "neutral" as BadgeTone }) : null;
  const regionName = regions.find((r) => r.key === p.region)?.name ?? p.region ?? "GLOBAL";
  return (
    <Panel title="Demo and trial" description="New clients book a demo, then an admin activates the account: a trial, or an invoice to pay. Region decides the plans, prices and payment methods the company sees in Billing." action={status && <Badge tone={status.tone}>{status.label}</Badge>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        <dt className="text-muted">Plan chosen</dt>
        <dd>{p.chosenPlanName ?? <span className="text-muted">Not chosen yet</span>}</dd>
        <dt className="text-muted">Demo</dt>
        <dd>
          {p.booking ? (
            <>
              {p.booking.when} (Africa/Kigali) · {DEMO[p.booking.status] ?? p.booking.status}
              {p.booking.meetingLink && p.booking.status === "booked" && (
                <>
                  {" · "}
                  <a href={p.booking.meetingLink} target="_blank" rel="noreferrer noopener" className="underline">Join</a>
                </>
              )}
              {p.booking.notes && <span className="block text-xs text-muted">{p.booking.notes}</span>}
            </>
          ) : (
            <span className="text-muted">None booked</span>
          )}
        </dd>
        {sub?.status === "TRIALING" && sub.trialEndsAt && (
          <>
            <dt className="text-muted">Trial ends</dt>
            <dd>{dateTime(sub.trialEndsAt)}</dd>
          </>
        )}
        <dt className="text-muted">Region</dt>
        <dd>
          <form action={companyRegionAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="back" value={back} />
            <Select name="regionKey" defaultValue={p.region ?? "GLOBAL"} aria-label="Region">
              {regions.filter((r) => r.active || r.key === p.region).map((r) => (
                <option key={r.key} value={r.key}>{r.name} ({r.key}, {r.currency})</option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="outline">Change region</Button>
            <span className="text-xs text-muted">Now: {regionName}. Audited.</span>
          </form>
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        {sub?.status === "PENDING_DEMO" && (
          <ActivateAccount businessId={businessId} back={back} businessName="this company" planName={p.chosenPlanName} trialDays={p.trialDays} interval="MONTH" />
        )}
        {p.booking?.status === "booked" && (
          <>
            <ConfirmButton action={demoStatusAction} fields={{ id: p.booking.id, status: "done", back }} label="Mark done" title="Mark the demo as done?" description="Written to the audit log." confirmLabel="Mark done" />
            <ConfirmButton action={demoStatusAction} fields={{ id: p.booking.id, status: "no_show", back }} label="No-show" title="Mark as a no-show?" description="The client can book a new time from their dashboard. Written to the audit log." confirmLabel="Mark no-show" />
          </>
        )}
        <Link href="/admin/demos" className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline">All demos</Link>
        <Link href={`/admin/invoices?businessId=${encodeURIComponent(businessId)}`} className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline">Invoices</Link>
      </div>
    </Panel>
  );
}
