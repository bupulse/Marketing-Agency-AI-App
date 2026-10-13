import { requireAdmin } from "@/lib/admin/auth";
import Link from "next/link";
import { PageHeader } from "@/components/app";
import { LineChart } from "@/components/admin/charts";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { OverviewDashboard, type OverviewData } from "@/components/admin/overview-dashboard";
import { Empty, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { getActivity } from "@/lib/admin/activity";
import { getAiBudgetStatus } from "@/lib/admin/ai-usage";
import { getAttention } from "@/lib/admin/attention";
import { rangeFor } from "@/lib/admin/format";
import { getInboxCounts } from "@/lib/admin/inbox";
import { getClientCounts, getDemosToday } from "@/lib/admin/overview";
import { getMetrics } from "@/lib/analytics/queries";
import { getMoneyReport } from "@/lib/money/report";

export const metadata = { title: "Overview" };

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function AdminOverview() {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const [report, clients, demos, inbox, ai, attention, activity, series] = await Promise.all([
    getMoneyReport({ months: 6 }).catch(() => null),
    getClientCounts().catch(() => ({ active: 0, trial: 0, pastDue: 0, waitingDemo: 0, ended: 0, total: 0 })),
    getDemosToday().catch(() => ({ today: 0, next: null })),
    getInboxCounts(),
    getAiBudgetStatus().catch(() => null),
    getAttention().catch(() => []),
    getActivity({ limit: 8 }).catch(() => ({ items: [], newest: null, nextBefore: null, more: false })),
    getMetrics(rangeFor(30), ["visits", "signups"]).catch(() => ({}) as Record<string, { date: string; dimension: string; value: number }[]>),
  ]);

  const months = report?.months ?? [];
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const data: OverviewData = {
    monthLabel: monthName(report?.thisMonth ?? new Date().toISOString().slice(0, 7)),
    prevMonthLabel: prev ? monthName(prev.month).split(" ")[0] : "last month",
    revenue: { monthCents: cur?.revenue.netCents ?? 0, prevCents: prev?.revenue.netCents ?? 0, lifetimeCents: report?.lifetime.revenueCents ?? 0, customersEver: report?.lifetime.customersEver ?? 0, spark: months.map((m) => m.revenue.netCents) },
    mrrCents: report?.mrrCents ?? 0,
    arpuCents: report?.arpuCents ?? null,
    profit: { monthCents: cur?.profitCents ?? 0, prevCents: prev?.profitCents ?? 0, costCents: Math.round(cur?.costs.totalCents ?? 0), estimateCents: Math.round(cur?.costs.estimateCents ?? 0), spark: months.map((m) => m.profitCents) },
    clients,
    todo: { inbox: inbox.total, payments: inbox.payments, demosToday: demos.today, nextDemo: demos.next ? `${demos.next.company} at ${demos.next.startsAt.toISOString().slice(11, 16)} UTC` : null, errors24h: inbox.errors },
    ai,
  };

  const dates = (series.visits ?? []).filter((x) => x.dimension === "").map((x) => x.date);
  const col = (key: string) => {
    const by = new Map((series[key] ?? []).filter((x) => x.dimension === "").map((x) => [x.date, x.value]));
    return dates.map((d) => by.get(d) ?? 0);
  };

  return (
    <>
      <PageHeader title="Overview" description="Today and this month at a glance. Every number links to the page behind it." />
      {!report && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-sm font-medium text-danger">The money numbers could not be loaded just now. Reload in a moment.</p>}

      <Panel title="Needs your attention" description="Anything waiting for you or looking wrong right now." action={<Link href="/admin/inbox" className="text-sm font-medium underline">Open the inbox</Link>}>
        {attention.length === 0 ? (
          <p role="status" className="rounded-2xl bg-success-bg px-4 py-3 text-[15px] font-medium text-success">Nothing needs you right now. <Link href="/admin/health" className="underline">System health</Link> is all good.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.slice(0, 8).map((a) => (
              <li key={a.key} className="flex items-start gap-3 text-[15px]">
                <Badge tone={a.level === "problem" ? "danger" : "violet"}>{a.level}</Badge>
                <Link href={a.href} className="underline">{a.text}</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <OverviewDashboard d={data} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Visits and sign-ups, 30 days" description="Daily counts from BuPulse's own tracker." action={<Link href="/admin/funnels" className="text-sm font-medium underline">Funnels</Link>}>
          {dates.length > 1 ? (
            <LineChart
              labels={dates}
              series={[
                { name: "Visits", color: "var(--color-pulse-blue)", values: col("visits") },
                { name: "Sign-ups", color: "var(--color-pulse-violet)", values: col("signups") },
              ]}
              summary="Daily visits and sign-ups over the last 30 days"
            />
          ) : (
            <Empty>No daily data yet. It appears after the first visits and the nightly roll-up.</Empty>
          )}
        </Panel>
        <Panel title="Live activity" description="The latest things that happened. Updates every 5 seconds." action={<Link href="/admin/activity" className="text-sm font-medium underline">Full feed</Link>}>
          <ActivityFeed initial={activity} compact limit={8} />
        </Panel>
      </div>
    </>
  );
}
