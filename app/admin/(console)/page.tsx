import { moneyFmt } from "@/components/admin/money";
import { adminMoney } from "@/lib/money/display-server";
import { notFound, redirect } from "next/navigation";
import { can, requireAdmin } from "@/lib/admin/auth";
import { findNavItem, firstPageFor, navFor } from "@/components/admin/nav";
import Link from "next/link";
import { Activity, ChartLine, Smartphone, Sun } from "lucide-react";
import { LineChart } from "@/components/admin/charts";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { AreaCards, OverviewDashboard, OverviewToday, areaFigures, greeting, kigaliDayLabel, needsYouItems, type OverviewData } from "@/components/admin/overview-dashboard";
import { KitStyles } from "@/components/admin/kit/kit-styles";
import { PageHeader } from "@/components/admin/kit/page-header";
import { TodoList } from "@/components/admin/kit/todo-list";
import { Empty, Panel, Section, notice } from "@/components/admin/ui";
import { getActivity } from "@/lib/admin/activity";
import { getAiBudgetStatus } from "@/lib/admin/ai-usage";
import { getAttention } from "@/lib/admin/attention";
import { param, rangeFor } from "@/lib/admin/format";
import { getInboxCounts, inboxTotalFor, INBOX_PERMISSION, type InboxKey } from "@/lib/admin/inbox";
import { getClientCounts, getDemosToday } from "@/lib/admin/overview";
import { getMetrics } from "@/lib/analytics/queries";
import { getMoneyReportCached } from "@/lib/money/report";
import { PendingPaymentList } from "@/components/admin/payments/pending-payments";
import { TodayPayments, TodayTimeline } from "@/components/admin/overview-today";
import { getTodayPayments, getTodayTimeline, type TodayPayment } from "@/lib/admin/today";
import { listManualPayments } from "@/lib/billing/momo";
import { confirmPaymentAction, rejectPaymentAction } from "@/app/admin/(console)/(money)/payments/actions";
import { kigaliMonthOf } from "@/lib/time/kigali";

export const metadata = { title: "Overview" };

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const link = "text-sm font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]";

// The console's home, calm (owner, 10 Nov 2026): a greeting, "Needs you" (every to-do and warning this person may act
// on), the payments waiting (approve or reject right here, as before), today's numbers, one card per area, then this
// month's money, clients and AI, today's payments and timeline, and the visits chart and live feed. Same data as before.
export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  const me = await requireAdmin(); // pages render alongside the layout, so check here too
  // Without the Overview (a sales agent, the content team...), /admin opens the first page the role may see.
  if (!can(me, "overview")) {
    const first = firstPageFor(me.permissions);
    if (first && first !== "/admin") redirect(first);
    notFound();
  }
  const sp = await searchParams;
  const fx = moneyFmt(await adminMoney());
  // Each section shows only to someone allowed to see it (the Overview itself needs "overview").
  const seeMoney = can(me, "money.revenue");
  const seePayments = can(me, ["payments.view", "payments.approve"]);
  const canApprove = can(me, "payments.approve");
  const [report, clients, demos, inbox, ai, attention, activity, series, pending, todayPayments] = await Promise.all([
    seeMoney ? getMoneyReportCached(6).catch(() => null) : Promise.resolve(null),
    getClientCounts().catch(() => ({ active: 0, trial: 0, pastDue: 0, waitingDemo: 0, ended: 0, total: 0 })),
    getDemosToday().catch(() => ({ today: 0, next: null })),
    getInboxCounts(),
    can(me, "ai") ? getAiBudgetStatus().catch(() => null) : Promise.resolve(null),
    getAttention().catch(() => []),
    getActivity({ limit: 8 }).catch(() => ({ items: [], newest: null, nextBefore: null, more: false })),
    getMetrics(rangeFor(30), ["visits", "signups"]).catch(() => ({}) as Record<string, { date: string; dimension: string; value: number }[]>),
    // The same filter as Payments, the Inbox and the sidebar badge (TO_CHECK_WHERE). A failed read says so: it never
    // shows as "Nothing to approve".
    seePayments ? listManualPayments({ toCheck: true, limit: 20 }).then((p) => p.items).catch(() => null) : Promise.resolve([]),
    seePayments || seeMoney ? getTodayPayments(new Date(), fx.display).catch(() => [] as TodayPayment[]) : Promise.resolve([] as TodayPayment[]),
  ]);
  // Each attention line only for someone who may open the page it links to.
  const attentionShown = attention.filter((a) => {
    const page = findNavItem(a.href.split(/[?#]/)[0]);
    return !!page && can(me, page.perm);
  });
  const timeline = await getTodayTimeline(new Date(), seePayments || seeMoney ? todayPayments : []).catch(() => []);

  // Payments to check: the count the sidebar shows, never fewer than the list below shows.
  const waiting = pending === null ? inbox.payments : Math.max(inbox.payments, pending.length);
  const months = report?.months ?? [];
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const data: OverviewData = {
    monthLabel: monthName(report?.thisMonth ?? kigaliMonthOf(new Date())),
    prevMonthLabel: prev ? monthName(prev.month).split(" ")[0] : "last month",
    revenue: { monthCents: cur?.revenue.netCents ?? 0, prevCents: prev?.revenue.netCents ?? 0, lifetimeCents: report?.lifetime.revenueCents ?? 0, customersEver: report?.lifetime.customersEver ?? 0, spark: months.map((m) => m.revenue.netCents) },
    mrrCents: report?.mrrCents ?? 0,
    rwf: { month: cur?.revenue ?? { rwfMinor: 0, rwfUsdCents: 0 }, lifetime: report?.lifetime ?? { rwfMinor: 0, rwfUsdCents: 0 }, mrr: report?.mrrRwf ?? { rwfMinor: 0, rwfUsdCents: 0 }, arpu: report?.arpuRwf ?? null },
    arpuCents: report?.arpuCents ?? null,
    profit: { monthCents: cur?.profitCents ?? 0, prevCents: prev?.profitCents ?? 0, costCents: Math.round(cur?.costs.totalCents ?? 0), estimateCents: Math.round(cur?.costs.estimateCents ?? 0), spark: months.map((m) => m.profitCents) },
    clients,
    todo: { inbox: inboxTotalFor(inbox, me.permissions), payments: waiting, demosToday: demos.today, nextDemo: demos.next ? `${demos.next.company} at ${demos.next.startsAt.toISOString().slice(11, 16)} UTC` : null, errors24h: inbox.errors },
    ai,
  };

  // The to-do counts this person may act on (the same rule as the Inbox and its badge).
  const myCounts: Partial<Record<InboxKey, number>> = {};
  for (const key of Object.keys(INBOX_PERMISSION) as InboxKey[]) if (can(me, INBOX_PERMISSION[key])) myCounts[key] = inbox[key];
  const todos = needsYouItems({ counts: myCounts, attention: attentionShown, paymentsWaiting: waiting });
  const groups = navFor(me.permissions).filter((g) => g.id !== "home");
  const figures = areaFigures({ counts: myCounts, d: data, fx, see: { money: seeMoney, clients: can(me, "clients.view"), ai: can(me, "ai"), system: can(me, "system") } });

  const dates = (series.visits ?? []).filter((x) => x.dimension === "").map((x) => x.date);
  const col = (key: string) => {
    const by = new Map((series[key] ?? []).filter((x) => x.dimension === "").map((x) => [x.date, x.value]));
    return dates.map((d) => by.get(d) ?? 0);
  };
  const now = new Date();

  return (
    <>
      <KitStyles />
      <PageHeader
        icon={Sun}
        tone="orange"
        eyebrow={kigaliDayLabel(now)}
        title={greeting(now, me.email)}
        description={todos.length ? "Here is what needs you today. Everything else is one tap away in the cards below." : "Nothing is waiting for you. Everything else is one tap away in the cards below."}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {seeMoney && !report && <p role="alert" className={notice.bad}>The money numbers could not be loaded just now. Reload in a moment.</p>}

      <Section title="Needs you" description="Anything waiting for you or looking wrong right now, worst first." action={<Link href="/admin/inbox" className={link}>Open the inbox</Link>}>
        <TodoList items={todos} limit={6} columns={2} empty={{ title: "Nothing needs you right now.", hint: "No to-dos and no warnings. System health is all good." }} />
      </Section>

      {seePayments && (pending === null || pending.length > 0) && (
        <Panel
          id="waiting"
          icon={Smartphone}
          tone="green"
          title={waiting ? `Waiting for approval (${waiting})` : "Waiting for approval"}
          description={canApprove ? "Mobile Money payments clients say they made. Check the money arrived, then approve or reject with a reason." : "Mobile Money payments waiting for Finance or the owner."}
          action={<Link href="/admin/payments" className={link}>All payments</Link>}
        >
          {pending === null ? (
            <p role="alert" className={notice.bad}>
              The payments waiting could not be loaded just now. Reload in a moment, or open <Link href="/admin/payments" className="underline">Payments</Link>.
            </p>
          ) : (
            <>
              <PendingPaymentList items={pending} canApprove={canApprove} confirmAction={confirmPaymentAction} rejectAction={rejectPaymentAction} />
              {waiting > pending.length && <p className="pt-3 text-sm text-muted"><Link href="/admin/payments" className="underline">{waiting - pending.length} more on Payments</Link></p>}
            </>
          )}
        </Panel>
      )}

      <Section title="Today" description="Right now, at a glance. Tap a number for the page behind it.">
        <OverviewToday d={data} />
      </Section>

      {groups.length > 0 && (
        <Section title="Go to" description="Every area of the console, one card each. The number is the one to watch.">
          <AreaCards groups={groups} figures={figures} />
        </Section>
      )}

      <OverviewDashboard d={data} fx={fx} today={false} show={{ money: seeMoney, clients: can(me, "clients.view"), ai: can(me, "ai") }} />

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {(seePayments || seeMoney) && <TodayPayments payments={todayPayments} fx={fx} />}
        <TodayTimeline items={timeline} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel icon={ChartLine} tone="pink" title="Visits and sign-ups, 30 days" description="Daily counts from BuPulse's own tracker." action={<Link href="/admin/funnels" className={link}>Funnels</Link>}>
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
        <Panel icon={Activity} tone="slate" title="Live activity" description="The latest things that happened. Updates every 5 seconds." action={<Link href="/admin/activity" className={link}>Full feed</Link>}>
          <ActivityFeed initial={activity} compact limit={8} />
        </Panel>
      </div>
    </>
  );
}
