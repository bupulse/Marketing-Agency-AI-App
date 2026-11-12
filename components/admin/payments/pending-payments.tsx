import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ImageOff, Smartphone } from "lucide-react";
import { ConfirmButton, type ConfirmResult } from "@/components/admin/confirm-button";
import { CARD, IconBadge, StatusPill } from "@/components/admin/kit";
import { Field, Input, Textarea } from "@/components/ui";
import { dateTime, money } from "@/lib/admin/format";
import type { ManualPaymentAdminView } from "@/lib/billing/momo";
import { cn } from "@/lib/cn";
import { vatBreakdown, type VatSettings } from "@/lib/billing/vat";

// The Mobile Money payments waiting for a decision: on Payments and at the top of the Overview. Approve and Reject run
// the same audited actions (payments.approve); without that permission the list is read-only. Each answers in words:
// the dialog closes, the notice shows and the page refreshes in place (components/admin/confirm-button.tsx).

const interval = (i: string) => (i === "YEAR" ? "yearly" : "monthly");
const day = (iso: string) => dateTime(iso).replace(/, \d\d:\d\d.*/, "");

/** What confirming does to the client's running period, for the dialog and the row. */
export function periodText(p: ManualPaymentAdminView): string {
  const n = p.periodNote;
  if (!n) return `The ${p.planName} plan switches on for one ${p.interval === "YEAR" ? "year" : "month"} from now.`;
  if (n.mode === "extend") return `Adds one ${p.interval === "YEAR" ? "year" : "month"} after the current period (${n.daysLeft} ${n.daysLeft === 1 ? "day" : "days"} left, until ${day(n.currentEnd)}).`;
  return `Plan change: replaces the current period (${n.daysLeft} ${n.daysLeft === 1 ? "day" : "days"} left, until ${day(n.currentEnd)}) with one ${p.interval === "YEAR" ? "year" : "month"} of ${p.planName} from now. Give credit manually if needed.`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[14px]">{children}</dd>
    </div>
  );
}

/**
 * One card per payment to check: the amount and plan, the reference and transaction id to compare with the MoMo
 * message, the screenshot, who paid, and Confirm / Reject.
 */
export function PendingPaymentList({ items, canApprove, confirmAction, rejectAction, vat = null }: { items: ManualPaymentAdminView[]; canApprove: boolean; confirmAction: (f: FormData) => Promise<ConfirmResult>; rejectAction: (f: FormData) => Promise<ConfirmResult>; /** The VAT settings: an RWF payment shows the VAT inside it (lib/billing/vat.ts). */ vat?: VatSettings | null }) {
  const confirmPaymentAction = confirmAction;
  const rejectPaymentAction = rejectAction;
  const proofUrls = new Map(items.filter((p) => p.proofPath).map((p) => [p.id, `/admin/payments/proof?id=${encodeURIComponent(p.id)}`] as const));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((p) => {
        const proof = proofUrls.get(p.id);
        const split = vat ? vatBreakdown(p.amountMinor, p.currency, vat) : null;
        return (
          <li key={p.id} className={cn("relative flex flex-col gap-4 overflow-hidden p-4 sm:flex-row sm:p-5", CARD, p.seenBefore && "ring-1 ring-danger/40")}>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <IconBadge icon={Smartphone} tone="green" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-[20px] font-bold leading-tight tabular-nums tracking-[-0.02em]">{money(p.amountMinor, p.currency)}</p>
                  {split && <p className="text-[12.5px] text-muted">VAT included: {money(split.vatMinor, p.currency)} VAT ({split.ratePercent}%) + {money(split.netMinor, p.currency)} before VAT</p>}
                  <p className="text-[13.5px] text-muted">
                    {p.planName} ({interval(p.interval)}) · <Link href={`/admin/users/${p.userId}`} className="font-semibold text-text underline-offset-2 hover:underline">{p.company ?? "A company"}</Link>
                  </p>
                </div>
                <StatusPill tone="new" dot>Pending</StatusPill>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-soft/70 p-3">
                <Fact label="Reference"><span className="font-mono font-semibold">{p.reference}</span></Fact>
                <Fact label="Transaction">
                  {p.transactionId ? <span className="font-mono">{p.transactionId}</span> : <span className="font-medium text-danger">no transaction id (the client could not find it: read it from the screenshot or your MoMo messages)</span>}
                </Fact>
                <Fact label="Paid from">{p.payerPhone} ({p.network})</Fact>
                <Fact label="Said paid">{p.submittedAt ? dateTime(p.submittedAt) : ""}</Fact>
              </dl>
              <p className="text-[13px] text-muted">
                {p.email ? <span className="break-all">{p.email} · </span> : null}started {dateTime(p.createdAt)}
              </p>
              {p.periodNote?.mode === "replace" && <p className="text-[13px] font-medium text-danger">{periodText(p)}</p>}
              {p.periodNote?.mode === "extend" && <p className="text-[13px] text-muted">{periodText(p)}</p>}
              {p.seenBefore && (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>Transaction id seen before on payment {p.seenBefore.reference} ({p.seenBefore.status}{p.seenBefore.sameCompany ? ", same company" : ", another company"}). Check it is not the same Mobile Money message used twice.</span>
                </p>
              )}
              {canApprove ? (
                <div className="flex flex-wrap gap-2">
                  <ConfirmButton action={confirmPaymentAction} fields={{ id: p.id }} variant="primary" label="Confirm" pendingLabel="Confirming…" title={`Confirm ${money(p.amountMinor, p.currency)} from ${p.company ?? "this client"}?`} description={`Only after you have seen ${p.reference} arrive. ${periodText(p)} The client is emailed.`} confirmLabel="Confirm payment">
                    {!p.transactionId && (
                      <Field label="Transaction id from your MoMo message" hint="The client could not find it. It is required: it stops one payment being used twice." required>
                        <Input name="transactionId" minLength={4} maxLength={40} required autoComplete="off" />
                      </Field>
                    )}
                  </ConfirmButton>
                  <ConfirmButton action={rejectPaymentAction} fields={{ id: p.id }} label="Reject" pendingLabel="Rejecting…" title={`Reject ${p.reference}?`} description="The client sees your reason on their Billing page and by email, and can try again. Nothing else changes." confirmLabel="Reject">
                    <Field label="Reason the client will see" required><Textarea name="reason" minLength={3} maxLength={300} rows={3} required placeholder="We received no payment with this reference. Please check the number you paid to." /></Field>
                  </ConfirmButton>
                </div>
              ) : (
                <StatusPill tone="muted" className="self-start">Finance or the owner approves</StatusPill>
              )}
            </div>
            {proof ? (
              <a href={proof} target="_blank" rel="noreferrer" className="flex shrink-0 flex-col items-center gap-1 self-start rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-blue/30" aria-label={`Open the screenshot of ${p.reference} full size`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private screenshot served by the admin-only route */}
                <img src={proof} alt={`Screenshot of the Mobile Money confirmation for ${p.reference}`} width={160} height={280} loading="lazy" className="h-auto max-h-72 w-40 rounded-2xl border border-line bg-surface object-contain" />
                <span className="text-[12.5px] text-muted underline">Click to enlarge</span>
              </a>
            ) : (
              <p className="flex shrink-0 items-center gap-1.5 self-start rounded-2xl bg-soft px-3 py-2 text-[13px] text-muted"><ImageOff aria-hidden className="size-4" /> No screenshot.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
