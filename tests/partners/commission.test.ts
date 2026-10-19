import { describe, expect, it } from "vitest";
import type { RevenueEntry } from "@/lib/money/revenue-shared";
import { addMonths, baseRwfOf, partnerCommission, tierPct, TIERS } from "@/lib/partners/commission";

// Partner commission: confirmed money only, a 90-day window to first pay, 12 months of earning, tiers, refunds, hold.

const D = (s: string) => new Date(`${s}T10:00:00Z`);
let n = 0;
function pay(userId: string, at: string, rwf: number, extra: Partial<RevenueEntry> = {}): RevenueEntry {
  n += 1;
  return { id: `pay:${n}`, at: D(at), month: at.slice(0, 7), userId, kind: "payment", usdCents: Math.round((rwf / 1450) * 100), method: "momo", localMinor: rwf, currency: "RWF", plan: "BUSINESS", priceId: null, partial: false, ...extra };
}
function refund(userId: string, at: string, rwf: number): RevenueEntry {
  return pay(userId, at, -rwf, { id: `refund:${++n}`, kind: "refund" });
}
const ref = (i: number, at = "2026-11-01") => ({ id: `r${i}`, businessId: `b${i}`, userId: `u${i}`, createdAt: D(at) });
const NOW = D("2027-06-01");
const run = (referrals: ReturnType<typeof ref>[], entries: RevenueEntry[], paidRwf = 0, now = NOW) => partnerCommission({ referrals, entries, paidRwf, usdToRwf: 1450, now });

describe("tiers", () => {
  it("20% for the first 5 paying clients, 25% from the 6th, 30% from the 21st", () => {
    expect(TIERS.map((t) => [t.from, t.pct])).toEqual([[1, 20], [6, 25], [21, 30]]);
    expect([1, 5, 6, 20, 21, 100].map(tierPct)).toEqual([20, 20, 25, 25, 30, 30]);
  });

  it("applies the rate reached at each payment to every client's payments", () => {
    const refs = Array.from({ length: 6 }, (_, i) => ref(i + 1));
    // Clients 1..5 pay on Nov 2..6; client 6 on Nov 20; client 1 pays again on Dec 2.
    const entries = [...refs.slice(0, 5).map((r, i) => pay(r.userId, `2026-11-0${i + 2}`, 10_000)), pay("u6", "2026-11-20", 10_000), pay("u1", "2026-12-02", 10_000)];
    const s = run(refs, entries);
    expect(s.lines.map((l) => l.pct)).toEqual([20, 20, 20, 20, 20, 25, 25]);
    expect(s.payingClients).toBe(6);
    expect(s.currentPct).toBe(25);
    expect(s.nextTier).toEqual({ from: 21, pct: 30 });
    expect(s.earnedRwf).toBe(5 * 2_000 + 2 * 2_500);
  });
});

describe("what counts", () => {
  it("counts a company only when it first pays within 90 days of signing up", () => {
    const s = run([ref(1, "2026-11-01"), ref(2, "2026-11-01")], [pay("u1", "2027-01-29", 15_000), pay("u2", "2027-01-31", 15_000)]);
    // Nov 1 + 90 days = Jan 30.
    expect(s.referrals.find((r) => r.referralId === "r1")?.qualified).toBe(true);
    expect(s.referrals.find((r) => r.referralId === "r2")?.qualified).toBe(false);
    expect(s.referrals.find((r) => r.referralId === "r2")?.firstPaidAt).toEqual(D("2027-01-31"));
    expect(s.earnedRwf).toBe(3_000);
    expect(s.payingClients).toBe(1);
  });

  it("earns for 12 months from the first payment, then stops", () => {
    const s = run([ref(1, "2026-11-01")], [pay("u1", "2026-11-05", 50_000), pay("u1", "2027-11-04", 50_000), pay("u1", "2027-11-05", 50_000)], 0, D("2028-01-01"));
    expect(s.lines.map((l) => l.at)).toEqual([D("2026-11-05"), D("2027-11-04")]);
    expect(s.referrals[0].earnUntil).toEqual(D("2027-11-05"));
  });

  it("ignores payments before the referral and other people's payments", () => {
    const s = run([ref(1, "2026-11-10")], [pay("u1", "2026-11-01", 50_000), pay("u9", "2026-11-12", 50_000), pay("u1", "2026-11-12", 15_000)]);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].baseRwf).toBe(15_000);
  });

  it("takes refunds back at the payment's rate", () => {
    const s = run([ref(1)], [pay("u1", "2026-11-05", 50_000), refund("u1", "2026-11-08", 50_000)]);
    expect(s.lines.map((l) => l.commissionRwf)).toEqual([10_000, -10_000]);
    expect(s.earnedRwf).toBe(0);
  });

  it("values a card payment (net USD) at the Settings rate, and an RWF payment as paid", () => {
    expect(baseRwfOf({ currency: "USD", localMinor: 3500, usdCents: 3500 }, 1450)).toBe(50_750);
    expect(baseRwfOf({ currency: "RWF", localMinor: 50_000, usdCents: 3448 }, 1450)).toBe(50_000);
    const s = run([ref(1)], [pay("u1", "2026-11-05", 0, { method: "card", currency: "USD", localMinor: 3500, usdCents: 3500 })]);
    expect(s.lines[0].commissionRwf).toBe(Math.round(50_750 * 0.2));
  });
});

describe("hold, payouts and owed", () => {
  it("keeps the last 14 days on hold and owes the rest minus payouts", () => {
    const now = D("2026-12-10");
    const s = run([ref(1)], [pay("u1", "2026-11-05", 50_000), pay("u1", "2026-12-01", 50_000)], 4_000, now);
    expect(s.earnedRwf).toBe(20_000);
    expect(s.onHoldRwf).toBe(10_000);
    expect(s.availableRwf).toBe(10_000);
    expect(s.paidRwf).toBe(4_000);
    expect(s.owedRwf).toBe(6_000);
  });

  it("goes negative when a refund comes after a payout (taken from the next one)", () => {
    const s = run([ref(1)], [pay("u1", "2026-11-05", 50_000), refund("u1", "2026-12-01", 50_000)], 10_000, D("2027-01-01"));
    expect(s.owedRwf).toBe(-10_000);
  });

  it("a partner with no paying client is at the first tier with nothing owed", () => {
    const s = run([ref(1)], []);
    expect(s).toMatchObject({ payingClients: 0, currentPct: 20, earnedRwf: 0, owedRwf: 0, nextTier: { from: 6, pct: 25 } });
  });
});

describe("calendar months", () => {
  it("adds months and clamps to the month's end", () => {
    expect(addMonths(new Date("2026-01-31T08:00:00Z"), 1).toISOString()).toBe("2026-02-28T08:00:00.000Z");
    expect(addMonths(new Date("2026-11-05T08:00:00Z"), 12).toISOString()).toBe("2027-11-05T08:00:00.000Z");
  });
});
