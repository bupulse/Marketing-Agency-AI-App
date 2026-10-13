// Pure roll-up maths (no I/O) so the money and rate rules are unit-tested on their own.
import { SEED_PLANS } from "@/lib/plans";
import { utcDay } from "./collect";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** a / b as a percentage with one decimal, or null when there is nothing to divide by. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export type PriceTable = Record<string, { monthlyPriceCents: number; yearlyPriceCents: number }>;
const SEED_PRICES: PriceTable = Object.fromEntries(Object.entries(SEED_PLANS).map(([k, p]) => [k, { monthlyPriceCents: p.priceUsdMonthly * 100, yearlyPriceCents: p.priceUsdYearly * 100 }]));

/**
 * Monthly recurring revenue in USD cents. Yearly plans count a twelfth. Trials and unpaid states count nothing.
 * `prices` is the plans' current prices (the plan catalog; defaults to the original plans). A subscriber whose price
 * change has not reached them yet is counted at the plan's new price: MRR moves with the price, not with each renewal.
 */
export function computeMrrCents(groups: { plan: string; interval: string; count: number }[], prices: PriceTable = SEED_PRICES): number {
  let cents = 0;
  for (const g of groups) {
    const p = prices[g.plan];
    const price = p ? (g.interval === "YEAR" ? p.yearlyPriceCents : p.monthlyPriceCents) : 0;
    if (!price) continue;
    cents += g.count * (g.interval === "YEAR" ? price / 12 : price);
  }
  return Math.round(cents);
}

/** Share of the people who were subscribers at the start of the day (those still active + those who cancelled) who cancelled. */
export function churnPct(cancelled: number, stillActive: number): number | null {
  return pct(cancelled, cancelled + stillActive);
}

/** Trial to paid: paid starts out of trial starts (both in the same period). */
export function conversionPct(paid: number, trials: number): number | null {
  return pct(paid, trials);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Calendar days "YYYY-MM-DD" from..to inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 4000; t += 86_400_000) out.push(utcDay(new Date(t)));
  return out;
}

export function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
}

/**
 * Monthly costs spread evenly over the days of their month: total cents for `day`, and per category.
 * `costs` are all MonthlyCost rows; only those of the day's month count. Fractions of a cent are kept.
 */
export function fixedCostForDay(day: string, costs: { month: string; category: string; amountCents: number }[]): { total: number; byCategory: Record<string, number> } {
  const month = day.slice(0, 7);
  const n = daysInMonth(month);
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const c of costs) {
    if (c.month !== month) continue;
    const share = c.amountCents / n;
    byCategory[c.category] = (byCategory[c.category] ?? 0) + share;
    total += share;
  }
  return { total, byCategory };
}

/** Net revenue minus all costs, in cents. */
export function profitCents(revenue: number, refunds: number, aiCost: number, fixedCost: number): number {
  return round2(revenue - refunds - aiCost - fixedCost);
}

type PaddleEvent = { event_type?: string; occurred_at?: string; data?: Record<string, unknown> };
/** BillingEvent.type of a confirmed manual Mobile Money payment. */
export const MANUAL_PAYMENT_EVENT = "manual_payment.confirmed";
/** A plain invoice (no plan) marked paid by hand in the admin console: bank, cash, or a MoMo payment made elsewhere. */
export const INVOICE_PAID_EVENT = "invoice.paid_manual";
/** The BillingEvent types that carry money: card payments and refunds from Paddle, and confirmed Mobile Money payments. */
export const MONEY_EVENT_TYPES = ["transaction.completed", "adjustment.created", "adjustment.updated", MANUAL_PAYMENT_EVENT, INVOICE_PAID_EVENT];
export type MoneyEvent = { kind: "payment" | "refund"; cents: number; id: string; at: Date };

const minor = (v: unknown) => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

type PaddleTotals = { currency_code?: string; earnings?: unknown; total?: unknown; tax?: unknown; fee?: unknown } | undefined;

/** What BuPulse keeps from a Paddle totals block, in USD cents: `earnings` (after tax and Paddle's fee) when given, else total - tax - fee. */
function netUsd(totals: PaddleTotals, currencyFallback?: unknown): number | null {
  if (!totals) return null;
  if ((totals.currency_code ?? currencyFallback ?? "USD") !== "USD") return null;
  const earnings = minor(totals.earnings);
  if (earnings !== null) return earnings;
  const total = minor(totals.total);
  return total === null ? null : total - (minor(totals.tax) ?? 0) - (minor(totals.fee) ?? 0);
}

/**
 * Reads a stored Paddle webhook payload into a payment or a refund in USD cents, net of tax and Paddle's fee.
 * Paddle Billing fields: transaction.completed -> data.details.payout_totals (settlement currency) and data.details.totals;
 * adjustment.* (action "refund", status "approved") -> data.payout_totals and data.totals. The payout block is preferred, so a payment
 * charged in another currency still counts when Paddle pays out in USD. Anything else returns null.
 */
export function parseMoneyEvent(type: string, payload: unknown, fallbackAt: Date): MoneyEvent | null {
  const event = (payload ?? {}) as PaddleEvent;
  const data = (event.data ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const at = event.occurred_at && !Number.isNaN(Date.parse(event.occurred_at)) ? new Date(event.occurred_at) : fallbackAt;
  // A Mobile Money payment confirmed in the admin console (lib/billing/momo.ts), or a plain invoice marked paid by hand
  // (lib/invoices/service.ts): the USD value was fixed at that moment.
  if (type === MANUAL_PAYMENT_EVENT || type === INVOICE_PAID_EVENT) {
    const cents = minor(data.usd_cents);
    return cents === null ? null : { kind: "payment", cents, id: String(data.id ?? ""), at };
  }
  if (type === "transaction.completed") {
    const cents = netUsd(data.details?.payout_totals) ?? netUsd(data.details?.totals, data.currency_code);
    return cents === null ? null : { kind: "payment", cents, id: String(data.id ?? ""), at };
  }
  if ((type === "adjustment.created" || type === "adjustment.updated") && data.action === "refund" && data.status === "approved") {
    const cents = netUsd(data.payout_totals) ?? netUsd(data.totals, data.currency_code);
    return cents === null ? null : { kind: "refund", cents, id: String(data.id ?? ""), at };
  }
  return null;
}

export type SubSnapshot = { plan: string; status: string; cancelAtPeriodEnd: boolean } | null;
const PAYING = new Set(["ACTIVE", "PAST_DUE"]);

/**
 * Which product events a Paddle subscription change means. `upgrade` is a paid start: only when the account was not
 * paying before (trial, ended, or unknown). A plan switch while paying is `plan_change`; it never counts as a new customer.
 */
export function subscriptionEventsFor(before: SubSnapshot, after: { plan: string; status: string }, cancelAtPeriodEnd: boolean): string[] {
  const events: string[] = [];
  const wasPaying = !!before && before.plan !== "TRIAL" && PAYING.has(before.status);
  const isPaying = after.plan !== "TRIAL" && PAYING.has(after.status);
  if (isPaying && !wasPaying) events.push("upgrade");
  else if (isPaying && wasPaying && before!.plan !== after.plan) events.push("plan_change");
  if ((after.status === "CANCELED" || after.status === "EXPIRED") && wasPaying) events.push("cancel");
  if (cancelAtPeriodEnd && before && !before.cancelAtPeriodEnd) events.push("cancel_scheduled");
  return events;
}
