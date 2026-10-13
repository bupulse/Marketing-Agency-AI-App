import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import Link from "next/link";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { CostLinesTable, MonthCostTable, monthLabel } from "@/components/admin/money/cost-tables";
import { HowCalculated, Panel, Section, Stat, TableWrap, Td, Th, notice, Empty } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { requirePermission } from "@/lib/admin/auth";
import { money, param } from "@/lib/admin/format";
import { listMonthlyCosts } from "@/lib/analytics/costs";
import { getMonthCosts, listProviderBills, listRecurringCosts } from "@/lib/money/costs";
import { addMonths, BILL_PROVIDERS, CATEGORY_LABEL, COST_CATEGORIES, COST_PRESETS, providerLabel, recurringCentsForMonth } from "@/lib/money/costs-shared";
import { deleteCostAction, saveCostAction } from "@/app/admin/(console)/actions";
import { deleteProviderBillAction, deleteRecurringCostAction, endRecurringCostAction, saveProviderBillAction, saveRecurringCostAction } from "./actions";

export const metadata = { title: "Costs" };


export default async function CostsPage({ searchParams }: PageProps<"/admin/costs">) {
  await requirePermission("money.costs"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  const sp = await searchParams;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastMonth = addMonths(thisMonth, -1);
  const [{ months, rwfPerUsd }, recurring, bills, entered] = await Promise.all([getMonthCosts(addMonths(thisMonth, -11), thisMonth), listRecurringCosts(), listProviderBills(), listMonthlyCosts()]);
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const preset = COST_PRESETS.find((p) => p.key === param(sp.preset));
  const billMonth = param(sp.month) || lastMonth;

  return (
    <>
      <PageHeader title="Costs" description="Everything BuPulse pays for, per month: AI providers (their real bill, or our estimate until you enter it), hosting, the domain and subscriptions." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Costs, ${monthLabel(thisMonth)}`} value={fx.text(Math.round(cur?.totalCents ?? 0))} title={fx.title(Math.round(cur?.totalCents ?? 0))} previous={prev ? { now: cur?.totalCents ?? 0, before: prev.totalCents, label: monthLabel(prev.month) } : undefined} invert source="All kinds" />
        <Stat label="AI and voice" value={fx.text(Math.round(cur?.aiCents ?? 0))} title={fx.title(Math.round(cur?.aiCents ?? 0))} source={cur && cur.estimateCents > 0 ? "Estimate until the bill is entered" : "From the bills"} href="/admin/ai" />
        <Stat label="Recurring" value={fx.text(Math.round(cur?.recurringCents ?? 0))} title={fx.title(Math.round(cur?.recurringCents ?? 0))} source={`${recurring.filter((r) => !r.endMonth || r.endMonth >= thisMonth).length} running`} href="#recurring" />
        <Stat label={`Estimated part, ${monthLabel(lastMonth)}`} value={fx.text(Math.round(prev?.estimateCents ?? 0))} title={fx.title(Math.round(prev?.estimateCents ?? 0))} source={prev && prev.estimateCents > 0 ? "Enter last month's bills" : "Last month is fully billed"} href="#bills" tone={prev && prev.estimateCents > 0 ? "danger" : undefined} />
      </div>

      <Section title="This month" description="Each line says where its number comes from.">
        <Panel title={monthLabel(thisMonth)}>
          <CostLinesTable fx={fx} month={cur} />
        </Panel>
      </Section>

      <Panel title="Month by month" description="The last 12 months. A month with a violet badge still has estimates in it.">
        <MonthCostTable fx={fx} months={months} />
      </Panel>

      <div id="bills" />
      <Panel title="Provider bills" description="Type in what Google, Anthropic, ElevenLabs or Higgsfield really billed for a month. It replaces our estimate for that provider and month everywhere (profit too).">
        <form action={saveProviderBillAction} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_9rem_8rem_7rem_1fr_auto]">
          <Field label="Provider">
            <Select name="provider" defaultValue="google_ai" required>
              {BILL_PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Month"><Input name="month" type="month" defaultValue={billMonth} max={thisMonth} required /></Field>
          <Field label="Amount"><Input name="amount" inputMode="decimal" placeholder="1.03" required /></Field>
          <Field label="Currency"><Select name="currency" defaultValue="USD"><option>USD</option><option>RWF</option></Select></Field>
          <Field label="Note (optional)"><Input name="note" maxLength={200} placeholder="Invoice number" /></Field>
          <Button type="submit">Save bill</Button>
        </form>
        <ul className="grid gap-1 text-[13px] text-muted sm:grid-cols-2">
          {BILL_PROVIDERS.filter((p) => p.key !== "other").map((p) => <li key={p.key}><span className="font-medium text-text">{p.label}:</span> {p.hint}</li>)}
        </ul>
        {bills.length === 0 ? (
          <Empty>No bills entered yet. Until you add one, AI costs are the ledger&apos;s estimate.</Empty>
        ) : (
          <TableWrap caption="Provider bills entered">
            <thead><tr><Th>Month</Th><Th>Provider</Th><Th right>Billed</Th><Th right>In {fx.display.currency}</Th><Th right>Our estimate</Th><Th>Note</Th><Th /></tr></thead>
            <tbody>
              {bills.map((b) => {
                const m = months.find((x) => x.month === b.month)?.lines.find((l) => l.key === `ai:${b.provider}`);
                return (
                  <tr key={b.id}>
                    <Td>{monthLabel(b.month)}</Td>
                    <Td>{providerLabel(b.provider)}</Td>
                    <Td right>{money(b.amountMinor, b.currency)}</Td>
                    <Td right>{fx.el(b.usdCents, "USD", { rwfRate: b.usdRate })}{b.usdRate ? <span className="block text-xs text-muted">at {b.usdRate} RWF/USD</span> : null}</Td>
                    <Td right className="text-muted">{m ? fx.text(Math.round(m.estimateCents ?? 0)) : "older than 12 months"}</Td>
                    <Td>{b.note ?? ""}</Td>
                    <Td right><ConfirmButton action={deleteProviderBillAction} fields={{ id: b.id }} label="Delete" title="Delete this bill?" description={`${providerLabel(b.provider)} for ${b.month} goes back to the ledger's estimate.`} confirmLabel="Delete" /></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div id="recurring" />
      <Panel title="Recurring costs" description="Hosting, the domain, subscriptions. A yearly cost counts a twelfth in each month. Stopping one keeps it in the months it was paid.">
        <div className="flex flex-wrap gap-2" aria-label="Fill the form from a common cost">
          {COST_PRESETS.map((p) => (
            <Link key={p.key} href={`/admin/costs?preset=${p.key}#recurring`} title={p.hint} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium no-underline hover:bg-soft">
              {p.name}
            </Link>
          ))}
        </div>
        <form key={preset?.key ?? "blank"} action={saveRecurringCostAction} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name"><Input name="name" defaultValue={preset?.name} required maxLength={80} placeholder="Cloudflare Workers Paid" /></Field>
          <input type="hidden" name="provider" value={preset?.key ?? "other"} />
          <Field label="Kind">
            <Select name="category" defaultValue={preset?.category ?? "hosting"}>
              {COST_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field label="Amount" hint={preset?.hint}><Input name="amount" inputMode="decimal" defaultValue={preset ? String(preset.amount) : undefined} required placeholder="5.00" /></Field>
          <Field label="Currency"><Select name="currency" defaultValue={preset?.currency ?? "USD"}><option>USD</option><option>RWF</option></Select></Field>
          <Field label="Paid every"><Select name="period" defaultValue={preset?.period ?? "month"}><option value="month">Month</option><option value="year">Year</option></Select></Field>
          <Field label="First month"><Input name="startMonth" type="month" defaultValue={thisMonth} required /></Field>
          <Field label="Last month (optional)"><Input name="endMonth" type="month" /></Field>
          <Field label="Note (optional)"><Input name="note" maxLength={200} /></Field>
          <Button type="submit" className="sm:col-span-2 lg:col-span-1">Add recurring cost</Button>
        </form>
        {recurring.length === 0 ? (
          <Empty>No recurring costs yet. Start with hosting and the domain (the buttons above fill the form).</Empty>
        ) : (
          <TableWrap caption="Recurring costs">
            <thead><tr><Th>Name</Th><Th>Kind</Th><Th right>Amount</Th><Th right>Per month (USD)</Th><Th>Months</Th><Th /></tr></thead>
            <tbody>
              {recurring.map((r) => {
                const ended = !!r.endMonth && r.endMonth < thisMonth;
                return (
                  <tr key={r.id} className={ended ? "text-muted" : undefined}>
                    <Td className="font-medium">{r.name}{r.note ? <span className="block text-xs font-normal text-muted">{r.note}</span> : null}</Td>
                    <Td>{CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category}</Td>
                    <Td right>{fx.el(r.amountMinor, r.currency)} / {r.period}</Td>
                    <Td right>{fx.el(Math.round(recurringCentsForMonth({ ...r, startMonth: "0000-01", endMonth: null }, thisMonth, rwfPerUsd)))}</Td>
                    <Td>{monthLabel(r.startMonth)} to {r.endMonth ? monthLabel(r.endMonth) : <Badge tone="success">now</Badge>}</Td>
                    <Td right>
                      <span className="flex justify-end gap-2">
                        {!r.endMonth && (
                          <ConfirmButton action={endRecurringCostAction} fields={{ id: r.id, lastMonth: lastMonth < r.startMonth ? r.startMonth : lastMonth }} label="Stop" title={`Stop ${r.name}?`} description={`It stops counting after ${monthLabel(lastMonth < r.startMonth ? r.startMonth : lastMonth)}; earlier months keep it.`} confirmLabel="Stop it" />
                        )}
                        <ConfirmButton action={deleteRecurringCostAction} fields={{ id: r.id }} label="Delete" title={`Delete ${r.name}?`} description="It disappears from every month, including past ones. Use Stop if you just stopped paying." confirmLabel="Delete" />
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div id="one-off" />
      <Panel title="One-month costs" description="A cost for one month only (a one-off purchase). Saving the same month and kind again replaces it.">
        <form action={saveCostAction} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_9rem_1fr_auto]">
          <Field label="Month"><Input name="month" type="month" defaultValue={thisMonth} required /></Field>
          <Field label="Kind"><Input name="category" list="cost-cats" placeholder="tools" required maxLength={40} /></Field>
          <datalist id="cost-cats">{COST_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Amount (USD)"><Input name="amount" inputMode="decimal" placeholder="5.00" required /></Field>
          <Field label="Note (optional)"><Input name="note" maxLength={120} /></Field>
          <Button type="submit">Save cost</Button>
        </form>
        {entered.length > 0 && (
          <TableWrap caption="One-month costs">
            <thead><tr><Th>Month</Th><Th>Kind</Th><Th right>Amount</Th><Th>Note</Th><Th /></tr></thead>
            <tbody>
              {entered.map((c) => (
                <tr key={`${c.month}-${c.category}`}>
                  <Td>{c.month}</Td><Td>{c.category}</Td><Td right>{fx.el(c.amountCents)}</Td><Td>{c.note ?? ""}</Td>
                  <Td right><ConfirmButton action={deleteCostAction} fields={{ month: c.month, category: c.category }} label="Delete" title="Delete this cost?" description={`${c.category} for ${c.month} will no longer count.`} confirmLabel="Delete" /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <HowCalculated>
        <ul>
          <li>AI and voice: each provider&apos;s bill for the month when you entered it; otherwise the cost ledger&apos;s estimate (every AI call, priced from lib/ai/pricing.ts). Calls that timed out on our side are counted with estimated usage because providers still bill them.</li>
          <li>The ledger counts calls in UTC months; Google bills in Pacific time, so a few hours at each month&apos;s edge can fall in the next month. Taxes on Google&apos;s invoice are not in the estimate: the bill you enter includes them.</li>
          <li>Recurring costs count from their first to their last month; a yearly cost counts a twelfth each month. An RWF cost or bill keeps the rate of the day you saved it (today {rwfPerUsd} RWF per USD, Settings), so changing the rate never restates past months.</li>
          <li>Profit on Revenue and profit, the Overview and Jarvis all use these same numbers.</li>
        </ul>
      </HowCalculated>
    </>
  );
}
