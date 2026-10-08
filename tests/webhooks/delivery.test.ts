import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  lead: { findMany: vi.fn(), updateMany: vi.fn() },
  webhookEndpoint: { findMany: vi.fn(), updateMany: vi.fn() },
  webhookDelivery: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(async () => "whsec_x"), encrypt: vi.fn(async (s: string) => `enc:${s}`) }));
const deliverWebhook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webhooks/core", async (orig) => ({ ...(await orig<typeof import("@/lib/webhooks/core")>()), deliverWebhook }));
vi.mock("@/lib/leads/background", () => ({ runInBackground: (task: () => Promise<unknown>) => void task() }));

import { attemptDelivery, GIVE_UP_AFTER_MS, retryDelayMs } from "@/lib/webhooks/delivery";
import { emitWebhookEvent, queueWebhookEvent } from "@/lib/webhooks/emit";
import { retryDelivery } from "@/lib/webhooks/endpoints";
import { adoptLegacyPendingLeads, retryDueWebhooks } from "@/lib/webhooks/retry";

const HOUR = 3_600_000;
const t0 = new Date("2026-10-08T10:00:00Z");
const endpoint = { id: "e1", url: "https://hooks.zapier.com/x", secretEncrypted: "enc", enabled: true };
const delivery = (over: Partial<{ id: string; attempts: number; createdAt: Date }> = {}) => ({ id: "d1", event: "lead.created", payload: { event: "lead.created" }, attempts: 0, createdAt: t0, ...over });

beforeEach(() => {
  for (const g of Object.values(prisma)) for (const f of Object.values(g)) f.mockReset();
  deliverWebhook.mockReset();
  prisma.webhookDelivery.update.mockResolvedValue({});
  prisma.webhookEndpoint.updateMany.mockResolvedValue({ count: 1 });
  prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
  prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 0 });
  prisma.lead.findMany.mockResolvedValue([]);
});

describe("back-off", () => {
  it("waits 1 h, 2 h, 4 h, then 8 h", () => {
    expect([0, 1, 2, 3, 4, 9].map((r) => retryDelayMs(r) / HOUR)).toEqual([1, 2, 4, 8, 8, 8]);
  });
});

describe("emitWebhookEvent", () => {
  it("writes one delivery per subscribed endpoint, then sends", async () => {
    prisma.webhookEndpoint.findMany.mockResolvedValue([
      { ...endpoint, id: "e1", business: { id: "b1", name: "Biz" } },
      { ...endpoint, id: "e2", business: { id: "b1", name: "Biz" } },
    ]);
    prisma.webhookDelivery.create.mockImplementation(async ({ data }) => ({ id: `d-${data.endpointId}`, event: data.event, payload: data.payload, attempts: 0, createdAt: t0 }));
    deliverWebhook.mockResolvedValue({ ok: true, attempts: 1, status: 200, retryable: false });
    expect(await emitWebhookEvent("b1", "lead.created", { id: "l1" })).toBe(2);
    expect(prisma.webhookEndpoint.findMany.mock.calls[0][0].where).toEqual({ businessId: "b1", enabled: true, events: { has: "lead.created" } });
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
    const data = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ endpointId: "e1", event: "lead.created", status: "pending" });
    expect(data.nextAttemptAt).toBeInstanceOf(Date); // crash safety: the cron picks it up if the send never happens
    expect(data.payload).toMatchObject({ event: "lead.created", lead: { id: "l1" }, business: { id: "b1", name: "Biz" } });
    expect(deliverWebhook).toHaveBeenCalledTimes(2);
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "success", responseStatus: 200, nextAttemptAt: null });
  });
  it("does nothing without a subscribed endpoint", async () => {
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);
    expect(await emitWebhookEvent("b1", "post.failed", {})).toBe(0);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });
  it("never throws, even when the database is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.webhookEndpoint.findMany.mockRejectedValue(new Error("db down"));
    await expect(emitWebhookEvent("b1", "lead.created", {})).resolves.toBe(0);
    expect(() => queueWebhookEvent("b1", "lead.created", () => ({}))).not.toThrow();
    expect(() => queueWebhookEvent("b1", "lead.created", () => { throw new Error("bad data"); })).not.toThrow();
  });
});

describe("attemptDelivery", () => {
  it("quick run that keeps failing stays pending with the first back-off (1 h)", async () => {
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 3, status: 503, error: "The server answered 503.", retryable: true });
    expect(await attemptDelivery(delivery(), endpoint, "quick", t0)).toBe(false);
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "pending", attempts: 3, responseStatus: 503, nextAttemptAt: new Date(t0.getTime() + HOUR) });
    expect(prisma.webhookEndpoint.updateMany.mock.calls[0][0].data).toMatchObject({ failureCount: { increment: 1 } });
  });
  it("later cron runs back off 2 h, then 4 h", async () => {
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 1, status: 500, error: "x", retryable: true });
    await attemptDelivery(delivery({ attempts: 3 }), endpoint, "once", t0);
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data.nextAttemptAt).toEqual(new Date(t0.getTime() + 2 * HOUR));
    await attemptDelivery(delivery({ attempts: 4 }), endpoint, "once", t0);
    expect(prisma.webhookDelivery.update.mock.calls[1][0].data.nextAttemptAt).toEqual(new Date(t0.getTime() + 4 * HOUR));
  });
  it("gives up when the next try would fall after 24 hours", async () => {
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 1, status: 500, error: "The server answered 500.", retryable: true });
    const now = new Date(t0.getTime() + 20 * HOUR);
    await attemptDelivery(delivery({ attempts: 7 }), endpoint, "once", now); // next wait is 8 h -> 28 h after the event
    const data = prisma.webhookDelivery.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "failed", nextAttemptAt: null });
    expect(data.error).toMatch(/24 hours/);
  });
  it("does not retry a receiver that says 4xx", async () => {
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 1, status: 410, error: "The server answered 410.", retryable: false });
    await attemptDelivery(delivery(), endpoint, "quick", t0);
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "failed", responseStatus: 410, nextAttemptAt: null });
  });
  it("Retry and Send test are single attempts that are never rescheduled", async () => {
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 1, status: 503, error: "x", retryable: true });
    await attemptDelivery(delivery(), endpoint, "final", t0);
    expect(deliverWebhook.mock.calls[0][0].retryDelaysMs).toEqual([]);
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "failed", nextAttemptAt: null });
  });
  it("a success resets the endpoint's failure count", async () => {
    deliverWebhook.mockResolvedValue({ ok: true, attempts: 1, status: 200, retryable: false });
    expect(await attemptDelivery(delivery({ attempts: 3 }), endpoint, "once", t0)).toBe(true);
    expect(prisma.webhookEndpoint.updateMany.mock.calls[0][0].data).toMatchObject({ failureCount: 0 });
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "success", attempts: 4 });
  });
  it("sends the exact body it signs", async () => {
    deliverWebhook.mockResolvedValue({ ok: true, attempts: 1, status: 200, retryable: false });
    await attemptDelivery(delivery(), endpoint, "quick", t0);
    const call = deliverWebhook.mock.calls[0][0];
    expect(call).toMatchObject({ url: endpoint.url, secret: "whsec_x", event: "lead.created", body: '{"event":"lead.created"}' });
  });
});

describe("retryDueWebhooks (hourly cron)", () => {
  const now = new Date(t0.getTime() + 2 * HOUR);
  const row = (id: string, createdAt: Date, over: object = {}) => ({ ...delivery({ id, createdAt, attempts: 3 }), error: null, endpoint, ...over });

  it("retries due ones once, gives up after 24 h and for switched-off endpoints", async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([
      row("fresh", t0),
      row("old", new Date(now.getTime() - GIVE_UP_AFTER_MS - 1000), { error: "The server answered 500." }),
      row("paused", t0, { endpoint: { ...endpoint, enabled: false } }),
    ]);
    deliverWebhook.mockResolvedValue({ ok: true, attempts: 1, status: 200, retryable: false });
    const result = await retryDueWebhooks(now);
    expect(result).toMatchObject({ checked: 3, delivered: 1, gaveUp: 2, stillFailing: 0 });
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
    const gaveUp = prisma.webhookDelivery.updateMany.mock.calls.filter((c) => c[0].data.status === "failed");
    expect(gaveUp).toHaveLength(2);
    expect(gaveUp[0][0].data.error).toMatch(/24 hours/);
    expect(prisma.webhookDelivery.findMany.mock.calls[0][0].where).toMatchObject({ status: "pending", nextAttemptAt: { lte: now } });
  });
  it("skips a delivery another run already claimed", async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([row("x", t0)]);
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });
    await retryDueWebhooks(now);
    expect(deliverWebhook).not.toHaveBeenCalled();
  });
  it("deletes the log after 30 days", async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([]);
    prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 7 });
    const result = await retryDueWebhooks(now);
    expect(result.deleted).toBe(7);
    expect(prisma.webhookDelivery.deleteMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date(now.getTime() - 30 * 24 * HOUR));
  });
});

describe("leads left waiting by the old per-widget webhook", () => {
  const pendingSince = new Date(t0.getTime() - 2 * HOUR);
  const lead = (id: string, endpoints: { id: string }[]) => ({ id, name: "A", email: "a@x.com", phone: null, interest: null, message: null, source: "website_chat", status: "NEW", pageUrl: null, createdAt: t0, webhookPendingAt: pendingSince, business: { id: "b1", name: "Biz", webhookEndpoints: endpoints } });
  it("become pending deliveries for each lead.created endpoint, keep their 24 h clock, and leave the old queue", async () => {
    prisma.lead.findMany.mockResolvedValue([lead("l1", [{ id: "e1" }, { id: "e2" }])]);
    prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    prisma.webhookDelivery.create.mockResolvedValue({});
    expect(await adoptLegacyPendingLeads(t0)).toBe(2);
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({ where: { id: "l1", webhookPendingAt: { not: null } }, data: { webhookPendingAt: null } });
    const data = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ endpointId: "e1", event: "lead.created", status: "pending", createdAt: pendingSince });
    expect(data.payload).toMatchObject({ event: "lead.created", lead: { id: "l1", email: "a@x.com" } });
  });
  it("does not adopt a lead another run already claimed", async () => {
    prisma.lead.findMany.mockResolvedValue([lead("l1", [{ id: "e1" }])]);
    prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    expect(await adoptLegacyPendingLeads(t0)).toBe(0);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });
});

describe("manual Retry", () => {
  const next = new Date(t0.getTime() + HOUR);
  const row = (status: string) => ({ ...delivery({ attempts: 3 }), status, nextAttemptAt: status === "pending" ? next : null, endpoint });
  beforeEach(() => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({ responseStatus: 503, error: "x" });
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 1, status: 503, error: "x", retryable: true });
  });
  it("on a waiting delivery claims it first and keeps the automatic retries going if it fails again", async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(row("pending"));
    await retryDelivery("b1", "d1");
    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({ where: { id: "d1", status: "pending", nextAttemptAt: next }, data: { nextAttemptAt: expect.any(Date) } });
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "pending", nextAttemptAt: expect.any(Date) });
  });
  it("does not send when the hourly job (or another click) got the claim first", async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(row("pending"));
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });
    await expect(retryDelivery("b1", "d1")).rejects.toThrow(/being retried/);
    expect(deliverWebhook).not.toHaveBeenCalled();
  });
  it("on a failed delivery makes one attempt that is not rescheduled", async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue(row("failed"));
    await retryDelivery("b1", "d1");
    expect(prisma.webhookDelivery.updateMany).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "failed", nextAttemptAt: null });
  });
});
