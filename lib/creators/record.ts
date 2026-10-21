import "server-only";
import { prisma } from "@/lib/db";

// A company's payment record on the marketplace (docs/CREATOR_MARKETPLACE.md, "Payment record", owner decision): only
// figures BuPulse computes, nothing typed by hand. From payouts marked PAID: how many creators were paid and how many
// days after the month's end they usually were (the median of paidAt minus the period's end). DUE payouts more than
// 14 days after their month's end show "Some payments late". A company with no paid payout yet is "New on BuPulse".

export const LATE_AFTER_DAYS = 14;
const DAY = 86_400_000;

export type PaymentRecord = {
  /** Different people (by email) the company paid, across its campaigns. */
  creatorsPaid: number;
  /** Median whole days from the month's end to the payment; null with no paid payout. */
  medianDays: number | null;
  /** A DUE payout more than LATE_AFTER_DAYS past its month's end. */
  late: boolean;
  /** No paid payout yet. */
  isNew: boolean;
};

export const NEW_RECORD: PaymentRecord = { creatorsPaid: 0, medianDays: null, late: false, isNew: true };

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The record from one company's payouts. Pure. */
export function recordOf(paid: { email: string; paidAt: Date | null; periodEndsAt: Date }[], due: { periodEndsAt: Date }[], now: Date): PaymentRecord {
  const days = paid.filter((p) => p.paidAt).map((p) => Math.max(0, (p.paidAt!.getTime() - p.periodEndsAt.getTime()) / DAY));
  const m = median(days);
  return {
    creatorsPaid: new Set(paid.map((p) => p.email.toLowerCase())).size,
    medianDays: m === null ? null : Math.ceil(m),
    late: due.some((d) => now.getTime() - d.periodEndsAt.getTime() > LATE_AFTER_DAYS * DAY),
    isNew: paid.length === 0,
  };
}

/** The record in words, e.g. ["Paid 12 creators", "Usually within 3 days of the month's end"], or ["New on BuPulse"]. */
export function recordInWords(r: PaymentRecord): { lines: string[]; late: boolean } {
  const lines: string[] = [];
  if (r.isNew) lines.push("New on BuPulse");
  else {
    lines.push(`Paid ${r.creatorsPaid} creator${r.creatorsPaid === 1 ? "" : "s"}`);
    if (r.medianDays !== null) lines.push(r.medianDays <= 1 ? "Usually within a day of the month's end" : `Usually within ${r.medianDays} days of the month's end`);
  }
  if (r.late) lines.push("Some payments late");
  return { lines, late: r.late };
}

/** The records of these companies (every company asked for is in the map). */
export async function paymentRecords(businessIds: string[], now = new Date()): Promise<Map<string, PaymentRecord>> {
  const ids = [...new Set(businessIds)];
  const out = new Map<string, PaymentRecord>(ids.map((id) => [id, NEW_RECORD]));
  if (!ids.length) return out;
  const rows = await prisma.creatorPayout.findMany({
    where: { period: { campaign: { businessId: { in: ids } } }, OR: [{ status: "PAID" }, { status: "DUE", period: { endsAt: { lt: new Date(now.getTime() - LATE_AFTER_DAYS * DAY) } } }] },
    select: { status: true, paidAt: true, campaignCreator: { select: { email: true } }, period: { select: { endsAt: true, campaign: { select: { businessId: true } } } } },
  });
  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    const id = r.period.campaign.businessId;
    byCompany.set(id, [...(byCompany.get(id) ?? []), r]);
  }
  for (const [id, list] of byCompany) {
    const paid = list.filter((r) => r.status === "PAID").map((r) => ({ email: r.campaignCreator.email, paidAt: r.paidAt, periodEndsAt: r.period.endsAt }));
    const due = list.filter((r) => r.status === "DUE").map((r) => ({ periodEndsAt: r.period.endsAt }));
    out.set(id, recordOf(paid, due, now));
  }
  return out;
}

/** One company's record. */
export async function paymentRecord(businessId: string, now = new Date()): Promise<PaymentRecord> {
  return (await paymentRecords([businessId], now)).get(businessId) ?? NEW_RECORD;
}
