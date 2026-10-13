import "server-only";
// The money report behind Overview, Revenue and profit, and Usage per client: revenue from every client ever
// (BillingEvent), MRR, ARPU, churn, costs (./costs.ts) and profit, per month, per plan and per client.
// How each number is made is written next to it on the page and in docs/ADMIN.md, "Money".
import { prisma } from "@/lib/db";
import { MONEY_EVENT_TYPES } from "@/lib/analytics/math";
import { getPlans } from "@/lib/plan-catalog";
import { planForAnyPriceId } from "@/lib/region-prices";
import { addMonths, monthsBetween, type MonthCosts } from "./costs-shared";
import { getMonthCosts } from "./costs";
import { dedupe, lastFullPayments, stoppedAt, mrrOf, rateUsed, revenueByClient, revenueByMonth, revenueByPlan, toRevenueEntry, type PayingSub, type RevenueEntry, type RevenueMonth } from "./revenue-shared";
import { kigaliMonthOf } from "@/lib/time/kigali";

const DAY = 86_400_000;
const PAYING = ["ACTIVE", "PAST_DUE"] as const;

/** Safety cap on billing events read for one report. Newest first, so a cap only ever leaves out the oldest. */
export const REVENUE_EVENT_CAP = 200_000;
const BATCH = 5_000;

/**
 * Every payment and refund ever recorded, oldest first, read newest first in batches. `truncated` is true only when
 * there are more than REVENUE_EVENT_CAP money events: the oldest beyond the cap are left out and the page says so.
 */
export async function loadRevenue(): Promise<{ entries: RevenueEntry[]; truncated: boolean }> {
  const out: RevenueEntry[] = [];
  let cursor: string | undefined;
  let read = 0;
  for (;;) {
    const rows = await prisma.billingEvent.findMany({
      where: { type: { in: MONEY_EVENT_TYPES } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, eventId: true, type: true, payload: true, createdAt: true, userId: true },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const r of rows) {
      const e = toRevenueEntry(r);
      if (e) out.push(e);
    }
    read += rows.length;
    if (rows.length < BATCH) break;
    if (read >= REVENUE_EVENT_CAP) return { entries: dedupe(out).reverse(), truncated: true };
    cursor = rows[rows.length - 1].id;
  }
  return { entries: dedupe(out).reverse(), truncated: false };
}

export async function loadRevenueEntries(): Promise<RevenueEntry[]> {
  return (await loadRevenue()).entries;
}

/** The plan of a card payment from its Paddle price id (one lookup per distinct price). */
async function cardPlans(entries: RevenueEntry[]): Promise<Map<string, string>> {
  const ids = [...new Set(entries.filter((e) => e.priceId && !e.plan).map((e) => e.priceId as string))].slice(0, 50);
  const out = new Map<string, string>();
  for (const id of ids) {
    const hit = await planForAnyPriceId("PADDLE", id).catch(() => null);
    if (hit) out.set(id, hit.plan);
  }
  return out;
}

export type ClientMoney = {
  userId: string | null;
  businessId: string | null;
  name: string;
  email: string | null;
  plan: string | null;
  status: string | null;
  paying: boolean;
  deleted: boolean;
  revenueCents: number;
  payments: number;
  firstAt: string;
  lastAt: string;
  aiCostCents: number;
  mrrCents: number;
};

export type MoneyReport = {
  now: string;
  thisMonth: string;
  /** More money events than REVENUE_EVENT_CAP: the oldest are left out of lifetime numbers (shown on the page). */
  truncated: boolean;
  rwfPerUsd: number;
  months: { month: string; revenue: RevenueMonth; costs: MonthCosts; profitCents: number; rate: number | null }[];
  lifetime: { revenueCents: number; costCents: number; profitCents: number; customersEver: number; payingNow: number; churned: number; firstMonth: string | null };
  mrrCents: number;
  arpuCents: number | null;
  churn: { lost30: number; pct: number | null };
  byPlan: { plan: string; netCents: number; clients: number; mrrCents: number; payingNow: number }[];
  clients: ClientMoney[];
};

const REPORT_TTL_MS = 60_000;
const reportCache = new Map<number, { at: number; value: Promise<MoneyReport> }>();

/**
 * getMoneyReport, kept 60 seconds per server instance (the Overview and the Money pages are opened often; payments
 * and costs change rarely). A write on the Costs page clears it (clearMoneyReportCache).
 */
export function getMoneyReportCached(months = 12): Promise<MoneyReport> {
  const hit = reportCache.get(months);
  if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit.value;
  const value = getMoneyReport({ months });
  reportCache.set(months, { at: Date.now(), value });
  value.catch(() => reportCache.delete(months));
  return value;
}

export function clearMoneyReportCache() {
  reportCache.clear();
}

/**
 * Everything the Money pages show. `months` is how many recent months the month table covers (lifetime totals always
 * cover every month since the first payment or cost).
 */
export async function getMoneyReport(opts: { months?: number; now?: Date } = {}): Promise<MoneyReport> {
  const now = opts.now ?? new Date();
  const thisMonth = kigaliMonthOf(now);
  const { entries, truncated } = await loadRevenue();
  const [firstCall, firstCost] = await Promise.all([
    prisma.aiCall.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.recurringCost.findFirst({ orderBy: { startMonth: "asc" }, select: { startMonth: true } }),
  ]);
  const starts = [entries[0]?.month, firstCall ? kigaliMonthOf(firstCall.createdAt) : undefined, firstCost?.startMonth].filter((m): m is string => !!m && m <= thisMonth);
  const firstMonth = starts.length ? starts.sort()[0] : null;
  const recentFrom = addMonths(thisMonth, -Math.max(1, Math.min(opts.months ?? 12, 36)) + 1);
  const from = firstMonth && firstMonth < recentFrom ? firstMonth : recentFrom;
  const allMonths = monthsBetween(from, thisMonth);

  const [{ months: costMonths, rwfPerUsd }, subs, plans, priced] = await Promise.all([
    getMonthCosts(from, thisMonth),
    prisma.subscription.findMany({ select: { userId: true, plan: true, status: true, interval: true, provider: true, currentPeriodEnd: true } }),
    getPlans().catch(() => []),
    cardPlans(entries),
  ]);
  const revenueMonths = revenueByMonth(entries, allMonths);
  const months = allMonths.map((month, i) => {
    const revenue = revenueMonths[i];
    const costs = costMonths[i];
    return { month, revenue, costs, profitCents: Math.round(revenue.netCents - costs.totalCents), rate: rateUsed(revenue.rwfMinor, revenue.rwfUsdCents) };
  });

  // --- MRR, ARPU, churn ---
  const payingSubs: PayingSub[] = subs.filter((s) => s.plan !== "TRIAL" && (PAYING as readonly string[]).includes(s.status)).map((s) => ({ userId: s.userId, plan: s.plan, interval: s.interval, provider: s.provider }));
  const lastMomo = lastFullPayments(entries);
  const prices = Object.fromEntries(plans.map((p) => [p.key, { monthlyPriceCents: p.monthlyPriceCents, yearlyPriceCents: p.yearlyPriceCents }]));
  const mrr = mrrOf(payingSubs, lastMomo, prices);
  const payingIds = new Set(payingSubs.map((s) => s.userId));
  const clientRevenue = revenueByClient(entries);
  const everPaid = clientRevenue.filter((c) => c.payments > 0);
  const subOf = new Map(subs.map((s) => [s.userId, s]));
  // Stopped in the last 30 days: the paid period ended (cancelled or expired), or, without that, the last payment's
  // period ran out (deleted account, back on another state). Never the subscription's last edit.
  const lost30 = everPaid.filter((c) => {
    if (!c.userId) return false;
    const sub = subOf.get(c.userId);
    const stop = stoppedAt({ paying: payingIds.has(c.userId), status: sub?.status ?? null, periodEnd: sub?.currentPeriodEnd ?? null, interval: sub?.interval ?? null, lastPaymentAt: c.lastAt });
    return !!stop && stop.getTime() <= now.getTime() && now.getTime() - stop.getTime() <= 30 * DAY;
  }).length;

  // --- Per client ---
  const userIds = clientRevenue.map((c) => c.userId).filter((v): v is string => !!v);
  const [users, aiByBusiness] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, business: { select: { id: true, name: true } } } }) : Promise.resolve([]),
    prisma.aiCall.groupBy({ by: ["businessId"], where: { businessId: { not: null } }, _sum: { costUsd: true } }),
  ]);
  const userOf = new Map(users.map((u) => [u.id, u]));
  const aiOf = new Map(aiByBusiness.map((a) => [a.businessId as string, Number(a._sum.costUsd ?? 0) * 100]));
  const clients: ClientMoney[] = clientRevenue.map((c) => {
    const u = c.userId ? userOf.get(c.userId) : undefined;
    const sub = c.userId ? subOf.get(c.userId) : undefined;
    return {
      userId: c.userId,
      businessId: u?.business?.id ?? null,
      name: u?.business?.name ?? (c.userId ? "Deleted account" : "Unknown payer"),
      email: u?.email ?? null,
      plan: sub?.plan ?? null,
      status: sub?.status ?? null,
      paying: !!c.userId && payingIds.has(c.userId),
      deleted: !!c.userId && !u,
      revenueCents: c.netCents,
      payments: c.payments,
      firstAt: c.firstAt.toISOString(),
      lastAt: c.lastAt.toISOString(),
      aiCostCents: u?.business ? Math.round((aiOf.get(u.business.id) ?? 0) * 100) / 100 : 0,
      mrrCents: c.userId ? (mrr.byUser.get(c.userId) ?? 0) : 0,
    };
  });

  // --- Per plan ---
  const planRevenue = revenueByPlan(entries, (e) => (e.priceId ? priced.get(e.priceId) : undefined) ?? (e.userId ? (subOf.get(e.userId)?.plan ?? null) : null));
  const planKeys = new Set([...planRevenue.map((p) => p.plan), ...payingSubs.map((s) => s.plan)]);
  const byPlan = [...planKeys].map((plan) => {
    const r = planRevenue.find((p) => p.plan === plan);
    const subsOf = payingSubs.filter((s) => s.plan === plan);
    return { plan, netCents: r?.netCents ?? 0, clients: r?.clients ?? 0, payingNow: subsOf.length, mrrCents: subsOf.reduce((s, x) => s + (mrr.byUser.get(x.userId) ?? 0), 0) };
  }).sort((a, b) => b.netCents - a.netCents || b.mrrCents - a.mrrCents);

  const lifetimeRevenue = entries.reduce((s, e) => s + e.usdCents, 0);
  const lifetimeCost = costMonths.reduce((s, m) => s + m.totalCents, 0);
  return {
    now: now.toISOString(),
    thisMonth,
    truncated,
    rwfPerUsd,
    months: months.filter((m) => m.month >= recentFrom),
    lifetime: {
      revenueCents: lifetimeRevenue,
      costCents: Math.round(lifetimeCost),
      profitCents: Math.round(lifetimeRevenue - lifetimeCost),
      customersEver: everPaid.length,
      payingNow: payingIds.size,
      churned: everPaid.filter((c) => !c.userId || !payingIds.has(c.userId)).length,
      firstMonth,
    },
    mrrCents: mrr.totalCents,
    arpuCents: payingIds.size ? Math.round(mrr.totalCents / payingIds.size) : null,
    churn: { lost30, pct: payingIds.size + lost30 > 0 ? Math.round((lost30 / (payingIds.size + lost30)) * 1000) / 10 : null },
    byPlan,
    clients,
  };
}
