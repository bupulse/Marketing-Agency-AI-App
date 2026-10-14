import { beforeEach, describe, expect, it, vi } from "vitest";

// The one-off Paddle transaction of a card-paid offer or added features (lib/billing/paddle.ts createOneOffTransaction):
// a non-catalog price for the exact amount, bought exactly once (no quantity picker in the checkout). Paddle is never
// called: fetch is mocked.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/paddle-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/paddle-config")>()),
  getPaddleConfig: async () => ({ environment: "sandbox", apiKey: "pdl_sdbx_apikey_test", clientToken: "test_token", webhookSecret: "s", source: {}, last4: {} }),
}));

import { paddle } from "@/lib/billing/paddle";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: { id: "txn_01" } }), { status: 201 }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("createOneOffTransaction", () => {
  it("one inline price of the exact amount, quantity fixed at 1 (minimum 1, maximum 1), with the signed custom data", async () => {
    const out = await paddle.createOneOffTransaction!({ amountCents: 400, currency: "USD", name: "BuPulse: features added to your plan", description: "Added features", customData: { kind: "offer", offerId: "o1" } });
    expect(out).toEqual({ transactionId: "txn_01" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/sandbox-api\.paddle\.com\/transactions$/);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.items).toHaveLength(1);
    expect(body.items[0].quantity).toBe(1);
    expect(body.items[0].price).toMatchObject({ unit_price: { amount: "400", currency_code: "USD" }, quantity: { minimum: 1, maximum: 1 }, product: { tax_category: "standard" } });
    expect(body.custom_data).toEqual({ kind: "offer", offerId: "o1" });
  });

  it("refuses an amount that is not a whole number of cents above zero, before calling Paddle", async () => {
    await expect(paddle.createOneOffTransaction!({ amountCents: 0, currency: "USD", name: "x", description: "x", customData: {} })).rejects.toThrow(/above zero/);
    await expect(paddle.createOneOffTransaction!({ amountCents: 4.5, currency: "USD", name: "x", description: "x", customData: {} })).rejects.toThrow(/whole number/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
