import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { CURRENCY_NAME } from "@/lib/money/display";
import { ArrowLeftRight, CalendarRange, Coins, Layers, Receipt, Repeat, TrendingDown, TrendingUp, UserRound, Users, Wallet } from "lucide-react";
import { money, num, pct } from "@/lib/admin/format";
import type { MoneyReport } from "@/lib/money/report";
import { MonthBars } from "../charts";
import { DataList, EmptyState, HashRedirect, SectionCard, SectionGrid, StatGrid, StatTile, StatusPill } from "../kit";
import { HowCalculated, Panel, Section } from "../ui";
import { monthLabel } from "./cost-tables";
import Link from "next/link";

const day = (iso: string) => iso.slice(0, 10);

/** Four money tiles: one a row on a phone, two on a tablet and a laptop, four on a wide screen (long RWF amounts fit). */
export const MONEY_GRID_4 = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4";

/** The display currency in words, for the hints under the money pages' headings. */
function currencyNote(fx: MoneyFmt): string {
  const c = fx.display.currency;
  return `${CURRENCY_NAME[c]}${c === "RWF" ? " (money received in RWF is exact; the rest is converted, marked ≈)" : c === "EUR" ? " (converted, marked ≈)" : ""}`;
}

/**
 * Revenue and profit: this month and the running totals as tiles, the 12-month chart, and cards to the long tables
 * (profit by month, by plan, every client ever), each on its own page. Empty data shows zeros and hints. Old links to
 * #clients and #profit go to those pages.
 */
export function RevenueView({ r, fx = BOOKS_FMT }: { r: MoneyReport; /** Money in the admin's display currency. */ fx?: MoneyFmt }) {
  const cur = r.months[r.months.length - 1];
  const prev = r.months[r.months.length - 2];
  const prevLabel = prev ? `vs ${monthLabel(prev.month)}` : "";
  const nothing = r.lifetime.customersEver === 0 && r.months.every((m) => m.costs.totalCents === 0);
  const top = r.clients[0];
  const bestPlan = [...r.byPlan].sort((a, b) => b.mrrCents - a.mrrCents)[0];
  const profitable = r.months.filter((m) => m.profitCents > 0).length;
  return (
    <>
      <HashRedirect to={{ clients: "/admin/revenue/clients", profit: "/admin/revenue/months" }} />
      {r.truncated && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          There are more payment events than one report reads (200,000): the oldest payments are left out of lifetime numbers. Recent months are complete.
        </p>
      )}
      {nothing && <EmptyState icon={Wallet} title="No payments or costs yet." hint="Revenue appears with the first confirmed payment; costs with the first AI call or recurring cost." />}

      <Section title={`This month, ${cur ? monthLabel(cur.month) : ""}`} description={`${currencyNote(fx)}. Revenue is net of card fees, tax and refunds.`}>
        <StatGrid cols={4} className={MONEY_GRID_4}>
          <StatTile
            icon={Coins}
            tone="green"
            label="Revenue"
            value={fx.amount(cur?.revenue.netCents ?? 0, cur?.revenue)}
            title={fx.amountTitle(cur?.revenue.netCents ?? 0, cur?.revenue)}
            delta={prev ? { now: cur?.revenue.netCents ?? 0, before: prev.revenue.netCents, against: prevLabel } : null}
            spark={r.months.map((m) => m.revenue.netCents)}
            hint={`Money that came in this month. ${num(cur?.revenue.payingClients ?? 0)} clients paid.`}
          />
          <StatTile
            icon={Receipt}
            tone="orange"
            label="Costs"
            value={fx.text(Math.round(cur?.costs.totalCents ?? 0))}
            title={fx.title(Math.round(cur?.costs.totalCents ?? 0))}
            delta={prev ? { now: cur?.costs.totalCents ?? 0, before: prev.costs.totalCents, against: prevLabel, upIsGood: false } : null}
            href="/admin/costs"
            hint={(cur?.costs.estimateCents ?? 0) > 0 ? `What BuPulse pays. ${fx.text(Math.round(cur!.costs.estimateCents))} of it is still an estimate.` : "What BuPulse pays: AI, hosting, the domain. All billed."}
          />
          <StatTile
            icon={(cur?.profitCents ?? 0) < 0 ? TrendingDown : TrendingUp}
            tone="green"
            alert={(cur?.profitCents ?? 0) < 0}
            label="Profit"
            value={fx.amount(cur?.profitCents ?? 0, cur?.revenue)}
            title={fx.amountTitle(cur?.profitCents ?? 0, cur?.revenue)}
            delta={prev ? { now: cur?.profitCents ?? 0, before: prev.profitCents, against: prevLabel } : null}
            spark={r.months.map((m) => m.profitCents)}
            hint="Revenue minus all costs: what is left for BuPulse."
          />
          <StatTile
            icon={ArrowLeftRight}
            tone="slate"
            label="RWF rate used"
            value={cur?.rate ? `${cur.rate}` : `${r.rwfPerUsd}`}
            href="/admin/settings"
            hint={cur?.rate ? "RWF per US dollar in this month's payments." : "RWF per US dollar (Settings). No RWF payments yet."}
          />
        </StatGrid>
      </Section>

      <Section id="mrr" title="Recurring and lifetime" description="Every client ever, including those who left or deleted their account.">
        <StatGrid cols={3} className="grid-cols-1 sm:grid-cols-2">
          <StatTile icon={Repeat} tone="green" label="MRR" value={fx.amount(r.mrrCents, r.mrrRwf)} title={fx.amountTitle(r.mrrCents, r.mrrRwf)} hint={`What paying clients bring in each month. ${num(r.lifetime.payingNow)} paying now.`} />
          <StatTile icon={UserRound} tone="green" label="ARPU" value={r.arpuCents == null ? "n/a" : fx.amount(r.arpuCents, r.arpuRwf)} hint="What one paying client brings in a month, on average." />
          <StatTile icon={TrendingDown} tone="orange" alert={(r.churn.pct ?? 0) >= 10} label="Churn, 30 days" value={pct(r.churn.pct)} hint={`Clients who stopped paying in the last 30 days: ${num(r.churn.lost30)}.`} />
          <StatTile icon={Coins} tone="green" label="Lifetime revenue" value={fx.amount(r.lifetime.revenueCents, r.lifetime)} title={fx.amountTitle(r.lifetime.revenueCents, r.lifetime)} hint={r.lifetime.firstMonth ? `Everything clients paid since ${monthLabel(r.lifetime.firstMonth)}.` : "Nothing yet."} />
          <StatTile icon={TrendingUp} tone="green" alert={r.lifetime.profitCents < 0} label="Lifetime profit" value={fx.amount(r.lifetime.profitCents, r.lifetime)} title={fx.amountTitle(r.lifetime.profitCents, r.lifetime)} hint={`After ${fx.text(r.lifetime.costCents)} of costs since the start.`} />
          <StatTile icon={Users} tone="blue" label="Clients ever" value={num(r.lifetime.customersEver)} href="/admin/revenue/clients" hint={`Everyone who ever paid. ${num(r.lifetime.churned)} no longer pay.`} />
        </StatGrid>
      </Section>

      <Panel icon={CalendarRange} tone="green" title="Revenue and costs by month" description={`The last 12 months, ${fx.display.currency}. Blue is money in, red is money out.`}>
        <MonthBars
          months={r.months.map((m) => m.month)}
          a={{ name: "Revenue", color: "var(--color-pulse-blue)", values: r.months.map((m) => Math.max(0, m.revenue.netCents)) }}
          b={{ name: "Costs", color: "var(--bp-danger)", values: r.months.map((m) => Math.round(m.costs.totalCents)) }}
          summary={`Revenue and costs for each of the last ${r.months.length} months`}
          format={(v) => fx.text(v)}
        />
      </Panel>

      <Section title="The details" description="The long tables, each on its own page.">
        <SectionGrid>
          <SectionCard row
            href="/admin/revenue/months"
            icon={CalendarRange}
            tone="green"
            title="Profit by month"
            hint="Revenue by how it was paid (card, Mobile Money, invoices), refunds, costs and profit, month by month."
            value={`${profitable} of ${r.months.length}`}
            valueLabel="months in profit"
          />
          <SectionCard row
            href="/admin/revenue/plans"
            icon={Layers}
            tone="green"
            title="By plan"
            hint={bestPlan ? `Who pays for what now. ${bestPlan.plan === "unknown" ? "An unknown plan" : bestPlan.plan} brings in the most.` : "No paying clients yet."}
            value={num(r.byPlan.length)}
            valueLabel={r.byPlan.length === 1 ? "plan with revenue" : "plans with revenue"}
          />
          <SectionCard row
            href="/admin/revenue/clients"
            icon={Users}
            tone="blue"
            title="Every client ever"
            hint={top ? `Lifetime revenue, AI cost and margin per client. Top: ${top.name}.` : "No client has paid yet."}
            value={num(r.clients.length)}
            valueLabel="clients who paid"
          />
        </SectionGrid>
      </Section>

      <RevenueHow />
    </>
  );
}

/** How the revenue numbers are worked out (on the main page and its sub-pages). */
export function RevenueHow() {
  return (
    <HowCalculated>
      <ul>
        <li>Months and days are Kigali&apos;s (Africa/Kigali): a payment at 01:00 on the 1st counts in the new month.</li>
        <li>Revenue is every payment ever recorded (BillingEvent), kept when a client leaves or deletes their account. Card: Paddle&apos;s payout after tax and its fee, less approved refunds. Mobile Money: confirmed MTN or Airtel payments. Invoices: payments of an invoice (MoMo with the invoice number, bank or cash) and plain invoices marked paid.</li>
        <li>RWF payments count at the USD value fixed when they were confirmed; the RWF column shows the francs received and that rate.</li>
        <li>MRR: each paying client (active or past due, not on trial) counts their plan&apos;s monthly price; a Mobile Money client counts what they last paid for a whole period (features added mid-period count from the next renewal); yearly plans count a twelfth. ARPU is MRR divided by paying clients.</li>
        <li>Churn, 30 days: clients who had paid and stopped in the last 30 days, out of those paying now plus them. Stopped means the paid period ended after a cancel or expiry, or, without one (deleted account), the period their last payment bought ran out (30 days, a year for yearly).</li>
        <li>Costs and profit: see Costs. A month&apos;s costs are the providers&apos; bills when entered, otherwise the AI ledger&apos;s estimate, plus recurring and one-month costs.</li>
        <li>Per client: AI cost is that company&apos;s calls in the ledger since it started; it leaves out shared costs such as hosting.</li>
      </ul>
    </HowCalculated>
  );
}

type Month = MoneyReport["months"][number];

/** Profit by month: revenue by how it was paid, refunds, RWF received, costs and profit, newest first. */
export function RevenueMonths({ r, fx = BOOKS_FMT }: { r: MoneyReport; fx?: MoneyFmt }) {
  const rows = [...r.months].reverse();
  return (
    <Panel icon={CalendarRange} tone="green" title="Profit by month" description={`Newest first. RWF shows what Mobile Money and RWF invoices brought in and the rate their USD value was fixed at. ${currencyNote(fx)}.`}>
      <DataList<Month>
        caption="Revenue, costs and profit by month"
        rows={rows}
        rowKey={(m) => m.month}
        columns={[
          { key: "month", header: "Month", cell: (m) => monthLabel(m.month), primary: true },
          { key: "net", header: "Net revenue", cell: (m) => <span className="font-semibold">{fx.amountEl(m.revenue.netCents, m.revenue)}</span>, align: "right" },
          { key: "costs", header: "Costs", cell: (m) => <>{fx.el(Math.round(m.costs.totalCents))}{m.costs.estimateCents > 0 && <span className="block text-xs text-new">part estimated</span>}</>, align: "right" },
          { key: "profit", header: "Profit", cell: (m) => <span className={m.profitCents < 0 ? "font-semibold text-danger" : "font-semibold"}>{fx.amountEl(m.profitCents, m.revenue)}</span>, align: "right" },
          { key: "card", header: "Card", cell: (m) => fx.amountEl(m.revenue.byMethod.card + m.revenue.refundsCents, m.rwfByMethod?.card), align: "right", hideOnPhone: true },
          { key: "momo", header: "Mobile Money", cell: (m) => fx.amountEl(m.revenue.byMethod.momo, m.rwfByMethod?.momo), align: "right", hideOnPhone: true },
          { key: "invoice", header: "Invoices", cell: (m) => fx.amountEl(m.revenue.byMethod.invoice, m.rwfByMethod?.invoice), align: "right", hideOnPhone: true },
          { key: "refunds", header: "Refunds", cell: (m) => <span className="text-muted">{m.revenue.refundsCents ? `-${fx.text(m.revenue.refundsCents)}` : "0"}</span>, align: "right", hideOnPhone: true },
          { key: "rwf", header: "RWF received", cell: (m) => (m.revenue.rwfMinor ? <>{money(m.revenue.rwfMinor, "RWF")}<span className="block text-xs text-muted">at {m.rate} RWF/USD</span></> : <span className="text-muted">0</span>), align: "right", hideOnPhone: true },
        ]}
      />
    </Panel>
  );
}

type Plan = MoneyReport["byPlan"][number];

/** By plan: who pays for what now (MRR), and what each plan brought in over all time. */
export function RevenuePlans({ r, fx = BOOKS_FMT }: { r: MoneyReport; fx?: MoneyFmt }) {
  return (
    <Panel icon={Layers} tone="green" title="By plan" description="Who pays for what now (MRR), and what each plan brought in over all time.">
      <DataList<Plan>
        caption="Revenue by plan"
        rows={r.byPlan}
        rowKey={(p) => p.plan}
        columns={[
          { key: "plan", header: "Plan", cell: (p) => (p.plan === "unknown" ? <span className="text-muted">Unknown plan</span> : p.plan), primary: true },
          { key: "paying", header: "Paying now", cell: (p) => num(p.payingNow), align: "right" },
          { key: "mrr", header: "MRR", cell: (p) => fx.amountEl(p.mrrCents, p.mrrRwf), align: "right" },
          { key: "net", header: "Lifetime revenue", cell: (p) => fx.amountEl(p.netCents, p.netRwf), align: "right" },
          { key: "clients", header: "Clients ever", cell: (p) => num(p.clients), align: "right" },
        ]}
        empty={<EmptyState icon={Layers} title="No paying clients yet." hint="Plans appear here once someone pays for one." />}
      />
    </Panel>
  );
}

type Client = MoneyReport["clients"][number];

/** Every client ever: lifetime revenue, AI cost over the same time and what is left. Deleted accounts keep their payments. */
export function RevenueClients({ r, fx = BOOKS_FMT }: { r: MoneyReport; fx?: MoneyFmt }) {
  return (
    <Panel icon={Users} tone="blue" title="Every client ever" description="Lifetime revenue per client, their AI cost over the same time, and what is left. Deleted accounts keep their payments.">
      <DataList<Client>
        caption="Lifetime revenue per client"
        rows={r.clients}
        rowKey={(c) => c.userId ?? "unknown"}
        columns={[
          {
            key: "client",
            header: "Client",
            primary: true,
            cell: (c) => (
              <span className="flex min-w-0 flex-col">
                {c.businessId ? <Link href={`/admin/companies/${c.businessId}`} className="truncate font-semibold underline-offset-2 hover:underline">{c.name}</Link> : <span className="text-muted">{c.name}</span>}
                {c.email && <span className="truncate text-xs font-normal text-muted">{c.email}</span>}
              </span>
            ),
          },
          { key: "now", header: "Now", cell: (c) => (c.deleted ? <StatusPill tone="muted">Deleted</StatusPill> : c.paying ? <StatusPill tone="good" dot>{c.plan?.toLowerCase() ?? "paying"}</StatusPill> : <StatusPill tone="new">{c.status?.toLowerCase() ?? "left"}</StatusPill>) },
          { key: "revenue", header: "Lifetime revenue", cell: (c) => <span className="font-semibold">{fx.amountEl(c.revenueCents, c.revenueRwf)}</span>, align: "right" },
          { key: "margin", header: "Margin", cell: (c) => <span className={c.revenueCents - c.aiCostCents < 0 ? "text-danger" : undefined}>{fx.amountEl(Math.round(c.revenueCents - c.aiCostCents), c.revenueRwf)}</span>, align: "right" },
          { key: "payments", header: "Payments", cell: (c) => num(c.payments), align: "right", hideOnPhone: true },
          { key: "when", header: "First to last payment", cell: (c) => <span className="whitespace-nowrap">{day(c.firstAt)} to {day(c.lastAt)}</span>, hideOnPhone: true },
          { key: "ai", header: "AI cost", cell: (c) => fx.el(Math.round(c.aiCostCents)), align: "right", hideOnPhone: true },
        ]}
        empty={<EmptyState icon={Users} title="No client has paid yet." hint="Clients appear here with their first payment." />}
      />
    </Panel>
  );
}
