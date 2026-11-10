import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { Bot, CalendarClock, CalendarRange, FilePlus2, Receipt, Repeat } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { CostLinesTable, MonthCostTable, monthLabel } from "@/components/admin/money/cost-tables";
import { MONEY_GRID_4 } from "@/components/admin/money/revenue-view";
import { DataList, EmptyState, FilterChips, HashRedirect, SectionCard, SectionGrid, StatGrid, StatTile, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { HowCalculated, Panel, Section } from "@/components/admin/ui";
import { Button, Field, Input, Select } from "@/components/ui";
import { money } from "@/lib/admin/format";
import type { MonthlyCostRow } from "@/lib/analytics/costs";
import type { ProviderBillRow } from "@/lib/money/costs";
import { BILL_PROVIDERS, CATEGORY_LABEL, COST_CATEGORIES, COST_PRESETS, providerLabel, recurringCentsForMonth, type MonthCosts, type RecurringCostRow } from "@/lib/money/costs-shared";
import { deleteCostAction, saveCostAction } from "@/app/admin/(console)/actions";
import { deleteProviderBillAction, deleteRecurringCostAction, endRecurringCostAction, saveProviderBillAction, saveRecurringCostAction } from "@/app/admin/(console)/(money)/costs/actions";

// Admin -> Money -> Costs, split into a calm main page and one page per job (bills, recurring, one-month, months).
// Plain data in: the pages load it, the dev preview passes made-up rows.

const running = (r: RecurringCostRow, thisMonth: string) => !r.endMonth || r.endMonth >= thisMonth;

/** The Costs main page: this month in tiles and lines, and a card for each job. Old #bills/#recurring/#one-off links go to their pages. */
export function CostsOverview({ months, recurring, bills, entered, thisMonth, lastMonth, fx = BOOKS_FMT }: { months: MonthCosts[]; recurring: RecurringCostRow[]; bills: ProviderBillRow[]; entered: MonthlyCostRow[]; thisMonth: string; lastMonth: string; fx?: MoneyFmt }) {
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const prevEstimate = prev?.estimateCents ?? 0;
  const runningCount = recurring.filter((r) => running(r, thisMonth)).length;
  return (
    <>
      <HashRedirect to={{ bills: "/admin/costs/bills", recurring: "/admin/costs/recurring", "one-off": "/admin/costs/one-off" }} />
      <StatGrid cols={4} className={MONEY_GRID_4}>
        <StatTile
          icon={Receipt}
          tone="orange"
          label={`Costs, ${monthLabel(thisMonth)}`}
          value={fx.text(Math.round(cur?.totalCents ?? 0))}
          title={fx.title(Math.round(cur?.totalCents ?? 0))}
          delta={prev ? { now: cur?.totalCents ?? 0, before: prev.totalCents, against: `vs ${monthLabel(prev.month)}`, upIsGood: false } : null}
          hint="Everything BuPulse pays for this month, so far."
        />
        <StatTile icon={Bot} tone="violet" label="AI and voice" value={fx.text(Math.round(cur?.aiCents ?? 0))} title={fx.title(Math.round(cur?.aiCents ?? 0))} href="/admin/ai" hint={cur && cur.estimateCents > 0 ? "Our estimate until you enter the bill." : "From the providers' bills."} />
        <StatTile icon={Repeat} tone="blue" label="Recurring" value={fx.text(Math.round(cur?.recurringCents ?? 0))} title={fx.title(Math.round(cur?.recurringCents ?? 0))} href="/admin/costs/recurring" hint={`Hosting, the domain, subscriptions: ${runningCount} running.`} />
        <StatTile
          icon={CalendarClock}
          tone="orange"
          alert={prevEstimate > 0}
          label={`Estimated part, ${monthLabel(lastMonth)}`}
          value={fx.text(Math.round(prevEstimate))}
          title={fx.title(Math.round(prevEstimate))}
          href={`/admin/costs/bills?month=${lastMonth}`}
          hint={prevEstimate > 0 ? "Enter last month's bills to make it exact." : "Last month is fully billed."}
        />
      </StatGrid>

      <Section title={`This month, ${monthLabel(thisMonth)}`} description="Dearest first. Each line says where its number comes from.">
        <Panel title="Cost lines" description="Billed: the provider's real bill. Estimate: our count of AI calls until the bill is in.">
          <CostLinesTable fx={fx} month={cur} />
        </Panel>
      </Section>

      <Section title="Manage costs" description="One page for each job.">
        <SectionGrid cols={4}>
          <SectionCard row
            href="/admin/costs/bills"
            icon={FilePlus2}
            tone="green"
            title="Provider bills"
            hint="What each AI provider really billed. It replaces our estimate."
            value={String(bills.length)}
            valueLabel="bills entered"
            count={prevEstimate > 0 ? 1 : undefined}
            countLabel={prevEstimate > 0 ? `${monthLabel(lastMonth)} still has estimates` : undefined}
          />
          <SectionCard row href="/admin/costs/recurring" icon={Repeat} tone="green" title="Recurring costs" hint="Hosting, the domain and subscriptions." value={String(runningCount)} valueLabel="running now" />
          <SectionCard row href="/admin/costs/one-off" icon={Receipt} tone="green" title="One-month costs" hint="A cost for one month only." value={String(entered.length)} valueLabel="entered" />
          <SectionCard row href="/admin/costs/months" icon={CalendarRange} tone="green" title="Month by month" hint="The last 12 months, side by side." value={String(months.filter((m) => m.estimateCents > 0).length)} valueLabel="months with estimates" />
        </SectionGrid>
      </Section>
    </>
  );
}

/** How the cost numbers are worked out (every Costs page). */
export function CostsHow({ rwfPerUsd }: { rwfPerUsd: number }) {
  return (
    <HowCalculated>
      <ul>
        <li>AI and voice: each provider&apos;s bill for the month when you entered it; otherwise the cost ledger&apos;s estimate (every AI call, priced from lib/ai/pricing.ts). Calls that timed out on our side are counted with estimated usage because providers still bill them.</li>
        <li>Months here are Kigali months; Google bills in Pacific time, so a few hours at each month&apos;s edge can fall in the next month. Taxes on Google&apos;s invoice are not in the estimate: the bill you enter includes them.</li>
        <li>Recurring costs count from their first to their last month; a yearly cost counts a twelfth each month. An RWF cost or bill keeps the rate of the day you saved it (today {rwfPerUsd} RWF per USD, Settings), so changing the rate never restates past months.</li>
        <li>Profit on Revenue and profit, the Overview and Jarvis all use these same numbers.</li>
      </ul>
    </HowCalculated>
  );
}

/** Provider bills: the form to enter a month's real bill, and the bills entered so far. */
export function CostBills({ bills, months, thisMonth, billMonth, fx = BOOKS_FMT }: { bills: ProviderBillRow[]; months: MonthCosts[]; thisMonth: string; billMonth: string; fx?: MoneyFmt }) {
  return (
    <>
      <Panel id="bills" icon={FilePlus2} tone="green" title="Enter a bill" description="It replaces our estimate for that provider and month everywhere, profit too.">
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
        <HowCalculated title="Where to find each bill">
          <ul>
            {BILL_PROVIDERS.filter((p) => p.key !== "other").map((p) => (
              <li key={p.key}><span className="font-semibold text-text">{p.label}:</span> {p.hint}</li>
            ))}
          </ul>
        </HowCalculated>
      </Panel>
      <Panel title="Bills entered" description={`Newest month first, with our estimate next to each one. In ${fx.display.currency}.`}>
        <DataList<ProviderBillRow>
          caption="Provider bills entered"
          rows={bills}
          rowKey={(b) => b.id}
          columns={[
            { key: "provider", header: "Provider", cell: (b) => providerLabel(b.provider), primary: true },
            { key: "month", header: "Month", cell: (b) => monthLabel(b.month) },
            { key: "billed", header: "Billed", cell: (b) => <span className="font-semibold">{money(b.amountMinor, b.currency)}</span>, align: "right" },
            { key: "in", header: `In ${fx.display.currency}`, cell: (b) => <>{fx.el(b.usdCents, "USD", { rwfRate: b.usdRate })}{b.usdRate ? <span className="block text-xs text-muted">at {b.usdRate} RWF/USD</span> : null}</>, align: "right", hideOnPhone: true },
            {
              key: "estimate",
              header: "Our estimate",
              align: "right",
              cell: (b) => {
                const m = months.find((x) => x.month === b.month)?.lines.find((l) => l.key === `ai:${b.provider}`);
                return <span className="text-muted">{m ? fx.text(Math.round(m.estimateCents ?? 0)) : "older than 12 months"}</span>;
              },
            },
            { key: "note", header: "Note", cell: (b) => b.note ?? "", hideOnPhone: true },
            { key: "delete", header: <span className="sr-only">Actions</span>, align: "right", cell: (b) => <ConfirmButton action={deleteProviderBillAction} fields={{ id: b.id }} label="Delete" title="Delete this bill?" description={`${providerLabel(b.provider)} for ${b.month} goes back to the ledger's estimate.`} confirmLabel="Delete" /> },
          ]}
          empty={<EmptyState icon={FilePlus2} title="No bills entered yet." hint="Until you add one, AI costs are the ledger's estimate." />}
        />
      </Panel>
    </>
  );
}

/** Recurring costs: common costs as one-tap chips that fill the form, the form, and the list with Stop and Delete. */
export function CostRecurring({ recurring, thisMonth, lastMonth, rwfPerUsd, presetKey, sp, fx = BOOKS_FMT }: { recurring: RecurringCostRow[]; thisMonth: string; lastMonth: string; rwfPerUsd: number; presetKey: string; sp: SearchParamsLike; fx?: MoneyFmt }) {
  const preset = COST_PRESETS.find((p) => p.key === presetKey);
  return (
    <>
      <Panel id="recurring" icon={Repeat} tone="green" title="Add a recurring cost" description="Tap a common cost to fill the form, or type your own. A yearly cost counts a twelfth in each month.">
        <FilterChips label="Fill the form from a common cost" param="preset" base="/admin/costs/recurring" params={sp} current={presetKey} options={[{ value: "", label: "Blank form" }, ...COST_PRESETS.map((p) => ({ value: p.key, label: p.name }))]} />
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
      </Panel>
      <Panel title="Recurring costs" description="Stopping one keeps it in the months it was paid. Deleting removes it from every month.">
        <DataList<RecurringCostRow>
          caption="Recurring costs"
          rows={recurring}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", header: "Name", primary: true, cell: (r) => <span className={!running(r, thisMonth) ? "text-muted" : undefined}>{r.name}{r.note ? <span className="block text-xs font-normal text-muted">{r.note}</span> : null}</span> },
            { key: "amount", header: "Amount", align: "right", cell: (r) => <>{fx.el(r.amountMinor, r.currency)} / {r.period}</> },
            { key: "month", header: "Per month", align: "right", cell: (r) => fx.el(Math.round(recurringCentsForMonth({ ...r, startMonth: "0000-01", endMonth: null }, thisMonth, rwfPerUsd))) },
            { key: "months", header: "Months", cell: (r) => <span className="whitespace-nowrap">{monthLabel(r.startMonth)} to {r.endMonth ? monthLabel(r.endMonth) : <StatusPill tone="good" dot>now</StatusPill>}</span> },
            { key: "kind", header: "Kind", cell: (r) => CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category, hideOnPhone: true },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right",
              cell: (r) => (
                <span className="flex flex-wrap justify-end gap-2">
                  {!r.endMonth && (
                    <ConfirmButton action={endRecurringCostAction} fields={{ id: r.id, lastMonth: lastMonth < r.startMonth ? r.startMonth : lastMonth }} label="Stop" title={`Stop ${r.name}?`} description={`It stops counting after ${monthLabel(lastMonth < r.startMonth ? r.startMonth : lastMonth)}; earlier months keep it.`} confirmLabel="Stop it" />
                  )}
                  <ConfirmButton action={deleteRecurringCostAction} fields={{ id: r.id }} label="Delete" title={`Delete ${r.name}?`} description="It disappears from every month, including past ones. Use Stop if you just stopped paying." confirmLabel="Delete" />
                </span>
              ),
            },
          ]}
          empty={<EmptyState icon={Repeat} title="No recurring costs yet." hint="Start with hosting and the domain: the chips above fill the form." />}
        />
      </Panel>
    </>
  );
}

/** One-month costs: a cost for one month only. Saving the same month and kind again replaces it. */
export function CostOneOff({ entered, thisMonth, fx = BOOKS_FMT }: { entered: MonthlyCostRow[]; thisMonth: string; fx?: MoneyFmt }) {
  return (
    <>
      <Panel id="one-off" icon={Receipt} tone="green" title="Add a one-month cost" description="A one-off purchase. Saving the same month and kind again replaces it.">
        <form action={saveCostAction} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_9rem_1fr_auto]">
          <Field label="Month"><Input name="month" type="month" defaultValue={thisMonth} required /></Field>
          <Field label="Kind"><Input name="category" list="cost-cats" placeholder="tools" required maxLength={40} /></Field>
          <datalist id="cost-cats">{COST_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Amount (USD)"><Input name="amount" inputMode="decimal" placeholder="5.00" required /></Field>
          <Field label="Note (optional)"><Input name="note" maxLength={120} /></Field>
          <Button type="submit">Save cost</Button>
        </form>
      </Panel>
      <Panel title="One-month costs" description="Newest month first.">
        <DataList<MonthlyCostRow>
          caption="One-month costs"
          rows={entered}
          rowKey={(c) => `${c.month}-${c.category}`}
          columns={[
            { key: "kind", header: "Kind", cell: (c) => c.category, primary: true },
            { key: "month", header: "Month", cell: (c) => c.month },
            { key: "amount", header: "Amount", cell: (c) => <span className="font-semibold">{fx.el(c.amountCents)}</span>, align: "right" },
            { key: "note", header: "Note", cell: (c) => c.note ?? "", hideOnPhone: true },
            { key: "delete", header: <span className="sr-only">Actions</span>, align: "right", cell: (c) => <ConfirmButton action={deleteCostAction} fields={{ month: c.month, category: c.category }} label="Delete" title="Delete this cost?" description={`${c.category} for ${c.month} will no longer count.`} confirmLabel="Delete" /> },
          ]}
          empty={<EmptyState icon={Receipt} title="No one-month costs yet." hint="Use the form above for a one-off purchase." />}
        />
      </Panel>
    </>
  );
}

/** The last 12 months of costs. */
export function CostMonths({ months, fx = BOOKS_FMT }: { months: MonthCosts[]; fx?: MoneyFmt }) {
  return (
    <Panel icon={CalendarRange} tone="green" title="Month by month" description="Newest first. A violet badge means the month still has estimates in it: enter its bills to make it exact.">
      <MonthCostTable fx={fx} months={months} />
    </Panel>
  );
}
