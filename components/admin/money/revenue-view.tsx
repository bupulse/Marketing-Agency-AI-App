import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { money, num, pct } from "@/lib/admin/format";
import type { MoneyReport } from "@/lib/money/report";
import { MonthBars } from "../charts";
import { Empty, HowCalculated, Panel, Section, Stat, TableWrap, Td, Th } from "../ui";
import { monthLabel } from "./cost-tables";

const day = (iso: string) => iso.slice(0, 10);

/** Revenue and profit: the whole money picture, from every client BuPulse ever had. Empty data shows zeros and hints. */
export function RevenueView({ r, fx = BOOKS_FMT }: { r: MoneyReport; /** Money in the admin's display currency. */ fx?: MoneyFmt }) {
  const cur = r.months[r.months.length - 1];
  const prev = r.months[r.months.length - 2];
  const prevLabel = prev ? monthLabel(prev.month) : undefined;
  const nothing = r.lifetime.customersEver === 0 && r.months.every((m) => m.costs.totalCents === 0);
  return (
    <>
      {r.truncated && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
          There are more payment events than one report reads (200,000): the oldest payments are left out of lifetime numbers. Recent months are complete.
        </p>
      )}
      {nothing && <Empty>No payments or costs yet. Revenue appears with the first confirmed payment; costs with the first AI call or recurring cost.</Empty>}

      <Section title={`This month, ${cur ? monthLabel(cur.month) : ""}`} description={`${fx.display.currency}${fx.display.currency === "USD" ? "" : " (≈ converted from the USD books; RWF received is exact)"}. Revenue is net of card fees, tax and refunds.`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Revenue" value={fx.mixed({ usdCents: cur?.revenue.netCents ?? 0, rwfMinor: cur?.revenue.rwfMinor, rwfUsdCents: cur?.revenue.rwfUsdCents })} previous={prev ? { now: cur?.revenue.netCents ?? 0, before: prev.revenue.netCents, label: prevLabel } : undefined} spark={r.months.map((m) => m.revenue.netCents)} source={`${num(cur?.revenue.payingClients ?? 0)} paying this month`} />
          <Stat label="Costs" value={fx.text(Math.round(cur?.costs.totalCents ?? 0))} title={fx.title(Math.round(cur?.costs.totalCents ?? 0))} invert previous={prev ? { now: cur?.costs.totalCents ?? 0, before: prev.costs.totalCents, label: prevLabel } : undefined} href="/admin/costs" source={(cur?.costs.estimateCents ?? 0) > 0 ? `${fx.text(Math.round(cur!.costs.estimateCents))} estimated` : "All billed"} />
          <Stat label="Profit" value={fx.text(cur?.profitCents ?? 0)} title={fx.title(cur?.profitCents ?? 0)} previous={prev ? { now: cur?.profitCents ?? 0, before: prev.profitCents, label: prevLabel } : undefined} spark={r.months.map((m) => m.profitCents)} tone={(cur?.profitCents ?? 0) < 0 ? "danger" : undefined} source="Revenue minus all costs" />
          <Stat label="RWF rate used" value={cur?.rate ? `${cur.rate}` : `${r.rwfPerUsd}`} source={cur?.rate ? `RWF per USD in this month's payments` : "RWF per USD (Settings); no RWF payments yet"} href="/admin/settings" />
        </div>
      </Section>

      <Section id="mrr" title="Recurring and lifetime" description="Every client ever, including those who left or deleted their account.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="MRR" value={fx.text(r.mrrCents)} title={fx.title(r.mrrCents)} source={`${num(r.lifetime.payingNow)} paying now`} />
          <Stat label="ARPU" value={r.arpuCents == null ? "n/a" : fx.text(r.arpuCents)} source="MRR per paying client" />
          <Stat label="Churn, 30 days" value={pct(r.churn.pct)} source={`${num(r.churn.lost30)} stopped paying`} tone={(r.churn.pct ?? 0) >= 10 ? "danger" : undefined} />
          <Stat label="Lifetime revenue" value={fx.mixed({ usdCents: r.lifetime.revenueCents, rwfMinor: r.lifetime.rwfMinor, rwfUsdCents: r.lifetime.rwfUsdCents })} source={r.lifetime.firstMonth ? `Since ${monthLabel(r.lifetime.firstMonth)}` : "Nothing yet"} />
          <Stat label="Lifetime profit" value={fx.text(r.lifetime.profitCents)} title={fx.title(r.lifetime.profitCents)} source={`${fx.text(r.lifetime.costCents)} costs`} tone={r.lifetime.profitCents < 0 ? "danger" : undefined} />
          <Stat label="Clients ever" value={num(r.lifetime.customersEver)} source={`${num(r.lifetime.churned)} no longer paying`} href="#clients" />
        </div>
      </Section>

      <Panel title="Revenue and costs by month" description={`The last 12 months, ${fx.display.currency}.`}>
        <MonthBars
          months={r.months.map((m) => m.month)}
          a={{ name: "Revenue", color: "var(--color-pulse-blue)", values: r.months.map((m) => Math.max(0, m.revenue.netCents)) }}
          b={{ name: "Costs", color: "var(--bp-danger)", values: r.months.map((m) => Math.round(m.costs.totalCents)) }}
          summary={`Revenue and costs for each of the last ${r.months.length} months`}
          format={(v) => fx.text(v)}
        />
      </Panel>

      <Panel title="Profit by month" description="Revenue by how it was paid, refunds, costs and profit. RWF shows what Mobile Money and RWF invoices brought in and the rate their USD value was fixed at.">
        <div id="profit" />
        <TableWrap caption="Revenue, costs and profit by month">
          <thead>
            <tr><Th>Month</Th><Th right>Card</Th><Th right>Mobile Money</Th><Th right>Invoices</Th><Th right>Refunds</Th><Th right>Net revenue</Th><Th right>RWF received</Th><Th right>Costs</Th><Th right>Profit</Th></tr>
          </thead>
          <tbody>
            {[...r.months].reverse().map((m) => (
              <tr key={m.month}>
                <Td>{monthLabel(m.month)}</Td>
                <Td right>{fx.el(m.revenue.byMethod.card + m.revenue.refundsCents)}</Td>
                <Td right>{fx.el(m.revenue.byMethod.momo)}</Td>
                <Td right>{fx.el(m.revenue.byMethod.invoice)}</Td>
                <Td right className="text-muted">{m.revenue.refundsCents ? `-${fx.text(m.revenue.refundsCents)}` : "0"}</Td>
                <Td right className="font-semibold">{fx.mixedEl({ usdCents: m.revenue.netCents, rwfMinor: m.revenue.rwfMinor, rwfUsdCents: m.revenue.rwfUsdCents })}</Td>
                <Td right>{m.revenue.rwfMinor ? <>{money(m.revenue.rwfMinor, "RWF")}<span className="block text-xs text-muted">at {m.rate} RWF/USD</span></> : <span className="text-muted">0</span>}</Td>
                <Td right>{fx.el(Math.round(m.costs.totalCents))}{m.costs.estimateCents > 0 && <span className="block text-xs text-new">part estimated</span>}</Td>
                <Td right className={m.profitCents < 0 ? "font-semibold text-danger" : "font-semibold"}>{fx.el(m.profitCents)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      <Panel title="By plan" description="Who pays for what now (MRR), and what each plan brought in over all time.">
        {r.byPlan.length === 0 ? (
          <Empty>No paying clients yet.</Empty>
        ) : (
          <TableWrap caption="Revenue by plan">
            <thead><tr><Th>Plan</Th><Th right>Paying now</Th><Th right>MRR</Th><Th right>Lifetime revenue</Th><Th right>Clients ever</Th></tr></thead>
            <tbody>
              {r.byPlan.map((p) => (
                <tr key={p.plan}><Td>{p.plan === "unknown" ? <span className="text-muted">Unknown plan</span> : p.plan}</Td><Td right>{num(p.payingNow)}</Td><Td right>{fx.el(p.mrrCents)}</Td><Td right>{fx.el(p.netCents)}</Td><Td right>{num(p.clients)}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Every client ever" description="Lifetime revenue per client, their AI cost over the same time, and what is left. Deleted accounts keep their payments.">
        <div id="clients" />
        {r.clients.length === 0 ? (
          <Empty>No client has paid yet.</Empty>
        ) : (
          <TableWrap caption="Lifetime revenue per client" tall>
            <thead><tr><Th>Client</Th><Th>Now</Th><Th right>Lifetime revenue</Th><Th right>Payments</Th><Th>First to last payment</Th><Th right>AI cost</Th><Th right>Margin</Th></tr></thead>
            <tbody>
              {r.clients.map((c) => (
                <tr key={c.userId ?? "unknown"}>
                  <Td className="max-w-[16rem]">
                    {c.businessId ? <Link href={`/admin/companies/${c.businessId}`} className="block truncate font-medium underline">{c.name}</Link> : <span className="text-muted">{c.name}</span>}
                    {c.email && <span className="block truncate text-xs text-muted">{c.email}</span>}
                  </Td>
                  <Td>{c.deleted ? <Badge tone="neutral">deleted</Badge> : c.paying ? <Badge tone="success">{c.plan?.toLowerCase() ?? "paying"}</Badge> : <Badge tone="violet">{c.status?.toLowerCase() ?? "left"}</Badge>}</Td>
                  <Td right className="font-semibold">{fx.el(c.revenueCents)}</Td>
                  <Td right>{num(c.payments)}</Td>
                  <Td className="whitespace-nowrap">{day(c.firstAt)} to {day(c.lastAt)}</Td>
                  <Td right>{fx.el(Math.round(c.aiCostCents))}</Td>
                  <Td right className={c.revenueCents - c.aiCostCents < 0 ? "text-danger" : undefined}>{fx.el(Math.round(c.revenueCents - c.aiCostCents))}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

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
    </>
  );
}
