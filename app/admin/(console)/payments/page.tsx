import Link from "next/link";
import { Smartphone } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, money, param } from "@/lib/admin/format";
import { listManualPayments, type ManualPaymentAdminView } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured } from "@/lib/billing/momo-shared";
import { confirmPaymentAction, rejectPaymentAction, savePaymentSettingsAction } from "./actions";

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
  const [pendingPage, history, settings] = await Promise.all([
    listManualPayments({ status: "pending", limit: 100 }),
    listManualPayments({ limit: 100 }),
    getMomoSettings(),
  ]);
  const toCheck = pendingPage.items.filter((p) => p.submitted);
  const started = pendingPage.items.filter((p) => !p.submitted);
  const decided = history.items.filter((p) => p.status !== "pending");

  return (
    <>
      <PageHeader title="Payments" description="Mobile Money payments clients made by hand. Check the reference against your MoMo or Airtel messages, then confirm (the plan switches on and the client is emailed) or reject with a reason the client will see." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {!momoConfigured(settings) && (
        <p role="alert" className={notice.bad}>Clients are not offered Mobile Money yet: fill in a MoMo Pay code or a number in the settings below.</p>
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
                    Reference <span className="font-mono font-semibold">{p.reference}</span> · transaction <span className="font-mono">{p.transactionId}</span> · from {p.payerPhone} ({p.network})
                  </p>
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
                  <ConfirmButton action={confirmPaymentAction} fields={{ id: p.id }} variant="primary" label="Confirm" title={`Confirm ${money(p.amountMinor, p.currency)} from ${p.company ?? "this client"}?`} description={`Only after you have seen ${p.reference} arrive. ${periodText(p)} The client is emailed.`} confirmLabel="Confirm payment" />
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
        <Panel title="Where clients pay" description="Shown on the client's pay screen and in reminder emails. Every change is audited and every admin address is told.">
          <form action={savePaymentSettingsAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="MoMo Pay merchant code" hint="From MTN, if you have one."><Input name="merchantCode" defaultValue={settings.merchantCode} maxLength={20} /></Field>
              <Field label="MTN MoMo number"><Input name="momoNumber" defaultValue={settings.momoNumber} maxLength={30} inputMode="tel" /></Field>
              <Field label="Account name" hint="The name clients see on their phone when they pay."><Input name="accountName" defaultValue={settings.accountName} maxLength={80} /></Field>
              <Field label="Airtel Money number"><Input name="airtelNumber" defaultValue={settings.airtelNumber} maxLength={30} inputMode="tel" /></Field>
            </div>
            <p className="text-[13px] text-muted">
              What clients pay is the plan&apos;s price in their region (Rwanda: Starter and Business in RWF), set under <Link href="/admin/settings/regions" className="underline">Regions and prices</Link>. The USD rate used to count Mobile Money revenue in dollars is in <Link href="/admin/settings" className="underline">Settings</Link>.
            </p>
            <Button type="submit" className="self-start">Save payment details</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
