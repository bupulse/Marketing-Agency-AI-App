import type { BillingInterval } from "@/lib/generated/prisma/client";
import type { Plan, PlanLimits } from "@/lib/plans";

/** The price part of a plan, in cents (the shape of PublicPlan). */
export type PlanPrices = { monthlyPriceCents: number; yearlyPriceCents: number };

/** Dollars, without cents when they are zero: 490 -> "$490", 49.5 -> "$49.50". */
export function formatUsd(amount: number) {
  const whole = Number.isInteger(amount);
  return `$${amount.toLocaleString("en-US", whole ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const formatCents = (cents: number) => formatUsd(cents / 100);

/** The plan's price for a billing interval, in dollars. */
export function priceFor(plan: PlanPrices, interval: BillingInterval) {
  return (interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents) / 100;
}

/** What a customer saves by paying yearly instead of monthly, in dollars. */
export function yearlySavings(plan: PlanPrices) {
  return (plan.monthlyPriceCents * 12 - plan.yearlyPriceCents) / 100;
}

/** The yearly discount against paying monthly for 12 months, rounded (e.g. 17 for 17% off). */
export function yearlyDiscountPercent(plan: PlanPrices) {
  return plan.monthlyPriceCents > 0 ? Math.round(((plan.monthlyPriceCents * 12 - plan.yearlyPriceCents) / (plan.monthlyPriceCents * 12)) * 100) : 0;
}

/** "2 months free" when yearly is exactly ten months, otherwise "N% off"; null when yearly is no cheaper. */
export function yearlySavingsLabel(plan: PlanPrices): string | null {
  if (plan.monthlyPriceCents > 0 && plan.yearlyPriceCents === plan.monthlyPriceCents * 10) return "2 months free";
  const percent = yearlyDiscountPercent(plan);
  return percent > 0 ? `${percent}% off` : null;
}

/** The toggle badge for a set of plans: "2 months free" if every plan agrees, else the best discount, else nothing. */
export function yearlyBadge(plans: PlanPrices[]): string | null {
  const labels = plans.map(yearlySavingsLabel);
  if (labels.length > 0 && labels.every((l) => l === labels[0])) return labels[0];
  const best = Math.max(0, ...plans.map(yearlyDiscountPercent));
  return best > 0 ? `Save up to ${best}%` : null;
}

export const intervalWord = (interval: BillingInterval) => (interval === "YEAR" ? "year" : "month");

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export type PlanButtonAction = "upgrade" | "switch" | "current";

/** What a plan card's button does: trial customers buy, paying customers switch, the current plan is a badge. */
export function planButtonAction(
  current: { plan: Plan; interval: BillingInterval; paid: boolean },
  target: { plan: Plan; interval: BillingInterval },
): PlanButtonAction {
  if (!current.paid) return "upgrade";
  return current.plan === target.plan && current.interval === target.interval ? "current" : "switch";
}

/** A feature list built from limits alone (the fallback when a plan has none of its own). */
export function planFeatures(limits: PlanLimits) {
  const { text, image, videoSeconds, voiceCharacters } = limits;
  return [
    `${text} text generations per month`,
    `${image} brand designs per month`,
    ...(videoSeconds > 0 ? [`${videoSeconds} seconds of video`] : []),
    ...(voiceCharacters > 0 ? [`${voiceCharacters.toLocaleString("en-US")} voice characters`] : []),
  ];
}

export type UsageBlockReason = "no_subscription" | "trial_expired" | "inactive" | "past_due" | "limit_reached";

const REASONS: UsageBlockReason[] = ["no_subscription", "trial_expired", "inactive", "past_due", "limit_reached"];

/** Reads the 402 body of a blocked generation ({ error: "usage_blocked", reason }), or null if it is something else. */
export function parseUsageBlock(body: unknown): UsageBlockReason | null {
  if (!body || typeof body !== "object") return null;
  const { error, reason } = body as { error?: unknown; reason?: unknown };
  if (error !== "usage_blocked") return null;
  return REASONS.includes(reason as UsageBlockReason) ? (reason as UsageBlockReason) : "inactive";
}

export type BlockCopy = { title: string; body: string; cta: string; action: "billing" | "portal" };

export function blockCopy(reason: UsageBlockReason, opts: { limit?: number; resetsAt?: Date | string | null } = {}): BlockCopy {
  const reset = formatDate(opts.resetsAt);
  switch (reason) {
    case "trial_expired":
      return {
        title: "Your free trial has ended",
        body: "Choose a plan to keep creating. Your trial work stays right where you left it.",
        cta: "Choose a plan",
        action: "billing",
      };
    case "limit_reached":
      return {
        title: "You have reached your limit",
        body: `You've used all ${opts.limit ?? "your"} text generations this month. They reset ${reset ?? "next month"}, or you can upgrade to keep going now.`,
        cta: "See plans",
        action: "billing",
      };
    case "past_due":
      return {
        title: "Your last payment didn't go through",
        body: "Update your payment method to keep creating. New content is paused until then.",
        cta: "Update payment method",
        action: "portal",
      };
    default:
      return {
        title: "Your plan is not active",
        body: "Choose a plan to start creating again.",
        cta: "Choose a plan",
        action: "billing",
      };
  }
}

export function statusLabel(status: string, cancelAtPeriodEnd = false) {
  if (status === "ACTIVE") return cancelAtPeriodEnd ? "Cancels soon" : "Active";
  if (status === "TRIALING") return "Free trial";
  if (status === "PAST_DUE") return "Payment failed";
  if (status === "CANCELED") return "Cancelled";
  return "Ended";
}
