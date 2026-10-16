import Link from "next/link";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Panel } from "@/components/admin/ui";
import { Badge, Button, Select, type BadgeTone } from "@/components/ui";
import { demoPanel } from "@/lib/admin/demos";
import { dateTime } from "@/lib/admin/format";
import { getRegions } from "@/lib/region";
import { companyRegionAction, demoStatusAction, dismissRegionMismatchAction } from "@/app/admin/(console)/(clients)/demos/actions";
import { ActivateAccount } from "./activate-account";
import { SubscriptionStatus } from "./subscription-status";
import { subscriptionSummary } from "@/lib/admin/subscription-summary";
import { prisma } from "@/lib/db";
import { getPlans } from "@/lib/plan-catalog";

const SUB: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING_DEMO: { label: "Waiting for demo", tone: "violet" },
  TRIALING: { label: "On trial", tone: "blue" },
  ACTIVE: { label: "Paying", tone: "success" },
  PAST_DUE: { label: "Past due", tone: "danger" },
  CANCELED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};
const SOURCE: Record<string, string> = { signup: "sign-up", momo: "a Mobile Money payment", card: "a card checkout" };
const DEMO: Record<string, string> = { booked: "Booked", done: "Done", no_show: "No-show", cancelled: "Cancelled" };

/** The company page's "Demo and trial" panel: where the company is in the demo-first flow, its region, and the admin buttons. */
export async function DemoPanel({ businessId, back }: { businessId: string; back: string }) {
  const [p, regions, plans, owner] = await Promise.all([demoPanel(businessId), getRegions(), getPlans(), prisma.business.findUnique({ where: { id: businessId }, select: { userId: true } })]);
  // The subscription as it is now: Activate account only while the company waits for its demo; past that, where it
  // stands, with links to Extend trial / Change plan in the actions below.
  const current = owner ? await prisma.subscription.findUnique({ where: { userId: owner.userId }, select: { status: true, plan: true, provider: true, interval: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } }) : null;
  const sub = current ?? p.subscription;
  const summary = current ? subscriptionSummary(current, (key) => plans.find((pl) => pl.key === key)?.name ?? key) : null;
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
        {summary && (
          <>
            <dt className="text-muted">Account</dt>
            <dd><SubscriptionStatus summary={summary} businessId={businessId} /></dd>
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
        {p.regionMismatch && (
          <>
            <dt className="text-muted">Region check</dt>
            <dd className="flex flex-col gap-1.5">
              <span>
                <Badge tone="danger">Check region</Badge>{" "}
                Seen from {p.regionMismatch.country} ({regions.find((r) => r.key === p.regionMismatch?.ipRegion)?.name ?? p.regionMismatch.ipRegion}, dearer prices) at {SOURCE[p.regionMismatch.source]}, {dateTime(p.regionMismatch.seenAt)}
                {p.regionMismatch.firstSeenAt !== p.regionMismatch.seenAt && <> (first {dateTime(p.regionMismatch.firstSeenAt)})</>}.
              </span>
              <span className="text-xs text-muted">The company signed up as {regionName}. Nothing was blocked. If it really is in {p.regionMismatch.country}, pick that region above and Change region; if not (travelling, a VPN), dismiss.</span>
              <ConfirmButton action={dismissRegionMismatchAction} fields={{ businessId, back }} label="Dismiss" title="Keep the company's region?" description="The flag is closed and this country is not raised again for this company. Written to the audit log." confirmLabel="Dismiss" />
            </dd>
          </>
        )}
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
