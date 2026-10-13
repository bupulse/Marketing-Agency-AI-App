import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../admin/fake-db";

// "Mobile Money or Card?" at every pay entry point (lib/billing/pay-methods.ts, lib/billing/card-ready.ts): the choice
// shows wherever the company's region takes both; a method that is not set up yet stays visible as "coming soon".
// The owner's report ("I can't choose MoMo or card") came from the choice being shown only when Mobile Money was set up,
// and card for Rwanda never having a Paddle price (PlanRegionPrice.paddle*PriceId empty).

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));

import { offersChoice, payMethods, soleMethod } from "@/lib/billing/pay-methods";
import { cardCheckoutConfigured, cardPricedPlans, invoicePayMethods } from "@/lib/billing/card-ready";
import { activeProvider } from "@/lib/billing";
import { clearSwitchCache } from "@/lib/admin/switch";
import { resetPlanCache } from "@/lib/plan-catalog";
import { resetRegionCache } from "@/lib/region";
import { resetRegionPriceCache } from "@/lib/region-prices";
import { REGION_SEEDS } from "@/lib/region-format";

const RW = REGION_SEEDS.find((r) => r.key === "RW")!;
const GLOBAL = REGION_SEEDS.find((r) => r.key === "GLOBAL")!;
const ENV = ["BILLING_PROVIDER", "PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET", "PADDLE_PRICE_STANDARD_MONTH", "PADDLE_PRICE_STANDARD_YEAR"] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

/** The v2 test environment: Paddle sandbox keys set, BILLING_PROVIDER not set. */
function paddleKeys() {
  process.env.PADDLE_API_KEY = "pdl_sdbx_key";
  process.env.PADDLE_CLIENT_TOKEN = "test_token";
  process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_secret";
}
function rwPrices(ids: { month?: string | null; year?: string | null } = {}) {
  h.db.planRegionPrice.rows.push({ id: "prp_std", planKey: "STANDARD", regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600, paddleMonthlyPriceId: ids.month ?? null, paddleYearlyPriceId: ids.year ?? null });
  resetRegionPriceCache();
}

beforeEach(() => {
  h.db = createFakeDb();
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetPlanCache();
  resetRegionCache();
  resetRegionPriceCache();
  clearSwitchCache();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the method choice (pure)", () => {
  it("Rwanda (Mobile Money and card), both set up: the choice, both ready", () => {
    const m = payMethods({ regionMethods: RW.paymentMethods, momoConfigured: true, cardConfigured: true, cardPriced: true });
    expect(m).toEqual({ momo: "ready", card: "ready" });
    expect(offersChoice(m)).toBe(true);
    expect(soleMethod(m)).toBeNull();
  });

  it("Rwanda with card not set up: still the choice, card shown as coming soon (never hidden)", () => {
    for (const card of [{ cardConfigured: false, cardPriced: true }, { cardConfigured: true, cardPriced: false }]) {
      const m = payMethods({ regionMethods: RW.paymentMethods, momoConfigured: true, ...card });
      expect(m).toEqual({ momo: "ready", card: "soon" });
      expect(offersChoice(m)).toBe(true);
    }
  });

  it("Rwanda before the owner has set up Mobile Money: the choice still shows (this was the bug: the dialog only opened with Mobile Money set up)", () => {
    const m = payMethods({ regionMethods: RW.paymentMethods, momoConfigured: false, cardConfigured: true, cardPriced: true });
    expect(m).toEqual({ momo: "soon", card: "ready" });
    expect(offersChoice(m)).toBe(true);
  });

  it("a card-only region: no choice, one click opens the card checkout; Mobile Money never appears", () => {
    const m = payMethods({ regionMethods: GLOBAL.paymentMethods, momoConfigured: true, cardConfigured: true, cardPriced: true });
    expect(m).toEqual({ momo: "off", card: "ready" });
    expect(offersChoice(m)).toBe(false);
    expect(soleMethod(m)).toBe("card");
    expect(soleMethod(payMethods({ regionMethods: GLOBAL.paymentMethods, momoConfigured: true, cardConfigured: false, cardPriced: true }))).toBeNull();
  });

  it("a plan without a Mobile Money price is coming soon for Mobile Money, not hidden", () => {
    expect(payMethods({ regionMethods: RW.paymentMethods, momoConfigured: true, momoPriced: false, cardConfigured: true, cardPriced: true }).momo).toBe("soon");
  });
});

describe("is card set up? (server)", () => {
  it("BILLING_PROVIDER unset means Paddle; configured needs the API key, client token and webhook secret, and the switch on", async () => {
    expect(activeProvider()).toBe("PADDLE");
    expect(await cardCheckoutConfigured()).toBe(false);
    paddleKeys();
    expect(await cardCheckoutConfigured()).toBe(true);
    // Paddle switched off in Admin -> Services: card is not offered as ready.
    h.db.serviceSwitch.rows.push({ service: "paddle", enabled: false });
    clearSwitchCache();
    expect(await cardCheckoutConfigured()).toBe(false);
  });

  it("a Rwandan plan has a card price only once its Paddle ids are on the regional price (npm run paddle:setup -- --regions)", async () => {
    rwPrices();
    expect(await cardPricedPlans("RW", ["STANDARD"])).toEqual({ STANDARD: { MONTH: false, YEAR: false } });
    h.db.planRegionPrice.rows.length = 0;
    rwPrices({ month: "pri_rw_std_m" });
    expect(await cardPricedPlans("RW", ["STANDARD"])).toEqual({ STANDARD: { MONTH: true, YEAR: false } });
  });

  it("GLOBAL uses the plan's own Paddle ids (or the PADDLE_PRICE_* fallback)", async () => {
    expect((await cardPricedPlans("GLOBAL", ["STANDARD"])).STANDARD.MONTH).toBe(false);
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    resetPlanCache();
    expect((await cardPricedPlans("GLOBAL", ["STANDARD"])).STANDARD).toEqual({ MONTH: true, YEAR: false });
  });

  it("invoices: card where the plan is priced in the region; a custom plan's invoice shows card, not ready (ask for a card link)", async () => {
    paddleKeys();
    rwPrices({ month: "pri_rw_std_m", year: "pri_rw_std_y" });
    const region = { key: "RW", paymentMethods: RW.paymentMethods };
    expect(await invoicePayMethods({ region, planKey: "STANDARD", interval: "YEAR", custom: false, momoConfigured: true })).toEqual({ momo: "ready", card: "ready" });
    expect(await invoicePayMethods({ region, planKey: "STANDARD", interval: "YEAR", custom: true, momoConfigured: true })).toEqual({ momo: "ready", card: "soon" });
    expect(await invoicePayMethods({ region, planKey: null, interval: null, custom: false, momoConfigured: false })).toEqual({ momo: "soon", card: "soon" });
  });
});
