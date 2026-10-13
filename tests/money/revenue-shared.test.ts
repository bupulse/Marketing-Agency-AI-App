import { describe, expect, it } from "vitest";
import { dedupe, lastFullPayments, mrrOf, rateUsed, revenueByClient, revenueByMonth, revenueByPlan, toRevenueEntry, type RevenueEntry } from "@/lib/money/revenue-shared";

const momo = (id: string, userId: string | null, rwf: number, usd: number, at = "2026-10-05T10:00:00Z", extra: Record<string, unknown> = {}) => ({
  eventId: id,
  type: "manual_payment.confirmed",
  userId,
  createdAt: new Date(at),
  payload: { occurred_at: at, data: { id: `BP-${id}`, amount_minor: rwf, currency: "RWF", usd_cents: usd, plan: "STANDARD", network: "MTN", ...extra } },
});
const card = (id: string, userId: string | null, cents: number, at = "2026-10-06T10:00:00Z") => ({
  eventId: id,
  type: "transaction.completed",
  userId,
  createdAt: new Date(at),
  payload: { occurred_at: at, data: { id: `txn_${id}`, items: [{ price: { id: "pri_1" } }], details: { payout_totals: { currency_code: "USD", earnings: String(cents) } } } },
});
const refund = (id: string, userId: string, cents: number, at = "2026-10-20T10:00:00Z") => ({
  eventId: id,
  type: "adjustment.created",
  userId,
  createdAt: new Date(at),
  payload: { occurred_at: at, data: { id: `adj_${id}`, action: "refund", status: "approved", payout_totals: { currency_code: "USD", earnings: String(cents) } } },
});
const entries = (rows: Parameters<typeof toRevenueEntry>[0][]) => dedupe(rows.map(toRevenueEntry).filter((e): e is RevenueEntry => !!e));

describe("revenue entries", () => {
  it("reads Mobile Money, card, invoice and refunds", () => {
    const list = entries([
      momo("a", "u1", 29_000, 2000),
      momo("b", "u2", 14_500, 1000, "2026-10-07T00:00:00Z", { invoice_id: "inv1" }),
      card("c", "u3", 1500),
      refund("d", "u3", 500),
      { eventId: "e", type: "invoice.paid_manual", userId: "u4", createdAt: new Date("2026-10-08T00:00:00Z"), payload: { data: { id: "BP-INV-0004", amount_minor: 5000, currency: "USD", usd_cents: 5000, method: "BANK" } } },
      { eventId: "f", type: "subscription.updated", userId: "u3", createdAt: new Date("2026-10-08T00:00:00Z"), payload: {} },
    ]);
    expect(list.map((e) => [e.method, e.usdCents])).toEqual([["momo", 2000], ["invoice", 1000], ["card", 1500], ["card", -500], ["invoice", 5000]]);
    const [oct] = revenueByMonth(list, ["2026-10"]);
    expect(oct).toMatchObject({ grossCents: 9500, refundsCents: 500, netCents: 9000, byMethod: { momo: 2000, card: 1000, invoice: 6000 }, rwfMinor: 43_500, rwfUsdCents: 3000, payingClients: 4 });
    expect(rateUsed(oct.rwfMinor, oct.rwfUsdCents)).toBe(1450);
  });

  it("counts a payment sent twice once", () => {
    expect(entries([card("x", "u1", 1000), card("x2", "u1", 1000)]).length).toBe(2);
    const twice = [card("x", "u1", 1000), { ...card("x", "u1", 1000), eventId: "dup" }];
    // Same Paddle transaction id in two events.
    twice[1].payload.data.id = "txn_x";
    expect(entries(twice).length).toBe(1);
  });

  it("keeps clients whose account is gone (lifetime revenue of every client ever)", () => {
    const list = entries([momo("a", "gone", 29_000, 2000, "2026-01-05T00:00:00Z"), momo("b", "gone", 29_000, 2000, "2026-02-05T00:00:00Z"), card("c", "u3", 1500)]);
    const clients = revenueByClient(list);
    expect(clients[0]).toMatchObject({ userId: "gone", netCents: 4000, payments: 2 });
    expect(clients.reduce((s, c) => s + c.netCents, 0)).toBe(5500);
  });

  it("groups revenue by plan, card payments through their price", () => {
    const list = entries([momo("a", "u1", 29_000, 2000), card("c", "u3", 1500)]);
    expect(revenueByPlan(list, (e) => (e.priceId === "pri_1" ? "PRO" : null))).toEqual([
      { plan: "STANDARD", netCents: 2000, clients: 1 },
      { plan: "PRO", netCents: 1500, clients: 1 },
    ]);
  });
});

describe("MRR", () => {
  it("ignores a prorated add-on payment as the client's monthly amount", () => {
    const list = entries([momo("a", "u1", 29_000, 2000, "2026-10-01T00:00:00Z"), momo("b", "u1", 7_250, 500, "2026-10-15T00:00:00Z", { period_mode: "keep" })]);
    expect(list[1].partial).toBe(true);
    expect(lastFullPayments(list).get("u1")).toBe(2000);
  });

  it("counts what a Mobile Money client last paid and a card client's plan price; yearly a twelfth", () => {
    const prices = { PRO: { monthlyPriceCents: 3000, yearlyPriceCents: 30_000 } };
    const { totalCents, byUser } = mrrOf(
      [
        { userId: "m", plan: "PRO", interval: "MONTH", provider: "MANUAL_MOMO" },
        { userId: "c", plan: "PRO", interval: "YEAR", provider: "PADDLE" },
      ],
      new Map([["m", 2000]]),
      prices,
    );
    expect(byUser.get("m")).toBe(2000);
    expect(byUser.get("c")).toBe(2500);
    expect(totalCents).toBe(4500);
  });
});
