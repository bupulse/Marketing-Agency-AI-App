import "server-only";
import { prisma } from "@/lib/db";
import { usageWindowEnd, usageWindowStart } from "@/lib/billing/period";
import type { UsageMetric } from "@/lib/plans";
import { getPlan, getPlanLimits, getTrialPlan } from "@/lib/plan-catalog";

const FIELD = {
  text: "textGenerations",
  image: "imageGenerations",
  videoSeconds: "videoSeconds",
  voiceCharacters: "voiceCharacters",
  chat: "chatMessages",
} as const satisfies Record<UsageMetric, string>;

export type UsageBlockReason = "no_subscription" | "trial_expired" | "inactive" | "past_due" | "limit_reached";

export class UsageLimitError extends Error {
  constructor(
    public reason: UsageBlockReason,
    public metric: UsageMetric,
  ) {
    super(`Usage blocked: ${reason} (${metric})`);
  }
}

async function activePeriod(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId }, include: { user: { select: { suspendedAt: true } } } });
  if (!sub) throw new UsageLimitError("no_subscription", "text");
  return sub;
}

// Reserves `amount` of a metric before an AI call. Throws UsageLimitError when
// the plan's limit would be exceeded. The check and increment are one atomic
// UPDATE, so parallel requests cannot overshoot the limit.
export async function consumeUsage(userId: string, metric: UsageMetric, amount = 1) {
  const sub = await activePeriod(userId);
  const now = new Date();

  // A suspended account (admin console) can use nothing, even with a valid session (shown to the user as "inactive").
  if (sub.user?.suspendedAt) throw new UsageLimitError("inactive", metric);
  if (sub.plan === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt < now) {
    throw new UsageLimitError("trial_expired", metric);
  }
  // A failed payment limits the account: everything stays, but nothing new is generated.
  if (sub.status === "PAST_DUE") throw new UsageLimitError("past_due", metric);
  if (sub.status !== "TRIALING" && sub.status !== "ACTIVE") {
    throw new UsageLimitError("inactive", metric);
  }

  // The plan's limits from the plan catalog (database, cached for 30 s).
  const limit = (await getPlanLimits(sub.plan))[metric];
  const field = FIELD[metric];
  // Usage resets monthly, also inside a yearly billing period.
  const periodStart = usageWindowStart(sub.currentPeriodStart, now);

  // INSERT … ON CONFLICT DO NOTHING: parallel first reservations of a period must not fail on the
  // unique key, which an upsert (select, then insert) can.
  await prisma.usageRecord.createMany({ data: [{ userId, periodStart }], skipDuplicates: true });

  const { count } = await prisma.usageRecord.updateMany({
    where: { userId, periodStart, [field]: { lte: limit - amount } },
    data: { [field]: { increment: amount } },
  });
  if (count === 0) throw new UsageLimitError("limit_reached", metric);

  return { periodStart };
}

// Gives a reservation back when the AI call fails, so users aren't charged for errors.
export async function refundUsage(userId: string, metric: UsageMetric, periodStart: Date, amount = 1) {
  await prisma.usageRecord.updateMany({
    where: { userId, periodStart, [FIELD[metric]]: { gte: amount } },
    data: { [FIELD[metric]]: { decrement: amount } },
  });
}

export async function getUsageSummary(userId: string) {
  const sub = await activePeriod(userId);
  const now = new Date();
  const periodStart = usageWindowStart(sub.currentPeriodStart, now);
  const record = await prisma.usageRecord.findUnique({
    where: { userId_periodStart: { userId, periodStart } },
  });
  const limits = await getPlanLimits(sub.plan);
  const planConfig = (await getPlan(sub.plan)) ?? (await getTrialPlan());
  return {
    subscription: sub,
    plan: planConfig,
    used: {
      text: record?.textGenerations ?? 0,
      image: record?.imageGenerations ?? 0,
      videoSeconds: record?.videoSeconds ?? 0,
      voiceCharacters: record?.voiceCharacters ?? 0,
      chat: record?.chatMessages ?? 0,
    },
    limits,
    /** When usage next resets (trial: when the trial ends). */
    resetsAt: sub.plan === "TRIAL" ? sub.trialEndsAt : usageWindowEnd(sub.currentPeriodStart, now),
  };
}
