// Usage limits are monthly on every plan. A yearly subscription has a 12-month billing
// period, so usage runs in monthly windows counted from the period start.

/** Adds whole months, clamping to the last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Start of the monthly usage window that contains `now`, counted from `anchor`. */
export function usageWindowStart(anchor: Date, now: Date = new Date()): Date {
  if (now <= anchor) return anchor;
  const months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonths(anchor, Math.max(0, months));
  if (start > now) start = addMonths(anchor, months - 1);
  return start;
}

/** When the current usage window ends (the next reset). */
export function usageWindowEnd(anchor: Date, now: Date = new Date()): Date {
  const start = usageWindowStart(anchor, now);
  const months =
    (start.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (start.getUTCMonth() - anchor.getUTCMonth());
  return addMonths(anchor, months + 1);
}

// ---- when a paid period is over (docs/BILLING.md, "When a plan ends") ----------------------------------------
// One rule for every place that lets a company act: generation (lib/usage.ts), features, publishing, Autopilot, the
// widget and the API (lib/entitlements.ts accountBlock), and the dashboard notices. A subscription still ACTIVE after
// its period (a late or lost card webhook, a Mobile Money renewal the daily job has not handled yet) stops at the end
// of its grace, whatever its status says.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days a plan renewed by hand (Mobile Money, custom plans, paid invoices) keeps working after its paid period: the
 * daily renewals job then makes it PAST_DUE (lib/billing/momo-renewals.ts, GRACE_DAYS in momo-shared.ts).
 */
export const MANUAL_GRACE_DAYS = 3;
/** A card plan that renews by itself: time for the provider's renewal (or past_due) webhook to arrive. */
export const CARD_RENEWAL_GRACE_DAYS = 1;

/** The parts of a Subscription the rule reads. */
export type PeriodSubscription = {
  plan: string;
  provider?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
};

/** active: inside the paid period (or no end is known); grace: after it, still working; ended: nothing new is made. */
export type PeriodState = "active" | "grace" | "ended";

/** Renewed by hand: Mobile Money, or a plan set up without a provider. A card provider renews by itself. */
const renewsByHand = (sub: PeriodSubscription) => !sub.provider || sub.provider === "MANUAL_MOMO";

/** How long a plan keeps working after its period ends. A card plan cancelled at its end has nothing to wait for. */
export function periodGraceMs(sub: PeriodSubscription): number {
  if (renewsByHand(sub)) return MANUAL_GRACE_DAYS * DAY_MS;
  return sub.cancelAtPeriodEnd ? 0 : CARD_RENEWAL_GRACE_DAYS * DAY_MS;
}

/** The longest grace of any plan: a period that ended before now minus this is over for everyone. */
export const MAX_GRACE_MS = Math.max(MANUAL_GRACE_DAYS, CARD_RENEWAL_GRACE_DAYS) * DAY_MS;

/**
 * Where a subscription's paid time stands at `now`, from its dates alone (the callers check the status first). The
 * free trial ends at `trialEndsAt` with no grace (its currentPeriodEnd is not moved when an admin extends the trial);
 * any other plan at `currentPeriodEnd` plus its grace, the same moment the renewals job marks Mobile Money PAST_DUE.
 */
export function periodState(sub: PeriodSubscription, now: Date = new Date()): PeriodState {
  if (sub.plan === "TRIAL") return sub.trialEndsAt && sub.trialEndsAt.getTime() < now.getTime() ? "ended" : "active";
  const end = sub.currentPeriodEnd;
  if (!end || now.getTime() <= end.getTime()) return "active";
  return now.getTime() < end.getTime() + periodGraceMs(sub) ? "grace" : "ended";
}

/**
 * A plan renewed by hand in its grace days: when its period ended and when it stops working, for the dashboard notice.
 * Null otherwise; a card plan's grace only waits for its automatic renewal, so it says nothing.
 */
export function manualGrace(sub: PeriodSubscription, now: Date = new Date()): { ended: Date; until: Date } | null {
  if (!renewsByHand(sub) || !sub.currentPeriodEnd || periodState(sub, now) !== "grace") return null;
  return { ended: sub.currentPeriodEnd, until: new Date(sub.currentPeriodEnd.getTime() + periodGraceMs(sub)) };
}
