import "server-only";
// Client health and usage per client (Admin -> Clients). One pass over the companies, their subscription, this
// period's usage, their last activity and their AI cost this month. Rules: ./client-health-shared.ts.
import { prisma } from "@/lib/db";
import { usageWindowStart } from "@/lib/billing/period";
import { getPlans } from "@/lib/plan-catalog";
import { USAGE_METRICS, type UsageMetric } from "@/lib/plans";
import { loadRevenueEntries } from "@/lib/money/report";
import { lastFullPayments, mrrOf, mrrRwf, NO_RWF, type RwfPart } from "@/lib/money/revenue-shared";
import { healthFlags, riskLevel, riskScore, usageShareOf, type HealthFlag } from "./client-health-shared";
import { kigaliMonthStart } from "@/lib/time/kigali";

const DAY = 86_400_000;
const MAX_COMPANIES = 500;

export type ClientRow = {
  businessId: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  plan: string | null;
  status: string | null;
  trialEndsAt: string | null;
  periodStart: string | null;
  lastActiveAt: string | null;
  used: Record<UsageMetric, number>;
  limits: Record<UsageMetric, number>;
  usageShare: number | null;
  aiCostMonthCents: number;
  mrrCents: number;
  /** The RWF part of mrrCents (a Mobile Money client paying in RWF): exact in RWF. */
  mrrRwf?: RwfPart;
  flags: HealthFlag[];
  risk: "high" | "medium" | "ok";
  score: number;
};

/** Every company (newest 500) with its health flags and this period's usage, riskiest first. */
export async function getClientRows(now = new Date()): Promise<ClientRow[]> {
  const monthStart = kigaliMonthStart(now);
  const companies = await prisma.business.findMany({
    orderBy: { createdAt: "desc" },
    take: MAX_COMPANIES,
    select: {
      id: true, name: true, phone: true, userId: true,
      user: { select: { email: true, suspendedAt: true, subscription: { select: { plan: true, status: true, interval: true, provider: true, trialEndsAt: true, currentPeriodStart: true } } } },
    },
  });
  if (companies.length === 0) return [];
  const ids = companies.map((c) => c.id);
  const userIds = companies.map((c) => c.userId);
  const [plans, usage, ai, last, entries] = await Promise.all([
    getPlans().catch(() => []),
    prisma.usageRecord.findMany({ where: { userId: { in: userIds }, periodStart: { gte: new Date(now.getTime() - 400 * DAY) } }, orderBy: { periodStart: "desc" } }),
    prisma.aiCall.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
    prisma.$queryRaw<{ id: string; at: Date | null }[]>`
      SELECT b."id", GREATEST(
        (SELECT MAX(a."createdAt") FROM "AiCall" a WHERE a."businessId" = b."id"),
        (SELECT MAX(e."createdAt") FROM "AnalyticsEvent" e WHERE e."businessId" = b."id"),
        (SELECT MAX(p."createdAt") FROM "Post" p WHERE p."businessId" = b."id"),
        (SELECT MAX(u.last_sign_in_at) FROM "Membership" m JOIN auth.users u ON u.id = m."userId" WHERE m."businessId" = b."id")
      ) AS at
      FROM "Business" b WHERE b."id" = ANY(${ids}::text[])`.catch(() => [] as { id: string; at: Date | null }[]),
    loadRevenueEntries().catch(() => []),
  ]);
  const limitsOf = new Map(plans.map((p) => [p.key, p.limits]));
  const aiOf = new Map(ai.map((a) => [a.businessId as string, Number(a._sum.costUsd ?? 0) * 100]));
  const lastOf = new Map(last.map((l) => [l.id, l.at]));
  const lastMomo = lastFullPayments(entries);
  const paying = companies
    .filter((c) => c.user.subscription && c.user.subscription.plan !== "TRIAL" && ["ACTIVE", "PAST_DUE"].includes(c.user.subscription.status))
    .map((c) => ({ userId: c.userId, plan: c.user.subscription!.plan, interval: c.user.subscription!.interval, provider: c.user.subscription!.provider }));
  const prices = Object.fromEntries(plans.map((p) => [p.key, { monthlyPriceCents: p.monthlyPriceCents, yearlyPriceCents: p.yearlyPriceCents }]));
  const mrr = mrrOf(paying, lastMomo, prices).byUser;
  const mrrRwfOf = mrrRwf(paying, entries, mrr);

  return companies
    .map((c) => {
      const sub = c.user.subscription;
      const periodStart = sub ? usageWindowStart(sub.currentPeriodStart, now) : null;
      const record = periodStart ? usage.find((u) => u.userId === c.userId && u.periodStart.getTime() === periodStart.getTime()) : undefined;
      const used: Record<UsageMetric, number> = { text: record?.textGenerations ?? 0, image: record?.imageGenerations ?? 0, videos: record?.videos ?? 0, voiceCharacters: record?.voiceCharacters ?? 0, chat: record?.chatMessages ?? 0, videoCredits: record?.videoCredits ?? 0 };
      const planLimits = sub ? limitsOf.get(sub.plan) : undefined;
      const limits = Object.fromEntries(USAGE_METRICS.map((m) => [m, planLimits?.[m] ?? 0])) as Record<UsageMetric, number>;
      const usageShare = usageShareOf(used, limits);
      const lastActive = lastOf.get(c.id) ?? null;
      const flags = healthFlags({ status: sub?.status ?? null, plan: sub?.plan ?? null, trialEndsAt: sub?.trialEndsAt ?? null, lastActiveAt: lastActive, usageShare, periodDays: periodStart ? (now.getTime() - periodStart.getTime()) / DAY : 0, suspended: !!c.user.suspendedAt }, now);
      const score = riskScore(flags);
      return {
        businessId: c.id,
        userId: c.userId,
        name: c.name,
        email: c.user.email,
        phone: c.phone,
        plan: sub?.plan ?? null,
        status: sub?.status ?? null,
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        periodStart: periodStart?.toISOString() ?? null,
        lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
        used,
        limits,
        usageShare,
        aiCostMonthCents: Math.round((aiOf.get(c.id) ?? 0) * 100) / 100,
        mrrCents: mrr.get(c.userId) ?? 0,
        mrrRwf: mrrRwfOf.get(c.userId) ?? NO_RWF,
        flags,
        risk: riskLevel(score),
        score,
      };
    })
    .sort((a, b) => b.score - a.score || (a.lastActiveAt ?? "").localeCompare(b.lastActiveAt ?? ""));
}
