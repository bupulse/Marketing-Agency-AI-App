import Link from "next/link";
import { AlertTriangle, BarChart3, Coins, Cpu, Gauge, PhoneCall, Receipt, TrendingUp, Users, Wallet } from "lucide-react";
import type { getAiUsage } from "@/lib/admin/ai-usage";
import { dateTime, money, num } from "@/lib/admin/format";
import { cn } from "@/lib/cn";
import { setAiBudgetAction } from "@/app/admin/(console)/actions";
import { Button, Field, Input, Meter } from "@/components/ui";
import { Bars, LineChart } from "../charts";
import { CARD, DataList, EmptyState, ExpandCard, FilterChips, IconBadge, PageHeader, StatGrid, StatTile, StatusPill, type SearchParamsLike } from "../kit";
import { Empty, Panel, notice } from "../ui";
import { monthChoices, monthLabel } from "./months";

export type AiUsage = Awaited<ReturnType<typeof getAiUsage>>;
type Spender = AiUsage["topSpenders"][number];

/**
 * AI calls and spend: the month as chips, a budget card (spend against the cap, the cap form folded away), four
 * numbers with their meaning, the daily spend, and the details (by model and feature, biggest spenders, failed calls,
 * the provider's bill) as cards that open on hover or tap.
 */
export function AiUsageView({ u, usd, currency, thisMonth, params, message }: { u: AiUsage; usd: (dollars: number) => string; currency: string; thisMonth: string; params: SearchParamsLike; message: { notice?: string; error?: string } }) {
  const days = u.perDay.map((d) => d.date);
  const state = u.paused ? { tone: "bad" as const, text: "AI paused: the cap is reached" } : u.projectedOverCap ? { tone: "warn" as const, text: "On track to pass the cap" } : { tone: "good" as const, text: "Within budget" };
  return (
    <>
      <PageHeader icon={Cpu} tone="violet" title="AI calls and spend" description="What the AI features cost this month, from the AI call ledger. When the monthly cap is reached, every AI feature pauses until next month or until you raise it." />
      <FilterChips label="Month" param="month" base="/admin/ai" params={params} current={u.month} allValue={thisMonth} options={monthChoices(thisMonth, u.month).map((m) => ({ value: m, label: m === thisMonth ? `This month` : monthLabel(m) }))} />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}

      <section aria-label="Budget" className={cn("relative flex flex-col gap-4 overflow-hidden p-5 sm:p-6", CARD, u.paused && "ring-1 ring-danger/35")}>
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-brand-gradient" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <IconBadge icon={Wallet} tone="violet" />
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold tracking-[-0.02em]">Budget for {monthLabel(u.month)}</h2>
              <p className="text-[13px] text-muted">Cap {usd(u.cap.usd)} ({u.cap.source === "admin" ? "set here" : u.cap.source === "env" ? "from the server settings" : "the default"}).</p>
            </div>
          </div>
          <StatusPill tone={state.tone} dot>{state.text}</StatusPill>
        </div>
        <p className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.02em] sm:text-[36px]">
          {usd(u.spentUsd)} <span className="text-[16px] font-semibold text-muted">of {usd(u.cap.usd)}</span>
        </p>
        <Meter value={u.spentUsd} max={u.cap.usd} label="AI spend against the monthly cap" />
        <p className="text-[14px] text-muted">{u.percentUsed}% used, {usd(u.remainingUsd)} left{u.isCurrentMonth ? `, about ${usd(u.projectedUsd)} by the end of the month` : ""}.</p>
        <ExpandCard icon={Gauge} tone="violet" title="Change the monthly cap" summary="Raise it to un-pause the AI, or lower it to spend less." className="shadow-none">
          <form action={setAiBudgetAction} className="flex flex-wrap items-end gap-3">
            <Field label="Monthly cap in dollars" hint={`Between ${u.cap.minUsd} and ${u.cap.maxUsd}. Leave empty to go back to ${money(Math.round(u.cap.envDefaultUsd * 100))}.`}>
              <Input name="usd" inputMode="decimal" defaultValue={u.cap.source === "admin" ? String(u.cap.usd) : ""} placeholder={String(u.cap.envDefaultUsd)} />
            </Field>
            <Button type="submit">Save cap</Button>
          </form>
        </ExpandCard>
      </section>

      <StatGrid cols={4}>
        <StatTile icon={Coins} tone="violet" label="Spend" value={usd(u.spentUsd)} hint="What the AI calls cost so far, an estimate from the ledger." />
        <StatTile icon={PhoneCall} tone="violet" label="Calls" value={num(u.calls)} hint="Times BuPulse asked an AI for something." />
        <StatTile icon={AlertTriangle} tone="violet" label="Failed calls" value={num(u.failed.count)} alert={u.failed.percentOfCalls >= 5} hint={`${u.failed.percentOfCalls}% of calls did not work.`} />
        <StatTile icon={TrendingUp} tone="violet" label="By month end" value={usd(u.projectedUsd)} hint={u.isCurrentMonth ? "The spend so far, spread over the whole month." : "What the month cost in the end."} />
      </StatGrid>

      <Panel icon={BarChart3} tone="violet" title="Spend per day" description="One point per day, Kigali time.">
        {days.length > 1 ? <LineChart cents labels={days} series={[{ name: `Cost (${currency})`, color: "var(--color-pulse-violet)", values: u.perDay.map((d) => Math.round(d.costUsd * 100)) }]} summary="AI cost per day" format={(v) => usd(v / 100)} /> : <Empty>Not enough days yet.</Empty>}
      </Panel>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Cpu} tone="violet" title="Where the money went" summary={u.perModel[0] ? `Most on ${u.perModel[0].provider} ${u.perModel[0].model}${u.perFeature[0] ? `, for ${u.perFeature[0].feature}` : ""}` : "No calls this month."}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-muted">By model</h3>
              {u.perModel.length === 0 ? <Empty>No calls this month.</Empty> : <Bars color="var(--color-pulse-violet)" rows={u.perModel.map((m) => ({ label: `${m.provider} ${m.model}`, value: m.costUsd, text: `${usd(m.costUsd)} · ${num(m.calls)} calls` }))} />}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-muted">By feature</h3>
              {u.perFeature.length === 0 ? <Empty>No calls this month.</Empty> : <Bars color="var(--color-pulse-violet)" rows={u.perFeature.map((m) => ({ label: m.feature, value: m.costUsd, text: `${usd(m.costUsd)} · ${num(m.calls)} calls` }))} />}
            </div>
          </div>
        </ExpandCard>

        <ExpandCard icon={Users} tone="violet" title="Biggest spenders" summary={u.topSpenders[0] ? `${u.topSpenders[0].business ?? u.topSpenders[0].email ?? "A client"} uses the most: ${u.topSpenders[0].percentOfSpend}% of the spend` : "No client spend yet."}>
          <DataList<Spender>
            caption="Top AI spenders"
            rows={u.topSpenders}
            rowKey={(t) => t.userId}
            rowHref={(t) => `/admin/users/${t.userId}?tab=usage`}
            columns={[
              { key: "client", header: "Client", primary: true, cell: (t) => t.business ?? t.email ?? t.userId },
              { key: "calls", header: "Calls", align: "right", cell: (t) => num(t.calls) },
              { key: "cost", header: "Cost", align: "right", cell: (t) => usd(t.costUsd) },
              { key: "share", header: "Share", align: "right", cell: (t) => `${t.percentOfSpend}%` },
            ]}
            empty={<EmptyState title="No client spend yet." />}
          />
        </ExpandCard>

        <ExpandCard icon={AlertTriangle} tone={u.failed.count ? "red" : "violet"} title="Failed calls" summary={u.failed.count ? `${num(u.failed.count)} this month; the most common: ${u.failed.topErrors[0]?.error.slice(0, 60) ?? "unknown"}` : "No failed calls."}>
          {u.failed.count === 0 ? (
            <Empty>No failed calls.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-[14px]">
              {u.failed.topErrors.map((e) => (
                <li key={e.error} className="flex items-start justify-between gap-3 rounded-2xl bg-soft/70 px-3 py-2 dark:bg-white/[0.04]">
                  <span className="min-w-0 break-words">{e.error}</span>
                  <StatusPill tone="bad">{e.count}</StatusPill>
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">Latest: {u.failed.recent[0] ? `${dateTime(u.failed.recent[0].at)} · ${u.failed.recent[0].provider} ${u.failed.recent[0].feature}` : "none"}. Secrets are removed from the messages.</li>
            </ul>
          )}
        </ExpandCard>

        <ExpandCard icon={Receipt} tone="violet" title="Compare with the provider's bill" summary="The ledger is an estimate; the real invoice replaces it in profit.">
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1.5 text-[14px] text-muted">
              <li>{num(u.calls)} calls recorded this month{u.estimatedCalls > 0 ? `, ${num(u.estimatedCalls)} of them timed out on our side and are counted with estimated usage (the provider still bills them)` : ""}.</li>
              {u.perModel.some((m) => m.approximatePrice) && <li className="text-danger">Priced by family, not exactly: {u.perModel.filter((m) => m.approximatePrice).map((m) => m.model).join(", ")}. Add the model to lib/ai/pricing.ts.</li>}
              <li>Google bills by Pacific time and adds tax where it applies; the console counts Kigali months, before tax. How the estimate works: docs/AI_COSTS.md.</li>
            </ul>
            <Link href={`/admin/costs?month=${u.month}#bills`} className="w-fit text-sm font-semibold text-pulse-blue underline">Enter the bill in Costs</Link>
          </div>
        </ExpandCard>
      </div>
    </>
  );
}
