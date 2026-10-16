import { describe, expect, it, vi } from "vitest";
import { cardCents, ensureNotificationSetting, PADDLE_EVENTS, regionPriceJobs, syncRegionPrices } from "../../scripts/paddle-sync.mjs";

// `npm run paddle:setup -- --regions` (scripts/paddle-sync.mjs): the regional card prices Paddle needs before card
// checkout is offered in Rwanda (docs/BILLING.md). Paddle and the database are fakes here.

const rw = (over: Record<string, unknown> = {}) => ({ planKey: "STARTER", planName: "Starter", paddleProductId: null, regionKey: "RW", currency: "RWF", monthlyMinor: 15000, yearlyMinor: 150000, cardMonthlyUsdCents: 1200, cardYearlyUsdCents: 11600, paddleMonthlyPriceId: null, paddleYearlyPriceId: null, ...over });

describe("which regional prices are missing", () => {
  it("a local-currency row is charged its derived USD card price; a USD row its own price", () => {
    expect(cardCents(rw(), "MONTH")).toBe(1200);
    expect(cardCents(rw({ currency: "USD", monthlyMinor: 2500, yearlyMinor: 25000 }), "YEAR")).toBe(25000);
  });
  it("one job per interval without an id; none without a card price", () => {
    expect(regionPriceJobs(rw())).toEqual([{ interval: "MONTH", cents: 1200 }, { interval: "YEAR", cents: 11600 }]);
    expect(regionPriceJobs(rw({ paddleMonthlyPriceId: "pri_1" }))).toEqual([{ interval: "YEAR", cents: 11600 }]);
    expect(regionPriceJobs(rw({ cardMonthlyUsdCents: null, cardYearlyUsdCents: null }))).toEqual([]);
  });
});

describe("syncing with Paddle", () => {
  it("creates the product once and USD prices tagged with the region, stores the ids, and reuses what exists", async () => {
    const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
    const existing = [{ id: "pri_old", unit_price: { amount: "11600", currency_code: "USD" }, billing_cycle: { interval: "year", frequency: 1 }, custom_data: { regionKey: "RW" } }];
    const api = vi.fn(async (path: string, method: string, body?: Record<string, unknown>) => {
      calls.push({ path, method, body });
      if (path.startsWith("/products?")) return [];
      if (path === "/products") return { id: "pro_starter" };
      if (path.startsWith("/prices?")) return existing;
      return { id: "pri_new" };
    });
    const save = vi.fn(async () => {});
    const written = await syncRegionPrices({ api, db: { rows: async () => [rw(), rw({ paddleMonthlyPriceId: "pri_m", paddleYearlyPriceId: "pri_y", planKey: "BUSINESS" })], save } });
    expect(written).toEqual([
      { planKey: "STARTER", regionKey: "RW", interval: "MONTH", cents: 1200, priceId: "pri_new", reused: false },
      { planKey: "STARTER", regionKey: "RW", interval: "YEAR", cents: 11600, priceId: "pri_old", reused: true },
    ]);
    const created = calls.find((c) => c.path === "/prices" && c.method === "POST");
    expect(created?.body).toMatchObject({ product_id: "pro_starter", unit_price: { amount: "1200", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 }, custom_data: { planKey: "STARTER", regionKey: "RW" } });
    expect(calls.filter((c) => c.path === "/products" && c.method === "POST")).toHaveLength(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ planKey: "STARTER" }), "MONTH", "pri_new");
    expect(save).toHaveBeenCalledTimes(2); // the BUSINESS row already had both ids
  });
});

describe("the notification destination", () => {
  it("an existing one for the URL is reused, its missing events (refunds, completed payments) added, its secret returned", async () => {
    const api = vi.fn(async (path: string, method: string) => {
      if (method === "GET") return [{ id: "ntfset_1", type: "url", destination: "https://bupulse.com/api/billing/webhooks/paddle", endpoint_secret_key: "pdl_ntfset_x", subscribed_events: [{ name: "subscription.created" }] }];
      return {};
    });
    const r = await ensureNotificationSetting(api, "https://bupulse.com/api/billing/webhooks/paddle");
    expect(r).toMatchObject({ secret: "pdl_ntfset_x", created: false });
    expect(r.updated).toEqual(expect.arrayContaining(["transaction.completed", "adjustment.created", "adjustment.updated"]));
    expect(api).toHaveBeenCalledWith("/notification-settings/ntfset_1", "PATCH", { subscribed_events: PADDLE_EVENTS });
  });
});
