import "server-only";
import { prisma } from "@/lib/db";
import { usageWindowEnd, usageWindowStart } from "@/lib/billing/period";
import { PLANS, type UsageMetric } from "@/lib/plans";

const FIELD = {
  text: "textGenerations",
  image: "imageGenerations",
  videoSeconds: "videoSeconds",
  voiceCharacters: "voiceCharacters",
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
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) throw new UsageLimitError("no_subscription", "text");
  return sub;
}

// Reserves `amount` of a metric before an AI call. Throws UsageLimitError when
// the plan's limit would be exceeded. The check and increment are one atomic
// UPDATE, so parallel requests cannot overshoot the limit.
export async function consumeUsage(userId: string, metric: UsageMetric, amount = 1) {
  const sub = await activePeriod(userId);
  const now = new Date();

  if (sub.plan === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt < now) {
    throw new UsageLimitError("trial_expired", metric);
  }
  // A failed payment limits the account: everything stays, but nothing new is generated.
  if (sub.status === "PAST_DUE") throw new UsageLimitError("past_due", metric);
  if (sub.status !== "TRIALING" && sub.status !== "ACTIVE") {
    throw new UsageLimitError("inactive", metric);
  }

  const limit = PLANS[sub.plan].limits[metric];
  const field = FIELD[metric];
  // Usage resets monthly, also inside a yearly billing period.
  const periodStart = usageWindowStart(sub.currentPeriodStart, now);

  await prisma.usageRecord.upsert({
    where: { userId_periodStart: { userId, periodStart } },
    create: { userId, periodStart },
    update: {},
  });

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
  const limits = PLANS[sub.plan].limits;
  return {
    subscription: sub,
    plan: PLANS[sub.plan],
    used: {
      text: record?.textGenerations ?? 0,
      image: record?.imageGenerations ?? 0,
      videoSeconds: record?.videoSeconds ?? 0,
      voiceCharacters: record?.voiceCharacters ?? 0,
    },
    limits,
    /** When usage next resets (trial: when the trial ends). */
    resetsAt: sub.plan === "TRIAL" ? sub.trialEndsAt : usageWindowEnd(sub.currentPeriodStart, now),
  };
}
