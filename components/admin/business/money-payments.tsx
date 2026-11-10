import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Clock3, CreditCard, History, Settings2, Smartphone } from "lucide-react";
import { ConfirmButton, type ConfirmResult } from "@/components/admin/confirm-button";
import { PendingPaymentList } from "@/components/admin/payments/pending-payments";
import { DataList, EmptyState, FilterChips, HashRedirect, SectionCard, SectionGrid, StatusPill, type PillTone, type SearchParamsLike } from "@/components/admin/kit";
import { notice, Panel, Section } from "@/components/admin/ui";
import { buttonClasses } from "@/components/ui";
import { dateTime } from "@/lib/admin/format";
import type { ManualPaymentAdminView } from "@/lib/billing/momo";
import type { getMomoSettings } from "@/lib/billing/momo-settings";
import { momoConfigured, mtnMomoPayDial } from "@/lib/billing/momo-shared";
import type { listUnprocessedPaddleEvents } from "@/lib/billing/paddle-events";
import { reprocessCardEventAction } from "@/app/admin/(console)/(money)/payments/actions";

// Admin -> Money -> Payments: the payments to check on the main page, and one page each for payments started but not
// paid, card events not applied, and the history. Plain data in: the pages load it, the dev preview passes made-up rows.

export type MomoSettings = Awaited<ReturnType<typeof getMomoSettings>>;
export type CardEvent = Awaited<ReturnType<typeof listUnprocessedPaddleEvents>>[number];

const interval = (i: string) => (i === "YEAR" ? "yearly" : "monthly");
const STATUS_TONE: Record<string, PillTone> = { confirmed: "good", rejected: "bad", pending: "new", expired: "muted" };

function Who({ p }: { p: ManualPaymentAdminView }) {
  return (
    <span className="flex min-w-0 flex-col">
      <Link href={`/admin/users/${p.userId}`} className="truncate font-semibold underline-offset-2 hover:underline">{p.company ?? "A company"}</Link>
      {p.email && <span className="truncate text-[12.5px] font-normal text-muted">{p.email}</span>}
    </span>
  );
}

/** Where clients pay: the MoMo Pay code, numbers and account name, with links to change them in Settings. */
export function WhereClientsPay({ settings }: { settings: MomoSettings }) {
  const dial = mtnMomoPayDial(settings.merchantCode);
  const facts: [string, ReactNode][] = [
    ["MoMo Pay code", settings.merchantCode ? <><span className="font-mono font-semibold">{settings.merchantCode}</span>{dial ? <span className="block text-[12.5px] text-muted">Clients dial <span className="font-mono">{dial}</span></span> : null}</> : <span className="text-muted">None</span>],
    ["MTN number", settings.momoNumber || <span className="text-muted">None</span>],
    ["Airtel number", settings.airtelNumber || <span className="text-muted">None</span>],
    ["Account name", settings.accountName || <span className="text-muted">None</span>],
  ];
  return (
    <Panel id="settings" icon={Settings2} tone="green" title="Where clients pay" description="The Mobile Money details clients see on Billing. Change them in Settings, with card payments (Paddle).">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-soft/70 p-3">
            <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-[14px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/settings#momo" className={buttonClasses({ variant: "outline", size: "sm" })}>Edit Mobile Money details</Link>
        <Link href="/admin/settings#paddle" className={buttonClasses({ variant: "outline", size: "sm" })}>Card payments (Paddle)</Link>
      </div>
    </Panel>
  );
}

/** The Payments main page: what to check now, a card for each other list, and where clients pay. */
export function PaymentsOverview({
  toCheck,
  started,
  cardEvents,
  decided,
  settings,
  canApprove,
  confirmAction,
  rejectAction,
}: {
  toCheck: ManualPaymentAdminView[];
  started: ManualPaymentAdminView[];
  cardEvents: CardEvent[];
  decided: ManualPaymentAdminView[];
  settings: MomoSettings;
  canApprove: boolean;
  confirmAction: (f: FormData) => Promise<ConfirmResult>;
  rejectAction: (f: FormData) => Promise<ConfirmResult>;
}) {
  const confirmed = decided.filter((p) => p.status === "confirmed").length;
  return (
    <>
      <HashRedirect to={{ "card-events": "/admin/payments/card-events" }} />
      {!momoConfigured(settings) && (
        <p role="alert" className={notice.bad}>Clients are not offered Mobile Money yet: fill in a MoMo Pay code or a number in <Link href="/admin/settings#momo" className="underline">Settings → Payments</Link>.</p>
      )}
      <Section title={toCheck.length ? `To check (${toCheck.length})` : "To check"} description="Oldest first. The client is waiting on their Billing page. Compare the reference with your MoMo or Airtel messages, then confirm or reject.">
        {toCheck.length === 0 ? (
          <EmptyState icon={CheckCircle2} tone="good" title="Nothing to check" hint="When a client pays by Mobile Money and taps I've paid, it appears here with the reference and transaction id." />
        ) : (
          <PendingPaymentList items={toCheck} canApprove={canApprove} confirmAction={confirmAction} rejectAction={rejectAction} />
        )}
      </Section>
      <Section title="More about payments" description="Each list on its own page.">
        <SectionGrid>
          <SectionCard row href="/admin/payments/started" icon={Clock3} tone="green" title="Started, not paid yet" hint="Clients who saw the pay screen but have not tapped I've paid. Closed after two days." value={String(started.length)} valueLabel={started.length === 1 ? "payment started" : "payments started"} />
          <SectionCard row
            href="/admin/payments/card-events"
            icon={CreditCard}
            tone="green"
            title="Card events not applied"
            hint="Paddle sent these but BuPulse could not apply them yet. Fix the mapping, then Reprocess."
            value={String(cardEvents.length)}
            valueLabel={cardEvents.length === 1 ? "event waiting" : "events waiting"}
            count={cardEvents.length || undefined}
            countLabel={`${cardEvents.length} card events not applied`}
          />
          <SectionCard row href="/admin/payments/history" icon={History} tone="green" title="History" hint="Confirmed, rejected and expired payments, newest first." value={String(confirmed)} valueLabel="confirmed lately" />
        </SectionGrid>
      </Section>
      <WhereClientsPay settings={settings} />
    </>
  );
}

/** Payments started (the pay screen opened) but not reported paid. */
export function PaymentsStarted({ started, fx = BOOKS_FMT }: { started: ManualPaymentAdminView[]; fx?: MoneyFmt }) {
  return (
    <Panel icon={Clock3} tone="green" title={`Started, not paid yet (${started.length})`} description="The client saw the pay screen but has not tapped I've paid. Closed automatically after two days.">
      <DataList<ManualPaymentAdminView>
        caption="Payments started"
        rows={started}
        rowKey={(p) => p.id}
        columns={[
          { key: "who", header: "Company", cell: (p) => <Who p={p} />, primary: true },
          { key: "amount", header: "Amount", cell: (p) => <span className="font-semibold">{fx.el(p.amountMinor, p.currency)}</span>, align: "right" },
          { key: "plan", header: "Plan", cell: (p) => `${p.planName} (${interval(p.interval)})` },
          { key: "ref", header: "Reference", cell: (p) => <span className="font-mono">{p.reference}</span> },
          { key: "when", header: "Started", cell: (p) => <span className="whitespace-nowrap">{dateTime(p.createdAt)}</span>, hideOnPhone: true },
        ]}
        empty={<EmptyState icon={Clock3} title="No payments started." hint="When a client opens the Mobile Money pay screen, it shows here until they tap I've paid." />}
      />
    </Panel>
  );
}

/** Paddle events BuPulse could not apply yet, each with Reprocess. */
export function PaymentsCardEvents({ events }: { events: CardEvent[] }) {
  return (
    <Panel id="card-events" icon={CreditCard} tone="green" title={`Card events not applied (${events.length})`} description="Usually a price that is not synced with a plan. Fix the mapping, then Reprocess. Paddle's own retries also apply them.">
      {events.length === 0 ? (
        <EmptyState icon={CheckCircle2} tone="good" title="Every card event was applied." hint="Events Paddle sends that BuPulse cannot apply yet show here." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line p-3.5">
              <div className="min-w-0">
                <p className="font-semibold">{e.type} <span className="break-all font-mono text-[12.5px] font-normal text-muted">{e.eventId}</span></p>
                <p className="text-[13px] text-muted">{dateTime(e.createdAt)}{e.error ? ` · ${e.error}` : ""}</p>
              </div>
              <ConfirmButton action={reprocessCardEventAction} fields={{ id: e.id }} label="Reprocess" title={`Reprocess ${e.type}?`} description="Runs the stored event again, once. The result is audited." confirmLabel="Reprocess" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export const HISTORY_FILTERS = ["confirmed", "rejected", "expired"] as const;

/** Confirmed, rejected and expired payments, newest first, with a status filter. */
export function PaymentsHistory({ decided, status, sp, fx = BOOKS_FMT }: { decided: ManualPaymentAdminView[]; status: string; sp: SearchParamsLike; fx?: MoneyFmt }) {
  const count = (s: string) => decided.filter((p) => p.status === s).length;
  const rows = status ? decided.filter((p) => p.status === status) : decided;
  return (
    <>
      <FilterChips
        label="Show payments"
        param="status"
        base="/admin/payments/history"
        params={sp}
        current={status}
        options={[{ value: "", label: "All", count: decided.length }, { value: "confirmed", label: "Confirmed", count: count("confirmed") }, { value: "rejected", label: "Rejected", count: count("rejected") }, { value: "expired", label: "Expired", count: count("expired") }]}
      />
      <Panel icon={History} tone="green" title="History" description="Newest first. Rejected ones show the reason the client saw.">
        <DataList<ManualPaymentAdminView>
          caption="Payment history"
          rows={rows}
          rowKey={(p) => p.id}
          columns={[
            { key: "who", header: "Company", cell: (p) => <Who p={p} />, primary: true },
            { key: "amount", header: "Amount", cell: (p) => <span className="font-semibold">{fx.el(p.amountMinor, p.currency)}</span>, align: "right" },
            { key: "status", header: "Status", cell: (p) => <span className="flex flex-col items-start gap-1"><StatusPill tone={STATUS_TONE[p.status] ?? "muted"} dot>{p.status}</StatusPill>{p.rejectReason && <span className="max-w-[16rem] text-[12.5px] text-muted">{p.rejectReason}</span>}</span> },
            { key: "decided", header: "Decided", cell: (p) => <span className="whitespace-nowrap">{p.decidedAt ? dateTime(p.decidedAt).replace(/, \d\d:\d\d.*/, "") : ""}{p.periodEnd && <span className="block text-[12.5px] text-muted">paid until {dateTime(p.periodEnd).replace(/, \d\d:\d\d.*/, "")}</span>}</span> },
            { key: "plan", header: "Plan", cell: (p) => `${p.planName} (${interval(p.interval)})`, hideOnPhone: true },
            { key: "ref", header: "Reference", cell: (p) => <span className="font-mono">{p.reference}</span>, hideOnPhone: true },
            { key: "tx", header: "Transaction", cell: (p) => <span className="flex flex-col"><span className="font-mono">{p.transactionId ?? ""}</span>{p.payerPhone && <span className="text-[12.5px] text-muted">{p.payerPhone}</span>}</span>, hideOnPhone: true },
          ]}
          empty={<EmptyState icon={Smartphone} title={status ? "No payments with this status." : "No decided payments yet."} hint={status ? "Pick another filter above." : "Payments you confirm or reject show here."} />}
        />
      </Panel>
    </>
  );
}
