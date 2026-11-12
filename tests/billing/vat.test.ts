import { describe, expect, it } from "vitest";
import {
  adminVatPreview,
  cleanVatTin,
  clientPrice,
  DEFAULT_VAT_SETTINGS,
  grossRwf,
  netFromGross,
  vatApplies,
  vatBreakdown,
  vatPart,
  vatRateFor,
  vatReceiptLines,
  vatRatesFromRegions,
  vatTinProblem,
  type VatSettings,
} from "@/lib/billing/vat";
import { withVat, regionalPlansFor, vatFor, type RegionalPlan } from "@/lib/region-prices";
import { REGION_SEEDS } from "@/lib/region-format";
import { toClientOffer } from "@/lib/offers/shared";
import { computeTotals } from "@/lib/invoices/shared";
import { assertOfferAmount } from "@/lib/offers/activate";

// The rate now comes from the regions (PricingRegion.vatRateBps): ON is Rwanda at 18%, OFF is every region at 0%.
const ON: VatSettings = { rates: { RWF: 18 }, tin: "" };
const OFF: VatSettings = { ...ON, rates: {} };

describe("VAT on Rwandan prices (lib/billing/vat.ts)", () => {
  it("Rwanda is 18% (the region seeds), every other region 0%; no TIN by default", () => {
    expect(DEFAULT_VAT_SETTINGS).toEqual({ rates: {}, tin: "" });
    expect(vatRatesFromRegions(REGION_SEEDS)).toEqual({ RWF: 18 });
    expect(vatRatesFromRegions([{ currency: "USD", vatRateBps: 1600 }])).toEqual({}); // never on USD
  });

  it("the owner's examples: price before VAT x 1.18, rounded to the nearest 100 RWF", () => {
    expect(grossRwf(15_000)).toBe(17_700);
    expect(grossRwf(50_000)).toBe(59_000);
    expect(grossRwf(80_000)).toBe(94_400);
    expect(grossRwf(150_000)).toBe(177_000);
  });

  it("rounds to the nearest 100, half up", () => {
    expect(grossRwf(12_345)).toBe(14_600); // 14,567.1
    expect(grossRwf(1_000)).toBe(1_200); // 1,180
    expect(grossRwf(1_250)).toBe(1_500); // 1,475 -> 1,500
    expect(grossRwf(1_249)).toBe(1_500); // 1,473.82
    expect(grossRwf(1_200)).toBe(1_400); // 1,416
    expect(grossRwf(5_000)).toBe(5_900);
    expect(grossRwf(0)).toBe(0);
    expect(grossRwf(-5)).toBe(0);
    expect(grossRwf(15_000, 0)).toBe(15_000); // no rate, no VAT
  });

  it("the VAT inside a total: round(total x 18 / 118); before VAT = total - VAT", () => {
    expect(vatPart(17_700)).toBe(2_700);
    expect(netFromGross(17_700)).toBe(15_000);
    expect(vatPart(59_000)).toBe(9_000);
    expect(vatPart(94_400)).toBe(14_400);
    expect(netFromGross(94_400)).toBe(80_000);
    expect(vatPart(14_600)).toBe(2_227); // 2,227.12
    expect(netFromGross(14_600)).toBe(12_373);
    expect(vatPart(0)).toBe(0);
    expect(vatPart(17_700, 0)).toBe(0);
  });

  it("only RWF gets VAT: never USD (Paddle adds tax itself), never with the switch off", () => {
    expect(vatApplies("RWF", ON)).toBe(true);
    expect(vatApplies("rwf", ON)).toBe(true);
    expect(vatApplies("USD", ON)).toBe(false);
    expect(vatApplies("EUR", ON)).toBe(false);
    expect(vatApplies(null, ON)).toBe(false);
    expect(vatApplies("RWF", OFF)).toBe(false);
    expect(vatApplies("RWF", { ...ON, rates: { RWF: 0 } })).toBe(false);
    expect(vatRateFor("RWF", ON)).toBe(18);
    expect(vatRateFor("USD", ON)).toBeNull();
    expect(vatRateFor("RWF", OFF)).toBeNull();
  });

  it("the client price: with VAT for RWF, unchanged otherwise", () => {
    expect(clientPrice(50_000, "RWF", ON)).toBe(59_000);
    expect(clientPrice(4_900, "USD", ON)).toBe(4_900);
    expect(clientPrice(50_000, "RWF", OFF)).toBe(50_000);
    expect(clientPrice(50_000, "RWF", { ...ON, rates: { RWF: 16 } })).toBe(58_000);
  });

  it("a receipt splits the total paid, with the TIN when there is one", () => {
    expect(vatBreakdown(17_700, "RWF", ON)).toEqual({ totalMinor: 17_700, vatMinor: 2_700, netMinor: 15_000, ratePercent: 18, tin: "" });
    expect(vatBreakdown(1_200, "USD", ON)).toBeNull();
    expect(vatBreakdown(17_700, "RWF", OFF)).toBeNull();
    const fmt = (m: number) => `${m.toLocaleString("en-US")} RWF`;
    expect(vatReceiptLines(vatBreakdown(17_700, "RWF", ON)!, fmt)).toEqual([
      { label: "Of which VAT (18%)", value: "2,700 RWF" },
      { label: "Amount before VAT", value: "15,000 RWF" },
    ]);
    const withTin = vatBreakdown(59_000, "RWF", { ...ON, tin: "123456789" })!;
    expect(vatReceiptLines(withTin, fmt).at(-1)).toEqual({ label: "BuPulse TIN", value: "123456789" });
  });

  it("the admin preview beside a price typed before VAT", () => {
    expect(adminVatPreview(15_000, "RWF", ON)).toEqual({ ratePercent: 18, vatMinor: 2_700, grossMinor: 17_700 });
    expect(adminVatPreview(80_000, "RWF", ON)).toEqual({ ratePercent: 18, vatMinor: 14_400, grossMinor: 94_400 });
    expect(adminVatPreview(4_900, "USD", ON)).toBeNull();
    expect(adminVatPreview(15_000, "RWF", OFF)).toBeNull();
    expect(adminVatPreview(null, "RWF", ON)).toBeNull();
    expect(adminVatPreview(0, "RWF", ON)).toBeNull();
  });

  it("the stored TIN (the only VAT setting left): malformed values fall back to none", () => {
    expect(cleanVatTin(undefined)).toBe(DEFAULT_VAT_SETTINGS.tin);
    expect(cleanVatTin(" 100200300 ")).toBe("100200300");
    expect(cleanVatTin("<script>")).toBe("");
    expect(cleanVatTin(18)).toBe("");
    expect(vatTinProblem("")).toBeNull();
    expect(vatTinProblem("TIN 123-456/7")).toBeNull();
    expect(vatTinProblem("bad<")).toMatch(/letters, digits/);
    expect(vatTinProblem("1".repeat(41))).toMatch(/40/);
  });
});

const plan = (key: string, currency: string, monthly: number, yearly: number): RegionalPlan => ({
  key,
  name: key,
  description: "",
  isTrial: false,
  trialDays: null,
  highlight: false,
  monthlyPriceCents: monthly,
  yearlyPriceCents: yearly,
  currency,
  limits: { text: 1, image: 1, videos: 0, voiceCharacters: 0, chat: 0, videoCredits: 0, seats: 1 },
  highlights: [],
  features: [],
  regionKey: currency === "RWF" ? "RW" : "GLOBAL",
  paymentMethods: currency === "RWF" ? ["momo", "card"] : ["card"],
  card: currency === "RWF" ? { monthlyUsdCents: 1200, yearlyUsdCents: 12000 } : null,
  vatRatePercent: null,
});

/** The rate now comes from each plan's region (RegionalPlan.vat, lib/region-prices.ts vatFor): give the plans their region's VAT at these settings, then show it. */
const withVatAt = (plans: RegionalPlan[], s: VatSettings) =>
  withVat(plans.map((p) => (p.vatRatePercent ? p : { ...p, vat: vatFor({ ...REGION_SEEDS[0], currency: p.currency, vatRateBps: Math.round((s.rates[p.currency] ?? 0) * 100) }, p.monthlyPriceCents, p.yearlyPriceCents) })));

describe("regional plans with VAT (lib/region-prices.ts withVat)", () => {
  it("RWF prices go up by the VAT; the card (USD) price and USD plans stay as they are", () => {
    const [starter, business, pro, global] = withVatAt([plan("STARTER", "RWF", 15_000, 150_000), plan("BUSINESS", "RWF", 50_000, 500_000), plan("PRO", "RWF", 80_000, 800_000), plan("GLOBAL", "USD", 4_900, 49_000)], ON);
    expect([starter.monthlyPriceCents, starter.yearlyPriceCents, starter.vatRatePercent]).toEqual([17_700, 177_000, 18]);
    expect(business.monthlyPriceCents).toBe(59_000);
    expect(pro.monthlyPriceCents).toBe(94_400);
    expect(starter.card).toEqual({ monthlyUsdCents: 1200, yearlyUsdCents: 12000 });
    expect([global.monthlyPriceCents, global.vatRatePercent]).toEqual([4_900, null]);
  });

  it("is applied once, and not at all with the region at 0%", () => {
    const once = withVatAt([plan("STARTER", "RWF", 15_000, 150_000)], ON);
    expect(withVatAt(once, ON)[0].monthlyPriceCents).toBe(17_700);
    expect(withVatAt([plan("STARTER", "RWF", 15_000, 150_000)], OFF)[0]).toMatchObject({ monthlyPriceCents: 15_000, vatRatePercent: null });
  });

  it("regionalPlansFor itself keeps the stored prices (before VAT): offers, invoices and Paddle price from them", () => {
    expect(regionalPlansFor([], [], { key: "RW", name: "Rwanda", currency: "RWF", countries: ["RW"], paymentMethods: ["momo"], active: true, sortOrder: 0 })).toEqual([]);
  });
});

describe("offers, invoices and payments with VAT", () => {
  const offer = { id: "o1", status: "sent" as const, interval: "MONTH" as const, currency: "RWF", adjustedMinor: 50_000, computedMinor: 52_000, basePlanName: "Business", features: [], added: [], limits: { text: 1, image: 1, chat: 0, seats: 1, postsPerAppPerDay: 1 }, managedTier: "light" as const, lines: [], note: null, validUntil: null, payMethod: null, invoiceId: null };

  it("the client sees an RWF offer with VAT; the card quote starts from the price before VAT", () => {
    const v = toClientOffer(offer, ON);
    expect([v.totalMinor, v.computedMinor, v.netTotalMinor, v.vatRatePercent]).toEqual([59_000, 61_400, 50_000, 18]);
    const usd = toClientOffer({ ...offer, currency: "USD", adjustedMinor: 4_900, computedMinor: 4_900 }, ON);
    expect([usd.totalMinor, usd.vatRatePercent]).toEqual([4_900, null]);
    expect(toClientOffer(offer).totalMinor).toBe(50_000); // no settings: the stored price
  });

  it("an RWF invoice: lines before VAT, total = the client price, VAT = total - lines", () => {
    expect(computeTotals([{ description: "Business", quantity: 1, unitMinor: 50_000 }], 18, "RWF")).toEqual({ subtotalMinor: 50_000, taxMinor: 9_000, totalMinor: 59_000 });
    expect(computeTotals([{ description: "Starter", quantity: 1, unitMinor: 15_000 }], 18, "RWF")).toEqual({ subtotalMinor: 15_000, taxMinor: 2_700, totalMinor: 17_700 });
    expect(computeTotals([{ description: "Odd", quantity: 1, unitMinor: 12_345 }], 18, "RWF").totalMinor).toBe(14_600);
    expect(computeTotals([{ description: "Plan", quantity: 1, unitMinor: 4_900 }], null, "USD")).toEqual({ subtotalMinor: 4_900, taxMinor: 0, totalMinor: 4_900 });
  });

  it("a Mobile Money payment of an offer matches its price with VAT; a card quote its price before VAT", () => {
    expect(() => assertOfferAmount(offer, { amountMinor: 59_000, currency: "RWF" }, ON)).not.toThrow();
    expect(() => assertOfferAmount(offer, { amountMinor: 50_000, currency: "RWF" }, ON)).not.toThrow();
    expect(() => assertOfferAmount(offer, { amountMinor: 55_000, currency: "RWF" }, ON)).toThrow(/59000 RWF with VAT/);
    expect(() => assertOfferAmount(offer, { amountMinor: 59_000, currency: "USD" }, ON)).toThrow();
    expect(() => assertOfferAmount(offer, { amountMinor: 59_000, currency: "RWF" }, OFF)).toThrow();
  });
});
