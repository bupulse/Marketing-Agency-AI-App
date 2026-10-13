import Link from "next/link";
import { Smartphone } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Field, Input, Textarea } from "@/components/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, money, param } from "@/lib/admin/format";
import { listManualPayments, type ManualPaymentAdminView } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured, mtnMomoPayDial } from "@/lib/billing/momo-shared";
import { listUnprocessedPaddleEvents } from "@/lib/billing/paddle-events";
import { confirmPaymentAction, rejectPaymentAction, reprocessCardEventAction } from "./actions";

export const metadata = { title: "Payments" };

const tone = (s: string) => (s === "confirmed" ? "success" : s === "rejected" ? "danger" : s === "pending" ? "violet" : "neutral") as "success" | "danger" | "violet" | "neutral";
const interval = (i: string) => (i === "YEAR" ? "yearly" : "monthly");
const day = (iso: string) => dateTime(iso).replace(/, \d\d:\d\d.*/, "");

/** What confirming does to the client's running period, for the dialog and the row. */
function periodText(p: ManualPaymentAdminView): string {
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

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [pendingPage, history, settings, cardEvents] = await Promise.all([
    listManualPayments({ status: "pending", limit: 100 }),
    listManualPayments({ limit: 100 }),
    getMomoSettings(),
    listUnprocessedPaddleEvents(),
  ]);
  const toCheck = pendingPage.items.filter((p) => p.submitted);
  const started = pendingPage.items.filter((p) => !p.submitted);
  const decided = history.items.filter((p) => p.status !== "pending");
  // The screenshots of the payments to check, through the admin-only route (re-sniffed, nosniff; the bucket is private).
  const proofUrls = new Map(toCheck.filter((p) => p.proofPath).map((p) => [p.id, `/admin/payments/proof?id=${encodeURIComponent(p.id)}`] as const));
  const dial = mtnMomoPayDial(settings.merchantCode);

  return (
    <>
      <PageHeader title="Payments" description="Mobile Money payments clients made by hand. Check the reference against your MoMo or Airtel messages, then confirm (the plan switches on and the client is emailed) or reject with a reason the client will see." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {!momoConfigured(settings) && (
        <p role="alert" className={notice.bad}>Clients are not offered Mobile Money yet: fill in a MoMo Pay code or a number in <Link href="/admin/settings#momo" className="underline">Settings → Payments</Link>.</p>
      )}

      {toCheck.length === 0 ? (
        <EmptyState icon={Smartphone} title="Nothing to check" text="When a client pays by Mobile Money and taps I've paid, it appears here with the reference and transaction id." />
      ) : (
        <Panel title={`To check (${toCheck.length})`} description="Oldest first. The client is waiting on their Billing page.">
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
                <div className="flex gap-2">
                  <ConfirmButton action={rejectPaymentAction} fields={{ id: p.id }} label="Reject" title={`Reject ${p.reference}?`} description="The client sees your reason on their Billing page and by email, and can try again. Nothing else changes." confirmLabel="Reject">
                    <Field label="Reason the client will see" required><Textarea name="reason" minLength={3} maxLength={300} rows={3} required placeholder="We received no payment with this reference. Please check the number you paid to." /></Field>
                  </ConfirmButton>
                  <ConfirmButton action={confirmPaymentAction} fields={{ id: p.id }} variant="primary" label="Confirm" title={`Confirm ${money(p.amountMinor, p.currency)} from ${p.company ?? "this client"}?`} description={`Only after you have seen ${p.reference} arrive. ${periodText(p)} The client is emailed.`} confirmLabel="Confirm payment">
                    {!p.transactionId && (
                      <Field label="Transaction id from your MoMo message" hint="The client could not find it. It is required: it stops one payment being used twice." required>
                        <Input name="transactionId" minLength={4} maxLength={40} required autoComplete="off" />
                      </Field>
                    )}
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {started.length > 0 && (
        <Panel title={`Started, not paid yet (${started.length})`} description="The client saw the pay screen but has not tapped I've paid. Closed automatically after two days.">
          <TableWrap caption="Payments started">
            <thead><tr><Th>Company</Th><Th>Plan</Th><Th right>Amount</Th><Th>Reference</Th><Th>Started</Th></tr></thead>
            <tbody>
              {started.map((p) => (
                <tr key={p.id}>
                  <Td className="max-w-[14rem]"><Who p={p} /></Td>
                  <Td>{p.planName} ({interval(p.interval)})</Td>
                  <Td right>{money(p.amountMinor, p.currency)}</Td>
                  <Td><span className="font-mono">{p.reference}</span></Td>
                  <Td className="whitespace-nowrap">{dateTime(p.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      )}

      {cardEvents.length > 0 && (
        <div id="card-events">
          <Panel title={`Card events not applied (${cardEvents.length})`} description="Paddle sent these but BuPulse could not apply them yet (usually a price that is not synced with a plan). Fix the mapping, then Reprocess. Paddle's own retries also apply them.">
            <ul className="flex flex-col divide-y divide-line">
              {cardEvents.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-semibold">{e.type} <span className="font-mono text-[13px] font-normal text-muted">{e.eventId}</span></p>
                    <p className="text-[13px] text-muted">{dateTime(e.createdAt)}{e.error ? ` · ${e.error}` : ""}</p>
                  </div>
                  <ConfirmButton action={reprocessCardEventAction} fields={{ id: e.id }} label="Reprocess" title={`Reprocess ${e.type}?`} description="Runs the stored event again, once. The result is audited." confirmLabel="Reprocess" />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <Panel title="History" description="Confirmed, rejected and expired payments, newest first.">
        {decided.length === 0 ? (
          <Empty>No decided payments yet.</Empty>
        ) : (
          <TableWrap caption="Payment history">
            <thead><tr><Th>Company</Th><Th>Plan</Th><Th right>Amount</Th><Th>Reference</Th><Th>Transaction</Th><Th>Status</Th><Th>Decided</Th></tr></thead>
            <tbody>
              {decided.map((p) => (
                <tr key={p.id}>
                  <Td className="max-w-[14rem]"><Who p={p} /></Td>
                  <Td>{p.planName} ({interval(p.interval)})</Td>
                  <Td right>{money(p.amountMinor, p.currency)}</Td>
                  <Td><span className="font-mono">{p.reference}</span></Td>
                  <Td className="max-w-[10rem] truncate"><span className="font-mono">{p.transactionId ?? ""}</span>{p.payerPhone && <span className="block text-[13px] text-muted">{p.payerPhone}</span>}</Td>
                  <Td><Badge tone={tone(p.status)}>{p.status}</Badge>{p.rejectReason && <span className="block max-w-[16rem] text-[13px] text-muted">{p.rejectReason}</span>}</Td>
                  <Td className="whitespace-nowrap">{p.decidedAt ? dateTime(p.decidedAt) : ""}{p.periodEnd && <span className="block text-[13px] text-muted">paid until {dateTime(p.periodEnd).replace(/, \d\d:\d\d.*/, "")}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div id="settings">
        <Panel title="Where clients pay" description="The MoMo Pay code, numbers and account name are set in Settings, with card payments (Paddle).">
          <p className="text-[14px]">
            {settings.merchantCode ? <>MoMo Pay code <span className="font-mono font-semibold">{settings.merchantCode}</span>{dial ? <> (clients dial <span className="font-mono">{dial}</span>)</> : null}</> : "No MoMo Pay code"}
            {settings.momoNumber ? ` · MTN ${settings.momoNumber}` : ""}
            {settings.airtelNumber ? ` · Airtel ${settings.airtelNumber}` : ""}
            {settings.accountName ? ` · ${settings.accountName}` : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/settings#momo" className="text-sm font-semibold underline">Edit Mobile Money details</Link>
            <Link href="/admin/settings#paddle" className="text-sm font-semibold underline">Card payments (Paddle)</Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
