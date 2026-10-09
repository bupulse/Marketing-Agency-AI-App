import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const sql = readFileSync("prisma/migrations/20261008060000_connectors_hub_webhooks_api/migration.sql", "utf8");

describe("migration of the old per-widget lead webhook", () => {
  it("copies the address and the same encrypted secret into a lead.created endpoint", () => {
    expect(sql.indexOf('INSERT INTO "WebhookEndpoint"')).toBeGreaterThan(0);
    expect(sql).toContain("ARRAY['lead.created']");
    expect(sql).toMatch(/"webhookSecretEncrypted", true\s+FROM "ChatWidget"/);
  });
  it("does NOT clear the old widget columns (an old Worker still runs during the deploy window)", () => {
    expect(sql).not.toMatch(/UPDATE "ChatWidget"/);
    expect(sql).not.toMatch(/DROP COLUMN/);
  });
  it("turns leads still waiting for a retry into pending deliveries, then empties the old queue", () => {
    const queue = sql.indexOf('INSERT INTO "WebhookDelivery"');
    const clear = sql.indexOf('UPDATE "Lead" SET "webhookPendingAt" = NULL');
    expect(queue).toBeGreaterThan(sql.indexOf('INSERT INTO "WebhookEndpoint"'));
    expect(clear).toBeGreaterThan(queue);
  });
});

// The old columns stay filled, but nothing reads them any more: the only sender is the new endpoint list, so a lead is not sent twice.
const prisma = vi.hoisted(() => ({
  lead: { findUnique: vi.fn() },
  chatWidget: { findUnique: vi.fn() },
  webhookEndpoint: { findMany: vi.fn() },
  webhookDelivery: { create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(async () => "whsec_x"), encrypt: vi.fn() }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: vi.fn(async () => true) }));
const deliverWebhook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webhooks/core", async (orig) => ({ ...(await orig<typeof import("@/lib/webhooks/core")>()), deliverWebhook }));

import { notifyNewLead } from "@/lib/leads/notify";

describe("notifyNewLead after the migration", () => {
  beforeEach(() => {
    for (const g of Object.values(prisma)) for (const f of Object.values(g)) f.mockReset();
    deliverWebhook.mockReset().mockResolvedValue({ ok: true, attempts: 1, status: 200, retryable: false });
    prisma.lead.findUnique.mockResolvedValue({ id: "l1", name: "A", email: null, phone: null, interest: null, message: null, source: "website_chat", status: "NEW", pageUrl: null, createdAt: new Date(), business: { id: "b1", name: "Biz", user: { email: "o@x.com", deletionScheduledFor: null } }, session: null });
    prisma.webhookEndpoint.findMany.mockResolvedValue([{ id: "e1", url: "https://hooks.zapier.com/x", secretEncrypted: "enc", business: { id: "b1", name: "Biz" } }]);
    prisma.webhookDelivery.create.mockImplementation(async ({ data }) => ({ id: "d1", event: data.event, payload: data.payload, attempts: 0, createdAt: new Date() }));
  });
  it("sends exactly once even if a stale widget row still holds an address", async () => {
    prisma.chatWidget.findUnique.mockResolvedValue({ notifyInstant: true, webhookUrl: "https://hooks.zapier.com/x", webhookSecretEncrypted: "enc" });
    const result = await notifyNewLead("l1");
    expect(result.webhook).toBe(true);
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
    expect(deliverWebhook.mock.calls[0][0].body).toContain('"lead":{"id":"l1"');
  });
});
