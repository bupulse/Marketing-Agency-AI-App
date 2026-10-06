import type { BillingInterval, Plan } from "@/lib/generated/prisma/client";
import { PRICES, type PaidPlan } from "@/lib/billing/catalog";
import { PLANS } from "@/lib/plans";

export function formatUsd(amount: number) {
  return `$${amount.toLocaleString("en-US")}`;
}

export function priceFor(plan: PaidPlan, interval: BillingInterval) {
  return PRICES[plan][interval];
}

/** What a customer saves by paying yearly instead of monthly (2 months free). */
export function yearlySavings(plan: PaidPlan) {
  return PRICES[plan].MONTH * 12 - PRICES[plan].YEAR;
}

/** The yearly discount against paying monthly for 12 months, rounded (e.g. 17 for 17% off). */
export function yearlyDiscountPercent(plan: PaidPlan) {
  return Math.round((yearlySavings(plan) / (PRICES[plan].MONTH * 12)) * 100);
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
  target: { plan: PaidPlan; interval: BillingInterval },
): PlanButtonAction {
  if (!current.paid) return "upgrade";
  return current.plan === target.plan && current.interval === target.interval ? "current" : "switch";
}

export function planFeatures(plan: PaidPlan) {
  const { text, image, videoSeconds, voiceCharacters } = PLANS[plan].limits;
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
