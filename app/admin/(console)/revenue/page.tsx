import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { LineChart } from "@/components/admin/charts";
import { Empty, Panel, RangeTabs, Stat, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Button, Field, Input } from "@/components/ui";
import { money, num, param, parseRange } from "@/lib/admin/format";
import { getCosts, getProfit, getRevenue } from "@/lib/analytics/queries";
import { listMonthlyCosts } from "@/lib/analytics/costs";
import { deleteCostAction, saveCostAction } from "../actions";

export const metadata = { title: "Revenue, costs and profit" };

export default async function RevenuePage({ searchParams }: PageProps<"/admin/revenue">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const { key, range } = parseRange(sp.range);
  const [revenue, costs, profit, monthly] = await Promise.all([getRevenue(range), getCosts(range), getProfit(range), listMonthlyCosts()]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const days = profit.byDay.map((d) => d.date);

  return (
    <>
      <PageHeader title="Revenue, costs and profit" description={`${range.from} to ${range.to}, UTC. Revenue is from Paddle; AI cost is from the usage ledger; the rest you enter below.`} action={<RangeTabs current={key} base="/admin/revenue" />} />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net revenue" value={money(revenue.netCents)} source={`${money(revenue.grossCents)} gross, ${money(revenue.refundsCents)} refunds`} />
        <Stat label="MRR" value={money(revenue.mrrCents)} source="Active Paddle subscriptions" />
        <Stat label="Costs" value={money(costs.totalCents)} source={`${money(costs.aiCents)} AI`} invert />
        <Stat label="Profit" value={money(profit.profitCents)} source="Net revenue minus costs" />
      </div>

      <Panel title="Revenue, costs and profit by day" description="USD.">
        {days.length > 1 ? (
          <LineChart
            cents
            labels={days}
            series={[
              { name: "Revenue", color: "var(--color-pulse-blue)", values: profit.byDay.map((d) => d.revenueCents) },
              { name: "Costs", color: "var(--bp-danger)", values: profit.byDay.map((d) => d.costCents) },
              { name: "Profit", color: "var(--color-pulse-violet)", values: profit.byDay.map((d) => d.profitCents) },
            ]}
            summary="Daily revenue, costs and profit in the selected range"
          />
        ) : (
          <Empty>Pick 7 or 30 days to see the daily chart.</Empty>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Subscribers by plan" description="Where MRR comes from.">
          {revenue.byPlan.length === 0 ? (
            <Empty>No paying subscribers yet.</Empty>
          ) : (
            <TableWrap caption="Subscribers and MRR by plan">
              <thead><tr><Th>Plan</Th><Th>Billed</Th><Th right>Subscribers</Th><Th right>MRR</Th></tr></thead>
              <tbody>
                {revenue.byPlan.map((p) => (
                  <tr key={`${p.plan}-${p.interval}`}><Td>{p.plan}</Td><Td>{p.interval}</Td><Td right>{num(p.subscribers)}</Td><Td right>{money(p.mrrCents)}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
        <Panel title="Costs by category" description="Monthly costs are spread evenly over the days of their month.">
          {costs.byCategory.length === 0 ? (
            <Empty>No costs recorded for this range.</Empty>
          ) : (
            <TableWrap caption="Costs by category">
              <thead><tr><Th>Category</Th><Th right>Amount</Th></tr></thead>
              <tbody>
                {costs.byCategory.map((c) => (<tr key={c.category}><Td>{c.category}</Td><Td right>{money(c.cents)}</Td></tr>))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>

      <Panel title="Profit by month" description="Revenue minus all costs.">
        {profit.byMonth.length === 0 ? (
          <Empty>No months yet.</Empty>
        ) : (
          <TableWrap caption="Profit by month">
            <thead><tr><Th>Month</Th><Th right>Revenue</Th><Th right>Costs</Th><Th right>Profit</Th></tr></thead>
            <tbody>
              {profit.byMonth.map((m) => (<tr key={m.month}><Td>{m.month}</Td><Td right>{money(m.revenueCents)}</Td><Td right>{money(m.costCents)}</Td><Td right>{money(m.profitCents)}</Td></tr>))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div id="costs" />
      <Panel title="Monthly costs you enter" description="Hosting, email and anything else that is not in the AI ledger. Saving the same month and category again replaces it.">
        <form action={saveCostAction} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_9rem_1fr_auto]">
          <Field label="Month"><Input name="month" type="month" defaultValue={thisMonth} required /></Field>
          <Field label="Category"><Input name="category" list="cost-cats" placeholder="hosting" required maxLength={40} /></Field>
          <datalist id="cost-cats"><option value="hosting" /><option value="email" /><option value="domain" /><option value="other" /></datalist>
          <Field label="Amount (USD)"><Input name="amount" inputMode="decimal" placeholder="5.00" required /></Field>
          <Field label="Note (optional)"><Input name="note" maxLength={120} /></Field>
          <Button type="submit">Save cost</Button>
        </form>
        {monthly.length === 0 ? (
          <Empty>Nothing entered yet. Add this month’s hosting and email bills.</Empty>
        ) : (
          <TableWrap caption="Monthly costs entered by hand">
            <thead><tr><Th>Month</Th><Th>Category</Th><Th right>Amount</Th><Th>Note</Th><Th /></tr></thead>
            <tbody>
              {monthly.map((c) => (
                <tr key={`${c.month}-${c.category}`}>
                  <Td>{c.month}</Td><Td>{c.category}</Td><Td right>{money(c.amountCents)}</Td><Td>{c.note ?? ""}</Td>
                  <Td right>
                    <ConfirmButton action={deleteCostAction} fields={{ month: c.month, category: c.category }} label="Delete" title="Delete this cost?" description={`${c.category} for ${c.month} will no longer count towards costs.`} confirmLabel="Delete" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
