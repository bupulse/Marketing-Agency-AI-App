import { beforeEach, describe, expect, it, vi } from "vitest";

// Features added to a card plan (lib/billing/paddle.ts addRecurringItems, docs/OFFERS.md "Adding features to a card
// plan"): Paddle replaces a subscription's whole item list, so every current item goes back by its price id, plus one
// non-catalog price per added feature, charged now prorated; a failed payment changes nothing. fetch is mocked.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/paddle-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/paddle-config")>()),
  getPaddleConfig: async () => ({ environment: "sandbox", apiKey: "pdl_sdbx_apikey_test", clientToken: "test_token", webhookSecret: "s", source: {}, last4: {} }),
}));

import { paddle } from "@/lib/billing/paddle";

const USER = "33333333-3333-4333-8333-333333333333";
const subscription = (items: unknown[]) => ({
  id: "sub_1",
  status: "active",
  customer_id: "ctm_1",
  currency_code: "USD",
  items,
  current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
  updated_at: "2026-10-13T08:00:00Z",
  custom_data: { userId: USER },
});
const plan = { quantity: 1, price: { id: "pri_plan", custom_data: null } };
const earlier = { quantity: 1, price: { id: "pri_add_old", custom_data: { kind: "bupulse_addon", key: "aiPhotos", offerId: "o0", userId: USER, sig: "s0" }, unit_price: { amount: "400" } } };
const added = { quantity: 1, price: { id: "pri_add_new", custom_data: { kind: "bupulse_addon", key: "websiteChat", offerId: "o1", userId: USER, sig: "s1" }, unit_price: { amount: "800" } } };

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url, init) =>
    new Response(JSON.stringify({ data: init?.method === "PATCH" ? subscription([earlier, plan, added]) : subscription([earlier, plan]) }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

describe("addRecurringItems", () => {
  it("keeps every current item by price id (the plan first), adds a non-catalog monthly price per feature, prorated now, prevent_change", async () => {
    const out = await paddle.addRecurringItems!("sub_1", [{ name: "BuPulse Website chat and leads", description: "Website chat and leads, added to your BuPulse plan", amountCents: 800, currency: "USD", interval: "MONTH", customData: { kind: "bupulse_addon", key: "websiteChat", offerId: "o1", userId: USER, sig: "s1" } }]);
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET https://sandbox-api.paddle.com/subscriptions/sub_1", "PATCH https://sandbox-api.paddle.com/subscriptions/sub_1"]);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toEqual({
      items: [
        { price_id: "pri_plan", quantity: 1 },
        { price_id: "pri_add_old", quantity: 1 },
        {
          quantity: 1,
          price: {
            name: "BuPulse Website chat and leads",
            description: "Website chat and leads, added to your BuPulse plan",
            billing_cycle: { interval: "month", frequency: 1 },
            unit_price: { amount: "800", currency_code: "USD" },
            quantity: { minimum: 1, maximum: 1 },
            product: { name: "BuPulse Website chat and leads", tax_category: "saas" },
            custom_data: { kind: "bupulse_addon", key: "websiteChat", offerId: "o1", userId: USER, sig: "s1" },
          },
        },
      ],
      proration_billing_mode: "prorated_immediately",
      on_payment_failure: "prevent_change",
    });
    // Paddle's answer, read like a webhook: the plan's own price, and both added features.
    expect(out.providerPriceId).toBe("pri_plan");
    expect(out.addons?.map((a) => [a.key, a.offerId, a.amountCents])).toEqual([["aiPhotos", "o0", 400], ["websiteChat", "o1", 800]]);
  });

  it("a yearly plan's features are yearly; a subscription billed in another currency is refused before any change", async () => {
    await paddle.addRecurringItems!("sub_1", [{ name: "x", description: "x added", amountCents: 8000, currency: "USD", interval: "YEAR", customData: {} }]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).items[2].price.billing_cycle).toEqual({ interval: "year", frequency: 1 });

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: { ...subscription([plan]), currency_code: "EUR" } }), { status: 200 }));
    await expect(paddle.addRecurringItems!("sub_1", [{ name: "x", description: "x added", amountCents: 800, currency: "USD", interval: "MONTH", customData: {} }])).rejects.toThrow(/billed in EUR/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Paddle's refusal (a declined payment) comes back as an error with its code, never the key", async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === "PATCH"
        ? new Response(JSON.stringify({ error: { code: "subscription_payment_declined", detail: "The payment was declined" } }), { status: 400 })
        : new Response(JSON.stringify({ data: subscription([plan]) }), { status: 200 }),
    );
    const e = await paddle.addRecurringItems!("sub_1", [{ name: "x", description: "x added", amountCents: 800, currency: "USD", interval: "MONTH", customData: {} }]).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe("Paddle API 400 on /subscriptions/sub_1: subscription_payment_declined The payment was declined");
    expect((e as Error).message).not.toMatch(/pdl_sdbx_apikey_test/);
  });
});

describe("removeRecurringItems", () => {
  it("sends back every other item by price id, prorated_immediately (the unused part is credited), never the plan alone gone", async () => {
    fetchMock.mockImplementation(async (_url, init) => new Response(JSON.stringify({ data: init?.method === "PATCH" ? subscription([plan, added]) : subscription([earlier, plan, added]) }), { status: 200 }));
    const out = await paddle.removeRecurringItems!("sub_1", ["pri_add_old"]);
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET https://sandbox-api.paddle.com/subscriptions/sub_1", "PATCH https://sandbox-api.paddle.com/subscriptions/sub_1"]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ items: [{ price_id: "pri_plan", quantity: 1 }, { price_id: "pri_add_new", quantity: 1 }], proration_billing_mode: "prorated_immediately", on_payment_failure: "prevent_change" });
    expect(out.addons?.map((a) => a.key)).toEqual(["websiteChat"]);
  });

  it("an item no longer there, or taking every item off, is refused before any change", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: subscription([plan, added]) }), { status: 200 }));
    await expect(paddle.removeRecurringItems!("sub_1", ["pri_gone"])).rejects.toThrow(/not on the subscription/);
    await expect(paddle.removeRecurringItems!("sub_1", ["pri_plan", "pri_add_new"])).rejects.toThrow(/keeps at least its plan/);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });
});
