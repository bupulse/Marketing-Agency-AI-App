import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Bars, LineChart } from "@/components/admin/charts";
import { Empty, Panel, Stat, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Meter } from "@/components/ui";
import Link from "next/link";
import { dateTime, money, num, param } from "@/lib/admin/format";
import { getAiUsage } from "@/lib/admin/ai-usage";
import { setAiBudgetAction } from "@/app/admin/(console)/actions";

export const metadata = { title: "AI usage" };


export default async function AiPage({ searchParams }: PageProps<"/admin/ai">) {
  await requirePermission("ai"); // pages render alongside the layout, so check here too
  const fx = moneyFmt(await adminMoney());
  // AI costs are kept in dollars; shown in the admin's currency.
  const usd = (n: number) => fx.text(n * 100);
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.month)) ? param(sp.month) : undefined;
  const u = await getAiUsage({ month });
  const days = u.perDay.map((d) => d.date);
  return (
    <>
      <PageHeader title="AI calls and spend" description={`Spend on AI for ${u.month}, from the AI call ledger. When the monthly cap is reached every AI feature pauses until next month or until you raise it.`} action={<form className="flex items-center gap-2"><Input type="month" name="month" defaultValue={u.month} aria-label="Month" className="min-h-11" /><Button type="submit" size="sm" variant="outline">Show</Button></form>} />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <Panel title="Budget" description={`Cap ${usd(u.cap.usd)} (${u.cap.source === "admin" ? "set here" : u.cap.source === "env" ? "from the environment" : "default"}).`} action={u.paused ? <Badge tone="danger">AI paused: cap reached</Badge> : u.projectedOverCap ? <Badge tone="violet">On track to pass the cap</Badge> : <Badge tone="success">Within budget</Badge>}>
        <Meter value={u.spentUsd} max={u.cap.usd} label="AI spend against the monthly cap" />
        <p className="text-[14px] text-muted">{usd(u.spentUsd)} spent ({u.percentUsed}%), {usd(u.remainingUsd)} left{u.isCurrentMonth ? `, projected ${usd(u.projectedUsd)} by month end` : ""}.</p>
        <form action={setAiBudgetAction} className="flex flex-wrap items-end gap-3">
          <Field label="Monthly cap in dollars" hint={`Between ${u.cap.minUsd} and ${u.cap.maxUsd}. Leave empty to go back to ${money(Math.round(u.cap.envDefaultUsd * 100))}.`}><Input name="usd" inputMode="decimal" defaultValue={u.cap.source === "admin" ? String(u.cap.usd) : ""} placeholder={String(u.cap.envDefaultUsd)} /></Field>
          <Button type="submit">Save cap</Button>
        </form>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Spend" value={usd(u.spentUsd)} source="AI call ledger" />
        <Stat label="Calls" value={num(u.calls)} source="AI call ledger" />
        <Stat label="Failed calls" value={`${u.failed.count}`} source={`${u.failed.percentOfCalls}% of calls`} />
        <Stat label="Projected" value={usd(u.projectedUsd)} source="Spend so far, spread over the month" invert />
      </div>

      <Panel title="Compare with the provider's bill" description="The ledger is an estimate. Once the month's invoice from Google (or Anthropic, ElevenLabs) is in, type it in Costs: it then replaces the estimate in profit." action={<Link href={`/admin/costs?month=${u.month}#bills`} className="text-sm font-medium underline">Enter the bill</Link>}>
        <ul className="flex flex-col gap-1.5 text-[14px] text-muted">
          <li>{num(u.calls)} calls recorded this month{u.estimatedCalls > 0 ? `, ${num(u.estimatedCalls)} of them timed out on our side and are counted with estimated usage (the provider still bills them)` : ""}.</li>
          {u.perModel.some((m) => m.approximatePrice) && (
            <li className="text-danger">Priced by family, not exactly: {u.perModel.filter((m) => m.approximatePrice).map((m) => m.model).join(", ")}. Add the model to lib/ai/pricing.ts.</li>
          )}
          <li>Google bills by Pacific time and adds tax where it applies; the ledger counts UTC months before tax. How the estimate works: docs/AI_COSTS.md.</li>
        </ul>
      </Panel>

      <Panel title="Spend per day">
        {days.length > 1 ? <LineChart cents labels={days} series={[{ name: `Cost (${fx.display.currency})`, color: "var(--color-pulse-blue)", values: u.perDay.map((d) => Math.round(d.costUsd * 100)) }]} summary="AI cost per day" format={(v) => fx.text(v)} /> : <Empty>Not enough days yet.</Empty>}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="By model">
          {u.perModel.length === 0 ? <Empty>No calls this month.</Empty> : <Bars rows={u.perModel.map((m) => ({ label: `${m.provider} ${m.model}`, value: m.costUsd, text: `${usd(m.costUsd)} · ${num(m.calls)} calls` }))} />}
        </Panel>
        <Panel title="By feature">
          {u.perFeature.length === 0 ? <Empty>No calls this month.</Empty> : <Bars color="var(--color-pulse-violet)" rows={u.perFeature.map((m) => ({ label: m.feature, value: m.costUsd, text: `${usd(m.costUsd)} · ${num(m.calls)} calls` }))} />}
        </Panel>
      </div>

      <Panel title="Biggest spenders" description="Clients using the most AI this month.">
        {u.topSpenders.length === 0 ? <Empty>No client spend yet.</Empty> : (
          <TableWrap caption="Top AI spenders">
            <thead><tr><Th>Client</Th><Th right>Calls</Th><Th right>Cost</Th><Th right>Share</Th></tr></thead>
            <tbody>
              {u.topSpenders.map((t) => (
                <tr key={t.userId}><Td><Link href={`/admin/users/${t.userId}?tab=usage`} className="underline">{t.business ?? t.email ?? t.userId}</Link>{t.business && t.email && <span className="block text-xs text-muted">{t.email}</span>}</Td><Td right>{num(t.calls)}</Td><Td right>{usd(t.costUsd)}</Td><Td right>{t.percentOfSpend}%</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Failed calls" description="Most common errors this month (secrets removed).">
        {u.failed.count === 0 ? <Empty>No failed calls.</Empty> : (
          <ul className="flex flex-col gap-2 text-[14px]">
            {u.failed.topErrors.map((e) => (<li key={e.error} className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{e.error}</span><Badge tone="danger">{e.count}</Badge></li>))}
            <li className="pt-2 text-xs text-muted">Latest: {u.failed.recent[0] ? `${dateTime(u.failed.recent[0].at)} · ${u.failed.recent[0].provider} ${u.failed.recent[0].feature}` : "none"}</li>
          </ul>
        )}
      </Panel>
    </>
  );
}
