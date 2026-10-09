import { requireAdmin } from "@/lib/admin/auth";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { LineChart, Spark } from "@/components/admin/charts";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { getActivity } from "@/lib/admin/activity";
import { getAttention } from "@/lib/admin/attention";
import { Empty, Panel, Stat } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { money, num, pct, rangeFor } from "@/lib/admin/format";
import { getMetrics, getOverview, getWhatsWorking } from "@/lib/analytics/queries";
import type { Overview } from "@/lib/analytics/types";

export const metadata = { title: "Overview" };

const PERIODS = [
  { key: "today", title: "Today", days: 1 },
  { key: "7d", title: "Last 7 days", days: 7 },
  { key: "30d", title: "Last 30 days", days: 30 },
] as const;

function Tiles({ o, days }: { o: Overview; days: number }) {
  const prev = days > 1;
  const p = o.previous;
  const base = `/admin/revenue`;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Stat label="Visits" value={num(o.visits)} previous={prev ? { now: o.visits, before: p.visits } : undefined} source="Page views on the marketing site" href="/admin/funnels" />
      <Stat label="Sign-ups" value={num(o.signups)} previous={prev ? { now: o.signups, before: p.signups } : undefined} source="Accounts created" href="/admin/funnels" />
      <Stat label="Trials started" value={num(o.trialStarts)} source="New trial subscriptions" href="/admin/funnels" />
      <Stat label="Paid" value={num(o.paidStarts)} previous={prev ? { now: o.paidStarts, before: p.paidStarts } : undefined} source="First paid subscriptions" href="/admin/funnels" note={o.trialToPaidPct != null ? `${pct(o.trialToPaidPct)} of trials` : undefined} />
      <Stat label="Active users" value={`${num(o.dau)} / ${num(o.wau)} / ${num(o.mau)}`} source="Daily / weekly / monthly active" note="Users with a product event" />
      <Stat label="MRR" value={money(o.mrrCents)} source={`${num(o.activeSubscriptions)} active subscriptions (Paddle)`} href={base} />
      <Stat label="Revenue" value={money(o.revenueCents)} previous={prev ? { now: o.revenueCents, before: p.revenueCents } : undefined} source="Paddle payments less refunds" href={base} />
      <Stat label="Costs" value={money(o.costCents)} previous={prev ? { now: o.costCents, before: p.costCents } : undefined} invert source="AI ledger plus monthly costs" href={`${base}#costs`} />
      <Stat label="Profit" value={money(o.profitCents)} previous={prev ? { now: o.profitCents, before: p.profitCents } : undefined} source="Revenue minus costs" href={base} />
      <Stat label="Cancellations" value={num(o.cancellations)} source={o.churnPct != null ? `${pct(o.churnPct)} churn` : "Subscriptions cancelled"} />
    </div>
  );
}

export default async function AdminOverview() {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const range30 = rangeFor(30);
  const [attention, activity, overviews, series, working] = await Promise.all([
    getAttention().catch(() => []),
    getActivity({ limit: 8 }).catch(() => ({ items: [], newest: null, nextBefore: null, more: false })),
    Promise.all(PERIODS.map((p) => getOverview(rangeFor(p.days)))),
    getMetrics(range30, ["visits", "signups", "revenue_cents", "profit_cents"]),
    getWhatsWorking(range30),
  ]);
  const empty = overviews[2].visits === 0 && overviews[2].signups === 0 && overviews[2].revenueCents === 0;
  const dates = (series.visits ?? []).filter((x) => x.dimension === "").map((x) => x.date);
  const col = (key: string) => {
    const by = new Map((series[key] ?? []).filter((x) => x.dimension === "").map((x) => [x.date, x.value]));
    return dates.map((d) => by.get(d) ?? 0);
  };

  return (
    <>
      <PageHeader title="Overview" description="Real numbers from BuPulse’s own tracker, the database and Paddle. Each tile says where it comes from." />
      {empty && (
        <EmptyState
          icon={BarChart3}
          title="No data yet"
          text="Numbers appear after the first visits and sign-ups, and after the nightly roll-up has run once."
        />
      )}
      <Panel title="Needs your attention" description="Everything that is waiting for you or looks wrong right now.">
        {attention.length === 0 ? (
          <p role="status" className="rounded-2xl bg-success-bg px-4 py-3 text-[15px] font-medium text-success">Nothing needs you right now. <Link href="/admin/health" className="underline">System health</Link> is all good.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.map((a) => (
              <li key={a.key} className="flex items-start gap-3 text-[15px]">
                <Badge tone={a.level === "problem" ? "danger" : "violet"}>{a.level}</Badge>
                <Link href={a.href} className="underline">{a.text}</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {PERIODS.map((p, i) => (
        <section key={p.key} aria-labelledby={`h-${p.key}`} className="flex flex-col gap-3">
          <h2 id={`h-${p.key}`} className="px-1 text-lg font-semibold tracking-[-0.02em]">
            {p.title}
          </h2>
          <Tiles o={overviews[i]} days={p.days} />
        </section>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Visits and sign-ups, 30 days" description="Daily counts from the roll-up table.">
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
            <Empty>No daily data yet.</Empty>
          )}
        </Panel>
        <Panel title="Revenue and profit, 30 days" description="USD, from Paddle and the cost ledger." >
          {dates.length > 1 ? (
            <LineChart
              cents
              labels={dates}
              series={[
                { name: "Revenue", color: "var(--color-pulse-blue)", values: col("revenue_cents") },
                { name: "Profit", color: "var(--color-pulse-violet)", values: col("profit_cents") },
              ]}
              summary="Daily revenue and profit over the last 30 days"
            />
          ) : (
            <Empty>No daily data yet.</Empty>
          )}
          <Spark values={col("profit_cents")} label="Profit trend" />
        </Panel>
      </div>

      <Panel title="Live activity" description="The latest things that happened. Updates every 5 seconds." action={<Link href="/admin/activity" className="text-sm font-medium underline">Open the full feed</Link>}>
        <ActivityFeed initial={activity} compact limit={8} />
      </Panel>

      <Panel title="What’s working" description="Last 30 days. Counts are real businesses and visits; nothing is estimated." action={<Link href="/admin/content" className="text-sm font-medium underline">Content performance</Link>}>
        <div className="grid gap-5 md:grid-cols-3">
          <WorkingList title="Traffic sources" rows={working.sources.slice(0, 5).map((r) => ({ key: r.key, line: `${num(r.visits ?? 0)} visits, ${r.signups} sign-ups, ${r.paid} paid` }))} />
          <WorkingList title="Industries" rows={working.industries.slice(0, 5).map((r) => ({ key: r.key, line: `${r.signups} sign-ups, ${r.paid} paid` }))} />
          <WorkingList title="Landing pages" rows={working.landingPages.slice(0, 5).map((r) => ({ key: r.key, line: `${r.signups} sign-ups, ${r.paid} paid` }))} />
          <WorkingList title="Networks" rows={working.networks.slice(0, 5).map((r) => ({ key: r.network, line: `${r.posts} posts, avg ${Math.round(r.avgEngagement)} engagement` }))} />
          <WorkingList title="Content formats" rows={working.contentFormats.slice(0, 5).map((r) => ({ key: r.format, line: `${r.posts} posts, avg ${Math.round(r.avgEngagement)} engagement` }))} />
          <div className="flex flex-col gap-2">
            <h3 className="text-[15px] font-semibold">Features, paying vs cancelled</h3>
            {working.featuresPaidVsChurned.length === 0 ? (
              <p className="text-sm text-muted">Not enough subscribers yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {working.featuresPaidVsChurned.slice(0, 5).map((f) => (
                  <li key={f.feature} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="truncate">{f.feature}</span>
                    <span className="text-muted">
                      <Badge tone="success">{pct(f.paidPct)} paid</Badge> <Badge tone="neutral">{pct(f.churnedPct)} cancelled</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}

function WorkingList({ title, rows }: { title: string; rows: { key: string; line: string }[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No data yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col">
              <span className="truncate font-medium">{r.key || "(none)"}</span>
              <span className="text-muted">{r.line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
