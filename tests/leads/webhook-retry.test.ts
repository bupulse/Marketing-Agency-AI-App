import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  lead: { findMany: vi.fn(), updateMany: vi.fn() },
  chatWidget: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(async () => "whsec_x"), encrypt: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: vi.fn() }));
const deliverWebhook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/leads/webhook", async (orig) => ({ ...(await orig<typeof import("@/lib/leads/webhook")>()), deliverWebhook }));

import { retryPendingWebhooks } from "@/lib/leads/digest";
import { sendLeadWebhook } from "@/lib/leads/notify";
import { WEBHOOK_RETRY_DELAYS_MS, WEBHOOK_TIMEOUT_MS } from "@/lib/leads/webhook";

const now = new Date("2026-10-08T10:00:00Z");
const business = { id: "b1", name: "Biz" };
const lead = (id: string, pending: Date | null) => ({ id, name: "A", email: null, phone: null, interest: null, message: null, source: "website_chat", status: "NEW", pageUrl: null, createdAt: new Date("2026-10-08T01:00:00Z"), webhookPendingAt: pending, business });

beforeEach(() => {
  for (const g of Object.values(prisma)) for (const f of Object.values(g)) f.mockReset();
  deliverWebhook.mockReset();
  prisma.lead.updateMany.mockResolvedValue({ count: 1 });
  prisma.chatWidget.findUnique.mockResolvedValue({ webhookUrl: "https://hooks.example.com/a", webhookSecretEncrypted: "v1:x" });
});

describe("delivery budget", () => {
  it("fits inside the ~30 s Workers waitUntil window", () => {
    const worst = (WEBHOOK_RETRY_DELAYS_MS.length + 1) * WEBHOOK_TIMEOUT_MS + WEBHOOK_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(WEBHOOK_RETRY_DELAYS_MS).toEqual([1000, 4000]);
    expect(worst).toBeLessThanOrEqual(25_000);
  });
});

describe("sendLeadWebhook", () => {
  const args = { lead: lead("l1", null), business, webhookUrl: "https://hooks.example.com/a", secretEncrypted: "v1:x" };
  it("queues a retry when every attempt failed", async () => {
    deliverWebhook.mockResolvedValue({ ok: false, attempts: 3, error: "down" });
    expect(await sendLeadWebhook(args)).toBe(false);
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({ where: { id: "l1", webhookPendingAt: null }, data: { webhookPendingAt: expect.any(Date) } });
  });
  it("clears the queue entry on success", async () => {
    deliverWebhook.mockResolvedValue({ ok: true, attempts: 1, status: 200 });
    expect(await sendLeadWebhook(args)).toBe(true);
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({ where: { id: "l1", webhookPendingAt: { not: null } }, data: { webhookPendingAt: null } });
  });
});

describe("retryPendingWebhooks", () => {
  it("retries recent ones once, gives up on ones older than 24 h", async () => {
    prisma.lead.findMany.mockResolvedValue([lead("old", new Date("2026-10-07T09:00:00Z")), lead("recent", new Date("2026-10-08T05:00:00Z")), lead("still", new Date("2026-10-08T06:00:00Z"))]);
    deliverWebhook.mockResolvedValueOnce({ ok: true, attempts: 1 }).mockResolvedValueOnce({ ok: false, attempts: 1, error: "x" });
    const result = await retryPendingWebhooks(now);
    expect(result).toEqual({ checked: 3, delivered: 1, stillFailing: 1, gaveUp: 1 });
    expect(deliverWebhook).toHaveBeenCalledTimes(2);
    expect(deliverWebhook.mock.calls[0][0].retryDelaysMs).toEqual([]);
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({ where: { id: "old" }, data: { webhookPendingAt: null } });
  });
  it("drops the queue entry when the webhook was removed", async () => {
    prisma.lead.findMany.mockResolvedValue([lead("l1", new Date("2026-10-08T05:00:00Z"))]);
    prisma.chatWidget.findUnique.mockResolvedValue({ webhookUrl: null, webhookSecretEncrypted: null });
    await retryPendingWebhooks(now);
    expect(deliverWebhook).not.toHaveBeenCalled();
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({ where: { id: "l1" }, data: { webhookPendingAt: null } });
  });
  it("only reads leads that are pending", async () => {
    prisma.lead.findMany.mockResolvedValue([]);
    await retryPendingWebhooks(now);
    expect(prisma.lead.findMany.mock.calls[0][0].where).toEqual({ webhookPendingAt: { not: null } });
  });
});
