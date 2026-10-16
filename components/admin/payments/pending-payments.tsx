import Link from "next/link";
import { ConfirmButton, type ConfirmResult } from "@/components/admin/confirm-button";
import { Badge, Field, Input, Textarea } from "@/components/ui";
import { dateTime, money } from "@/lib/admin/format";
import type { ManualPaymentAdminView } from "@/lib/billing/momo";

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

function Who({ p }: { p: ManualPaymentAdminView }) {
  return (
    <>
      <Link href={`/admin/users/${p.userId}`} className="font-medium underline">{p.company ?? "A company"}</Link>
      {p.email && <span className="block truncate text-[13px] text-muted">{p.email}</span>}
    </>
  );
}

export function PendingPaymentList({ items, canApprove, confirmAction, rejectAction }: { items: ManualPaymentAdminView[]; canApprove: boolean; confirmAction: (f: FormData) => Promise<ConfirmResult>; rejectAction: (f: FormData) => Promise<ConfirmResult> }) {
  const confirmPaymentAction = confirmAction;
  const rejectPaymentAction = rejectAction;
  const proofUrls = new Map(items.filter((p) => p.proofPath).map((p) => [p.id, `/admin/payments/proof?id=${encodeURIComponent(p.id)}`] as const));
  const toCheck = items;
  return (
          <ul className="flex flex-col divide-y divide-line">
            {toCheck.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {money(p.amountMinor, p.currency)} · {p.planName} ({interval(p.interval)}) <Badge tone="violet">Pending</Badge>
                  </p>
                  <p className="text-[14px]">
                    Reference <span className="font-mono font-semibold">{p.reference}</span> · {p.transactionId ? <>transaction <span className="font-mono">{p.transactionId}</span></> : <span className="font-medium text-danger">no transaction id (the client could not find it: read it from the screenshot or your MoMo messages)</span>} · from {p.payerPhone} ({p.network})
                  </p>
                  {proofUrls.get(p.id) ? (
                    <a href={proofUrls.get(p.id) as string} target="_blank" rel="noreferrer" className="mt-2 inline-block" aria-label={`Open the screenshot of ${p.reference} full size`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a private screenshot served by the admin-only route */}
                      <img src={proofUrls.get(p.id) as string} alt={`Screenshot of the Mobile Money confirmation for ${p.reference}`} width={160} height={280} loading="lazy" className="h-auto max-h-72 w-40 rounded-lg border border-line bg-surface object-contain" />
                      <span className="block text-[13px] text-muted underline">Click to enlarge</span>
                    </a>
                  ) : (
                    <p className="text-[13px] text-muted">No screenshot.</p>
                  )}
                  <p className="text-[13px] text-muted"><Who p={p} /></p>
                  <p className="text-[13px] text-muted">Said paid {p.submittedAt ? dateTime(p.submittedAt) : ""} · started {dateTime(p.createdAt)}</p>
                  {p.periodNote?.mode === "replace" && <p className="text-[13px] font-medium text-danger">{periodText(p)}</p>}
                  {p.periodNote?.mode === "extend" && <p className="text-[13px] text-muted">{periodText(p)}</p>}
                  {p.seenBefore && (
                    <p role="alert" className="mt-1 rounded-xl bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">
                      Transaction id seen before on payment {p.seenBefore.reference} ({p.seenBefore.status}{p.seenBefore.sameCompany ? ", same company" : ", another company"}). Check it is not the same Mobile Money message used twice.
                    </p>
                  )}
                </div>
                {canApprove ? (
                <div className="flex gap-2">
                  <ConfirmButton action={rejectPaymentAction} fields={{ id: p.id }} label="Reject" pendingLabel="Rejecting…" title={`Reject ${p.reference}?`} description="The client sees your reason on their Billing page and by email, and can try again. Nothing else changes." confirmLabel="Reject">
                    <Field label="Reason the client will see" required><Textarea name="reason" minLength={3} maxLength={300} rows={3} required placeholder="We received no payment with this reference. Please check the number you paid to." /></Field>
                  </ConfirmButton>
                  <ConfirmButton action={confirmPaymentAction} fields={{ id: p.id }} variant="primary" label="Confirm" pendingLabel="Confirming…" title={`Confirm ${money(p.amountMinor, p.currency)} from ${p.company ?? "this client"}?`} description={`Only after you have seen ${p.reference} arrive. ${periodText(p)} The client is emailed.`} confirmLabel="Confirm payment">
                    {!p.transactionId && (
                      <Field label="Transaction id from your MoMo message" hint="The client could not find it. It is required: it stops one payment being used twice." required>
                        <Input name="transactionId" minLength={4} maxLength={40} required autoComplete="off" />
                      </Field>
                    )}
                  </ConfirmButton>
                </div>
                ) : (
                  <Badge tone="neutral">Finance or the owner approves</Badge>
                )}
              </li>
            ))}
          </ul>
  );
}
