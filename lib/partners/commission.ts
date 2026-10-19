// Partner commission (docs/bizdev/PLAN.md section 6). Pure: the loaders are in ./service.ts.
//
// - Money only: a partner earns on payments that arrived (Mobile Money confirmed in Admin -> Payments, card payments
//   Paddle completed, invoices paid), net of refunds. The entries are the books' own (lib/money/revenue-shared.ts), so a
//   payment counts here exactly when it counts in Admin -> Revenue.
// - A referral counts when the company's first payment comes within 90 days of signing up with the link. From that
//   first payment the partner earns for 12 months on every payment (and loses the share of every refund).
// - Rate by tier, decided at each payment by how many referred companies have paid so far (that payment's company
//   included): 20% for the first 5, 25% from the 6th, 30% from the 21st.
// - The base is the amount in RWF: what the client paid in RWF, else the USD value (card, net of Paddle's fee) at the
//   Settings rate. Commission is rounded to whole francs per payment.
// - A payment is "on hold" for 14 days (time for a refund or a mistaken confirmation); the rest is available to pay out.
import type { RevenueEntry } from "@/lib/money/revenue-shared";

export const QUALIFY_DAYS = 90;
export const EARN_MONTHS = 12;
export const HOLD_DAYS = 14;
/** Rates from the number of paying referred companies: the highest tier whose `from` is reached. */
export const TIERS: readonly { from: number; pct: number }[] = [
  { from: 1, pct: 20 },
  { from: 6, pct: 25 },
  { from: 21, pct: 30 },
];

const DAY_MS = 86_400_000;

export type ReferralLite = { id: string; businessId: string; userId: string; createdAt: Date };
export type CommissionLine = {
  referralId: string;
  businessId: string;
  entryId: string;
  at: Date;
  kind: "payment" | "refund";
  baseRwf: number;
  pct: number;
  commissionRwf: number;
  onHold: boolean;
};
export type ReferralStatus = { referralId: string; businessId: string; firstPaidAt: Date | null; qualified: boolean; earnUntil: Date | null; earnedRwf: number };
export type CommissionSummary = {
  lines: CommissionLine[];
  referrals: ReferralStatus[];
  /** Referred companies whose first payment came in time. */
  payingClients: number;
  /** The rate on payments from now on (every referred client's, until the next tier). */
  currentPct: number;
  /** The next tier: how many paying clients reach it, and its rate; null at the top. */
  nextTier: { from: number; pct: number } | null;
  earnedRwf: number;
  onHoldRwf: number;
  /** Earned and past the hold. */
  availableRwf: number;
  paidRwf: number;
  /** availableRwf - paidRwf; negative when refunds came after a payout (to recover from the next one). */
  owedRwf: number;
};

/** The rate for a partner with `paying` paying clients (at least 1 when a payment exists). */
export function tierPct(paying: number): number {
  let pct = TIERS[0].pct;
  for (const t of TIERS) if (paying >= t.from) pct = t.pct;
  return pct;
}

/** `date` plus `months` calendar months (UTC), clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** A payment's or refund's amount in whole RWF (signed): its own RWF amount, else its USD value at `usdToRwf`. */
export function baseRwfOf(e: Pick<RevenueEntry, "currency" | "localMinor" | "usdCents">, usdToRwf: number): number {
  if (e.currency === "RWF" && e.localMinor !== null) return e.localMinor;
  return Math.round((e.usdCents / 100) * usdToRwf);
}

/**
 * The commission of one partner from its referrals, the payments and refunds of the referred companies' owners
 * (any order; other users' entries are ignored) and its payouts in RWF.
 */
export function partnerCommission(input: { referrals: readonly ReferralLite[]; entries: readonly RevenueEntry[]; paidRwf: number; usdToRwf: number; now: Date }): CommissionSummary {
  const entries = [...input.entries].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  // Each referral's first payment after signing up, and whether it came in time.
  const status = input.referrals.map((r) => {
    const first = entries.find((e) => e.userId === r.userId && e.kind === "payment" && e.at.getTime() >= r.createdAt.getTime());
    const qualified = !!first && first.at.getTime() <= r.createdAt.getTime() + QUALIFY_DAYS * DAY_MS;
    return { r, firstPaidAt: first?.at ?? null, qualified, earnUntil: qualified && first ? addMonths(first.at, EARN_MONTHS) : null };
  });
  const byUser = new Map(status.filter((s) => s.qualified).map((s) => [s.r.userId, s]));
  const firsts = status.filter((s) => s.qualified).map((s) => s.firstPaidAt!.getTime()).sort((a, b) => a - b);
  const payingAt = (t: number) => firsts.filter((f) => f <= t).length;

  const holdFrom = input.now.getTime() - HOLD_DAYS * DAY_MS;
  const lines: CommissionLine[] = [];
  for (const e of entries) {
    const s = e.userId ? byUser.get(e.userId) : undefined;
    if (!s || !s.firstPaidAt || !s.earnUntil) continue;
    const t = e.at.getTime();
    if (t < s.firstPaidAt.getTime() || t >= s.earnUntil.getTime()) continue;
    const pct = tierPct(payingAt(t));
    const baseRwf = baseRwfOf(e, input.usdToRwf);
    lines.push({ referralId: s.r.id, businessId: s.r.businessId, entryId: e.id, at: e.at, kind: e.kind, baseRwf, pct, commissionRwf: Math.round((baseRwf * pct) / 100), onHold: t > holdFrom });
  }

  const sum = (xs: CommissionLine[]) => xs.reduce((a, l) => a + l.commissionRwf, 0);
  const earnedRwf = sum(lines);
  const onHoldRwf = sum(lines.filter((l) => l.onHold));
  const availableRwf = earnedRwf - onHoldRwf;
  const earnedBy = new Map<string, number>();
  for (const l of lines) earnedBy.set(l.referralId, (earnedBy.get(l.referralId) ?? 0) + l.commissionRwf);
  return {
    lines,
    referrals: status.map((s) => ({ referralId: s.r.id, businessId: s.r.businessId, firstPaidAt: s.firstPaidAt, qualified: s.qualified, earnUntil: s.earnUntil, earnedRwf: earnedBy.get(s.r.id) ?? 0 })),
    payingClients: firsts.length,
    currentPct: tierPct(Math.max(1, firsts.length)),
    nextTier: TIERS.find((t) => t.from > Math.max(1, firsts.length)) ?? null,
    earnedRwf,
    onHoldRwf,
    availableRwf,
    paidRwf: input.paidRwf,
    owedRwf: availableRwf - input.paidRwf,
  };
}
