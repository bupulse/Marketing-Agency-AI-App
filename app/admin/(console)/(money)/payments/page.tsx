import Link from "next/link";
import { Smartphone } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { can, requirePermission } from "@/lib/admin/auth";
import { PendingPaymentList } from "@/components/admin/payments/pending-payments";
import { dateTime, money, param } from "@/lib/admin/format";
import { listManualPayments, type ManualPaymentAdminView } from "@/lib/billing/momo";
import { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured, mtnMomoPayDial } from "@/lib/billing/momo-shared";
import { listUnprocessedPaddleEvents } from "@/lib/billing/paddle-events";
import { confirmPaymentAction, rejectPaymentAction, reprocessCardEventAction } from "./actions";

export const metadata = { title: "Payments" };

const tone = (s: string) => (s === "confirmed" ? "success" : s === "rejected" ? "danger" : s === "pending" ? "violet" : "neutral") as "success" | "danger" | "violet" | "neutral";
const interval = (i: string) => (i === "YEAR" ? "yearly" : "monthly");

function Who({ p }: { p: ManualPaymentAdminView }) {
  return (
    <>
      <Link href={`/admin/users/${p.userId}`} className="font-medium underline">{p.company ?? "A company"}</Link>
      {p.email && <span className="block truncate text-[13px] text-muted">{p.email}</span>}
    </>
  );
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission(["payments.view", "payments.approve"]); // pages render alongside the layout, so check here too
  const canApprove = can(me, "payments.approve");
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
          <PendingPaymentList items={toCheck} canApprove={canApprove} back="/admin/payments" confirmAction={confirmPaymentAction} rejectAction={rejectPaymentAction} />
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
