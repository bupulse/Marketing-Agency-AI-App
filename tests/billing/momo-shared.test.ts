import { describe, expect, it } from "vitest";
import {
  cleanMomoSettings,
  formatMomoAmount,
  graceEnd,
  isReference,
  makeReference,
  momoConfigured,
  momoPriceFor,
  nextManualPeriod,
  proofSchema,
  REFERENCE_ALPHABET,
  reminderDue,
  rwfFromUsdCents,
  usdCentsOf,
  whatsappText,
} from "@/lib/billing/momo-shared";

const d = (s: string) => new Date(s);

describe("payment reference", () => {
  it("is BP- plus unambiguous characters (no 0, O, 1 or I)", () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 200; i++) {
      const ref = makeReference();
      expect(ref).toMatch(/^BP-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      expect(isReference(ref)).toBe(true);
    }
    expect(makeReference(6)).toHaveLength(9);
    expect(makeReference(4, () => 0)).toBe("BP-AAAA");
    expect(makeReference(4, () => 0.999999)).toBe("BP-9999");
  });

  it("refuses anything else", () => {
    for (const bad of ["BP-7K30", "bp-7k3q", "BP-7K3", "7K3Q", "BP-7K3QABCD", 42, null]) expect(isReference(bad)).toBe(false);
  });
});

describe("the period a confirmed payment buys", () => {
  const now = d("2026-10-14T10:00:00Z");
  it("starts now for a trial, an ended plan or a card plan", () => {
    expect(nextManualPeriod({ status: "TRIALING", currentPeriodEnd: null, provider: null }, "MONTH", now)).toEqual({ start: now, end: d("2026-11-14T10:00:00Z") });
    expect(nextManualPeriod({ status: "PAST_DUE", currentPeriodEnd: d("2026-10-10T00:00:00Z"), provider: "MANUAL_MOMO" }, "MONTH", now).start).toEqual(now);
    expect(nextManualPeriod({ status: "ACTIVE", currentPeriodEnd: d("2026-11-01T00:00:00Z"), provider: "PADDLE" }, "MONTH", now).start).toEqual(now);
  });
  it("extends a running Mobile Money period from its end, monthly or yearly", () => {
    const sub = { status: "ACTIVE", currentPeriodEnd: d("2026-10-20T00:00:00Z"), provider: "MANUAL_MOMO" };
    expect(nextManualPeriod(sub, "MONTH", now)).toEqual({ start: d("2026-10-20T00:00:00Z"), end: d("2026-11-20T00:00:00Z") });
    expect(nextManualPeriod(sub, "YEAR", now)).toEqual({ start: d("2026-10-20T00:00:00Z"), end: d("2027-10-20T00:00:00Z") });
  });
  it("a period that already ended (inside grace) starts now, not from the old end", () => {
    expect(nextManualPeriod({ status: "ACTIVE", currentPeriodEnd: d("2026-10-13T00:00:00Z"), provider: "MANUAL_MOMO" }, "MONTH", now).start).toEqual(now);
  });
  it("grace is 3 days after the end", () => {
    expect(graceEnd(d("2026-10-20T00:00:00Z"))).toEqual(d("2026-10-23T00:00:00Z"));
  });
});

describe("reminder timing", () => {
  const end = d("2026-10-20T00:00:00Z");
  it("5 days before, then 1 day before (also right after the end, inside grace), nothing earlier or after grace", () => {
    expect(reminderDue(end, d("2026-10-10T00:00:00Z"))).toBeNull();
    expect(reminderDue(end, d("2026-10-15T00:00:00Z"))).toBe("5d");
    expect(reminderDue(end, d("2026-10-17T12:00:00Z"))).toBe("5d");
    expect(reminderDue(end, d("2026-10-19T00:00:00Z"))).toBe("1d");
    expect(reminderDue(end, d("2026-10-21T00:00:00Z"))).toBe("1d");
    expect(reminderDue(end, d("2026-10-24T00:00:00Z"))).toBeNull();
  });
});

describe("money", () => {
  it("formats francs without decimals and dollars with", () => {
    expect(formatMomoAmount(15000)).toBe("15,000 RWF");
    expect(formatMomoAmount(1200, "USD")).toBe("12.00 USD");
  });
  it("converts for the USD revenue roll-up and from USD prices", () => {
    expect(usdCentsOf(15000, "RWF", 1450)).toBe(1034);
    expect(usdCentsOf(4900, "USD", 1450)).toBe(4900);
    expect(usdCentsOf(15000, "RWF", 0)).toBe(0);
    expect(rwfFromUsdCents(1200, 1450)).toBe(17400);
    expect(rwfFromUsdCents(4900, 1450)).toBe(71100);
  });
  it("uses the owner's RWF price when there is one, else the converted USD price", () => {
    const settings = cleanMomoSettings({ merchantCode: "123456", usdToRwf: 1450, prices: { STARTER: { monthlyMinor: 15000, yearlyMinor: 150000 } } });
    expect(momoPriceFor({ key: "STARTER", monthlyPriceCents: 1200, yearlyPriceCents: 12000 }, "MONTH", settings)).toBe(15000);
    expect(momoPriceFor({ key: "STARTER", monthlyPriceCents: 1200, yearlyPriceCents: 12000 }, "YEAR", settings)).toBe(150000);
    expect(momoPriceFor({ key: "PRO", monthlyPriceCents: 9900, yearlyPriceCents: 99000 }, "MONTH", settings)).toBe(143600);
  });
});

describe("owner settings", () => {
  it("reads a stored row defensively and knows when Mobile Money can be offered", () => {
    expect(cleanMomoSettings(null)).toMatchObject({ merchantCode: "", momoNumber: "", usdToRwf: 1450, prices: {} });
    expect(momoConfigured(cleanMomoSettings(null))).toBe(false);
    const s = cleanMomoSettings({ merchantCode: " 123456 ", momoNumber: "078", usdToRwf: -5, prices: { OK: { monthlyMinor: 1, yearlyMinor: 2 }, BAD: { monthlyMinor: "x" }, "no good!": { monthlyMinor: 1, yearlyMinor: 1 } } });
    expect(s).toMatchObject({ merchantCode: "123456", momoNumber: "078", usdToRwf: 1450, prices: { OK: { monthlyMinor: 1, yearlyMinor: 2 } } });
    expect(momoConfigured(s)).toBe(true);
  });
});

describe("what the client types", () => {
  const ok = { paymentId: "p1", transactionId: "ABC-123.4", payerPhone: "078 123 4567", network: "MTN" };
  it("accepts a transaction id, a phone and a network", () => {
    expect(proofSchema.safeParse(ok).success).toBe(true);
    expect(proofSchema.safeParse({ ...ok, payerPhone: "+250 788 123 456" }).success).toBe(true);
  });
  it("refuses a short or odd transaction id, a short phone and an unknown network", () => {
    expect(proofSchema.safeParse({ ...ok, transactionId: "ab" }).error?.issues[0].message).toMatch(/transaction id/);
    expect(proofSchema.safeParse({ ...ok, transactionId: "abc def" }).success).toBe(false);
    expect(proofSchema.safeParse({ ...ok, payerPhone: "0781" }).error?.issues[0].message).toMatch(/phone number/);
    expect(proofSchema.safeParse({ ...ok, network: "TIGO" }).error?.issues[0].message).toMatch(/MTN or Airtel/);
  });
});

describe("WhatsApp-ready text", () => {
  it("names the plan, the amount, the reference and the account", () => {
    expect(whatsappText({ planName: "Starter", amountMinor: 15000, currency: "RWF", reference: "BP-7K3Q", email: "a@b.rw" })).toBe("Hello BuPulse, I am renewing my Starter plan (15,000 RWF) by Mobile Money.\nReference: BP-7K3Q\nAccount: a@b.rw");
  });
});
