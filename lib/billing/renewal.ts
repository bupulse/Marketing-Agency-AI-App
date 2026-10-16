// When a paid plan can be renewed (docs/BILLING.md, "Renewing"). Pure, so the Billing page, the server actions, the
// card webhook and the tests share one rule:
//  - a card subscription that renews by itself is never renewed by hand ("Renews automatically on <date>");
//  - any other paid period (Mobile Money, or a card plan cancelled at its end) can be renewed only in its last
//    RENEWAL_WINDOW_DAYS days, by Mobile Money or by card. Before that, Billing says "Your plan is paid until <date>".
//  - the renewed period starts when the current one ends, so no paid day is lost.

import { DAY_MS } from "./momo-shared";

export const RENEWAL_WINDOW_DAYS = 7;

type SubBits = {
  provider: string | null;
  providerSubscriptionId?: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

export type RenewalState =
  /** A card subscription that renews by itself on `renewsAt`. */
  | { kind: "auto"; renewsAt: Date | null }
  /** Paid for more than RENEWAL_WINDOW_DAYS more days: renewing opens on `opensAt`. */
  | { kind: "paid"; until: Date; opensAt: Date }
  /** The last RENEWAL_WINDOW_DAYS days, or the period has ended (past due): renew now. */
  | { kind: "open"; until: Date | null; daysLeft: number };

/** Whole days left until `end` (a part of a day counts as a day); 0 once it has passed. */
export function daysLeftUntil(end: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

/** The first moment a period ending at `end` can be renewed. */
export const renewalOpensAt = (end: Date) => new Date(end.getTime() - RENEWAL_WINDOW_DAYS * DAY_MS);

const autoRenewing = (sub: SubBits) => sub.provider === "PADDLE" && Boolean(sub.providerSubscriptionId) && !sub.cancelAtPeriodEnd;

/** Where a paid subscription stands for renewing (the caller only asks for a paid, non-trial plan). */
export function renewalState(sub: SubBits, now: Date = new Date()): RenewalState {
  if (autoRenewing(sub)) return { kind: "auto", renewsAt: sub.currentPeriodEnd };
  const end = sub.currentPeriodEnd;
  if (end && sub.status === "ACTIVE" && now.getTime() < renewalOpensAt(end).getTime()) {
    return { kind: "paid", until: end, opensAt: renewalOpensAt(end) };
  }
  return { kind: "open", until: end, daysLeft: end ? daysLeftUntil(end, now) : 0 };
}

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kigali" });

/** The server's answer to a renewal asked for too early (Mobile Money and card say the same). */
export function earlyRenewalMessage(until: Date): string {
  return `Your plan is paid until ${longDate(until)}. You can renew from ${longDate(renewalOpensAt(until))}, ${RENEWAL_WINDOW_DAYS} days before it ends; the new period starts when this one ends.`;
}

/**
 * The end of a running paid period that is still too far away to renew, or null when renewing (or paying) is fine:
 * a Mobile Money plan that is ACTIVE, or a card plan cancelled at its period end, with more than RENEWAL_WINDOW_DAYS
 * days left. A card plan that renews by itself is not this rule's business (the callers refuse it on their own).
 */
export function tooEarlyToRenew(sub: SubBits | null, now: Date = new Date()): Date | null {
  if (!sub || sub.status !== "ACTIVE" || !sub.currentPeriodEnd) return null;
  const running = sub.provider === "MANUAL_MOMO" || (sub.provider === "PADDLE" && sub.cancelAtPeriodEnd);
  if (!running) return null;
  return now.getTime() < renewalOpensAt(sub.currentPeriodEnd).getTime() ? sub.currentPeriodEnd : null;
}
