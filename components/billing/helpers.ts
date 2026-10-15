import type { BillingInterval } from "@/lib/generated/prisma/client";
import { videosPerDayLimit, type Plan, type PlanLimits } from "@/lib/plans";
import { formatMinor } from "@/lib/region-format";
import { RENEWAL_WINDOW_DAYS, renewalOpensAt, type RenewalState } from "@/lib/billing/renewal";

/** The price part of a plan in the currency's smallest unit (the shape of PublicPlan); `currency` defaults to USD. */
export type PlanPrices = { monthlyPriceCents: number; yearlyPriceCents: number; currency?: string };

/** An amount in a plan's currency: "$49", "15,000 RWF". */
export const formatPrice = (minor: number, currency = "USD") => formatMinor(minor, currency);

/** The plan's price for an interval, formatted in its currency. */
export function formatPlanPrice(plan: PlanPrices, interval: BillingInterval) {
  return formatPrice(interval === "YEAR" ? plan.yearlyPriceCents : plan.monthlyPriceCents, plan.currency ?? "USD");
}

/** What a customer saves by paying yearly, in the smallest unit of the plan's currency. */
export function yearlySavingsMinor(plan: PlanPrices) {
  return plan.monthlyPriceCents * 12 - plan.yearlyPriceCents;
}

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

/**
 * The button of a plan card when nothing is paid now. A trial buys a plan ("Upgrade to"). After a paid plan ended, the
 * same plan is renewed, a dearer one is a real upgrade and a cheaper one a switch down. `ended` is the price of the plan
 * the company was on (null when it is not listed: then "Choose"); prices in another currency cannot be compared either.
 */
export function unpaidPlanLabel(currentPlan: string, target: { key: string; name: string; monthlyPriceCents: number; currency?: string }, ended: { monthlyPriceCents: number; currency?: string } | null): string {
  if (currentPlan === "TRIAL") return `Upgrade to ${target.name}`;
  if (currentPlan === target.key) return `Renew ${target.name}`;
  if (!ended || (ended.currency ?? "USD") !== (target.currency ?? "USD") || ended.monthlyPriceCents === target.monthlyPriceCents) return `Choose ${target.name}`;
  return target.monthlyPriceCents > ended.monthlyPriceCents ? `Upgrade to ${target.name}` : `Switch to ${target.name}`;
}

/**
 * A paid plan cancelled at its period end that still runs (a card plan someone cancelled): when it ends and from when it
 * can be renewed (lib/billing/renewal.ts, the last RENEWAL_WINDOW_DAYS days; "now" once open), for the quiet notice on
 * every dashboard page. Null for anything else.
 */
export function endingNotice(sub: { plan: string; status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null }, now: Date = new Date()): { end: string; renewFrom: string } | null {
  if (sub.plan === "TRIAL" || sub.status !== "ACTIVE" || !sub.cancelAtPeriodEnd || !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() <= now.getTime()) return null;
  const opens = renewalOpensAt(sub.currentPeriodEnd);
  return { end: formatDate(sub.currentPeriodEnd) ?? "", renewFrom: now.getTime() < opens.getTime() ? (formatDate(opens) ?? "") : "now" };
}

/**
 * Under the plan cards of a card plan: its plan changes go through the card provider only (changePlan), and the honest
 * way to Mobile Money, which works (never "coming soon"): a card plan cancelled at its end can be renewed by Mobile
 * Money in its last RENEWAL_WINDOW_DAYS days (lib/billing/momo.ts refuses it before the card plan is cancelled). Null
 * when Mobile Money cannot be used here anyway.
 */
export function cardChangeNote(renewal: RenewalState, momoUsable: boolean): string | null {
  if (!momoUsable) return null;
  const lead = "Card plans change by card.";
  if (renewal.kind === "auto") {
    return renewal.renewsAt
      ? `${lead} To pay by Mobile Money instead, cancel the card plan (it stays active until ${formatDate(renewal.renewsAt)}) and renew by Mobile Money from ${formatDate(renewalOpensAt(renewal.renewsAt))}.`
      : `${lead} To pay by Mobile Money instead, cancel the card plan and renew by Mobile Money in its last ${RENEWAL_WINDOW_DAYS} days.`;
  }
  if (renewal.kind === "paid") return `${lead} Switch to Mobile Money when you renew, from ${formatDate(renewal.opensAt)}.`;
  return `${lead} To pay by Mobile Money, renew with Mobile Money above.`;
}

/** A feature list built from limits alone (the fallback when a plan has none of its own). */
export function planFeatures(limits: PlanLimits) {
  const { text, image, videos, voiceCharacters } = limits;
  return [
    `${text} text generations per month`,
    `${image} brand designs per month`,
    ...(videos > 0 ? [`${videos} ${videos === 1 ? "video" : "videos"} a month (up to 30 s each${videos > 1 ? `, ${videosPerDayLimit(limits)} a day` : ""})`] : []),
    ...(voiceCharacters > 0 ? [`${voiceCharacters.toLocaleString("en-US")} voice characters`] : []),
  ];
}

export type UsageBlockReason = "no_subscription" | "pending_demo" | "trial_expired" | "inactive" | "past_due" | "limit_reached";

const REASONS: UsageBlockReason[] = ["no_subscription", "pending_demo", "trial_expired", "inactive", "past_due", "limit_reached"];

/** Reads the 402 body of a blocked generation ({ error: "usage_blocked", reason }), or null if it is something else. */
export function parseUsageBlock(body: unknown): UsageBlockReason | null {
  if (!body || typeof body !== "object") return null;
  const { error, reason } = body as { error?: unknown; reason?: unknown };
  if (error !== "usage_blocked") return null;
  return REASONS.includes(reason as UsageBlockReason) ? (reason as UsageBlockReason) : "inactive";
}

export type BlockCopy = { title: string; body: string; cta: string; action: "billing" | "portal" | "dashboard" };

export function blockCopy(reason: UsageBlockReason, opts: { limit?: number; resetsAt?: Date | string | null } = {}): BlockCopy {
  const reset = formatDate(opts.resetsAt);
  switch (reason) {
    case "pending_demo":
      return {
        title: "Your demo comes first",
        body: "Everything opens after your demo and the free trial that follows it. Your demo details are on the dashboard.",
        cta: "See your demo",
        action: "dashboard",
      };
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
  if (status === "PENDING_DEMO") return "Waiting for demo";
  if (status === "PAST_DUE") return "Payment failed";
  if (status === "CANCELED") return "Cancelled";
  return "Ended";
}
