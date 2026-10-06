import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, update, findFirst, findUnique, subUpdate, logError } = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  subUpdate: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { billingEvent: { upsert, update }, subscription: { findFirst, findUnique, updateMany: subUpdate } },
}));
vi.mock("@/lib/errors", () => ({ logError }));

import { POST } from "@/app/api/billing/webhooks/paddle/route";
import { signCheckoutUser } from "@/lib/billing/signing";

const SECRET = "pdl_ntfset_test";
const USER = "11111111-1111-4111-8111-111111111111";
let SIG = "";

function event(subscription: Record<string, unknown> = {}, type = "subscription.updated", id = "evt_1") {
  return JSON.stringify({
    event_id: id,
    event_type: type,
    data: {
      id: "sub_1",
      status: "active",
      customer_id: "ctm_1",
      items: [{ price: { id: "pri_std_m" } }],
      custom_data: { userId: USER, sig: SIG },
      current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
      scheduled_change: null,
      ...subscription,
    },
  });
}

function call(body: string, opts: { ts?: number; signature?: string | null } = {}) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");
  const headers: Record<string, string> = {};
  if (opts.signature !== null) headers["paddle-signature"] = opts.signature ?? `ts=${ts};h1=${h1}`;
  return POST(new NextRequest("https://bupulse.test/api/billing/webhooks/paddle", { method: "POST", headers, body }));
}

describe("paddle webhook route", () => {
  beforeEach(async () => {
    for (const m of [upsert, update, findFirst, findUnique, subUpdate, logError]) m.mockReset();
    process.env.ENCRYPTION_KEY = "test-key";
    SIG = await signCheckoutUser(USER);
    process.env.PADDLE_WEBHOOK_SECRET = SECRET;
    process.env.PADDLE_PRICE_STANDARD_MONTH = "pri_std_m";
    upsert.mockResolvedValue({ id: "be_1", processedAt: null });
    update.mockResolvedValue({});
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: null, status: "TRIALING" });
    subUpdate.mockResolvedValue({ count: 1 });
  });

  it("rejects missing, invalid and stale signatures with 401", async () => {
    expect((await call(event(), { signature: null })).status).toBe(401);
    expect((await call(event(), { signature: `ts=${Math.floor(Date.now() / 1000)};h1=${"0".repeat(64)}` })).status).toBe(401);
    expect((await call(event(), { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 500 when the secret is not configured", async () => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    expect((await call(event())).status).toBe(500);
  });

  it("applies an active subscription", async () => {
    const response = await call(event());
    expect(response.status).toBe(200);
    expect(subUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER, providerSubscriptionId: null }),
        data: expect.objectContaining({ plan: "STANDARD", interval: "MONTH", status: "ACTIVE", cancelAtPeriodEnd: false, providerSubscriptionId: "sub_1" }),
      }),
    );
    expect(update).toHaveBeenCalledWith({ where: { id: "be_1" }, data: { processedAt: expect.any(Date), error: null } });
  });

  it("applies cancel at period end and keeps the plan active", async () => {
    await call(event({ scheduled_change: { action: "cancel", effective_at: "2026-11-01T00:00:00Z" } }));
    expect(subUpdate.mock.calls[0][0].data).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
  });

  it("applies past_due", async () => {
    await call(event({ status: "past_due" }, "subscription.past_due"));
    expect(subUpdate.mock.calls[0][0].data).toMatchObject({ status: "PAST_DUE" });
  });

  it("skips an event that was already processed", async () => {
    upsert.mockResolvedValue({ id: "be_1", processedAt: new Date() });
    const response = await call(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it("keeps an unknown price for a retry (likely a missing price setting)", async () => {
    const response = await call(event({ items: [{ price: { id: "pri_other" } }] }));
    expect(response.status).toBe(500);
    expect(subUpdate).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toEqual({ error: expect.stringMatching(/Unknown Paddle price/) });
  });

  it("ignores an unknown user without failing", async () => {
    findUnique.mockResolvedValue(null);
    expect((await call(event())).status).toBe(200);
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it("ignores a forged user id", async () => {
    expect((await call(event({ custom_data: { userId: USER, sig: "0".repeat(64) } }))).status).toBe(200);
    expect(findUnique).not.toHaveBeenCalled();
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it("cancels a second live subscription straight away and flags it for a refund", async () => {
    findUnique.mockResolvedValue({ userId: USER, providerSubscriptionId: "sub_0", status: "ACTIVE" });
    process.env.PADDLE_API_KEY = "pdl_test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: JSON.parse(event()).data }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(event())).status).toBe(200);
    vi.unstubAllGlobals();
    expect(subUpdate).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/subscriptions\/sub_1\/cancel$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ effective_from: "immediately" });
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "billing.duplicate" }));
  });

  it("stores non-subscription events without applying anything", async () => {
    expect((await call(event({}, "transaction.payment_failed", "evt_2"))).status).toBe(200);
    expect(findFirst).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it("returns 500 and logs when processing fails, so Paddle retries", async () => {
    subUpdate.mockRejectedValue(new Error("db down"));
    expect((await call(event())).status).toBe(500);
    expect(logError).toHaveBeenCalled();
    expect(update.mock.calls[0][0].data.error).toBe("db down");
  });
});
