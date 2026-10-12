import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// After a downgrade the webhooks and API keys pages keep the company's existing data: a read-only list with an
// "Add to your plan" note, and only the actions that are never gated (switch off, delete, revoke).

vi.mock("@/app/dashboard/connectors/webhooks/actions", () => ({
  createWebhook: vi.fn(), deleteWebhook: vi.fn(), retryWebhookDelivery: vi.fn(), rotateWebhookSecret: vi.fn(), sendWebhookTest: vi.fn(), toggleWebhook: vi.fn(), updateWebhook: vi.fn(),
}));
vi.mock("@/app/dashboard/connectors/api/actions", () => ({ createKey: vi.fn(), revokeKey: vi.fn() }));

import { KeptDataNote } from "@/components/app/kept-data-note";
import { ApiKeysManager, type KeyView } from "@/components/connectors/api-keys-manager";
import { WebhooksManager, type DeliveryView, type EndpointView } from "@/components/connectors/webhooks-manager";
import { ToastProvider } from "@/components/ui";
import type { CompanyEntitlements } from "@/lib/entitlements";

const render = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(ToastProvider, null, node));

const endpoint = (over: Partial<EndpointView> = {}): EndpointView => ({ id: "e1", url: "https://hooks.example.com/a", events: ["lead.created"], enabled: true, createdAt: "2026-10-01T00:00:00Z", lastSuccessAt: null, lastFailureAt: null, failureCount: 0, ...over });
const failed: DeliveryView = { id: "d1", endpointId: "e1", url: "https://hooks.example.com/a", event: "lead.created", status: "failed", attempts: 3, responseStatus: 500, error: "boom", nextAttemptAt: null, createdAt: "2026-10-01T00:00:00Z" };
const key = (over: Partial<KeyView> = {}): KeyView => ({ id: "k1", name: "Zap", prefix: "bp_live_ab", scopes: ["leads:read"], lastUsedAt: null, revokedAt: null, createdAt: "2026-10-01T00:00:00Z", ...over });

describe("webhooks manager", () => {
  it("offers everything with the feature", () => {
    const html = render(createElement(WebhooksManager, { max: 5, endpoints: [endpoint()], deliveries: [failed] }));
    for (const text of ["Add webhook", "Send test event", "Edit", "New secret", "Pause", "Delete", "Retry"]) expect(html).toContain(text);
  });

  it("read-only keeps only switch off and delete", () => {
    const html = render(createElement(WebhooksManager, { max: 5, readOnly: true, endpoints: [endpoint()], deliveries: [failed] }));
    for (const text of ["Add webhook", "Send test event", ">Edit<", "New secret", "Retry"]) expect(html).not.toContain(text);
    expect(html).toContain("Pause");
    expect(html).toContain("Delete");
    expect(html).toContain("https://hooks.example.com/a");
  });

  it("read-only does not offer to switch a paused endpoint back on", () => {
    const html = render(createElement(WebhooksManager, { max: 5, readOnly: true, endpoints: [endpoint({ enabled: false })], deliveries: [] }));
    expect(html).not.toContain("Turn on");
    expect(html).toContain("Delete");
  });
});

describe("API keys manager", () => {
  it("read-only lists and revokes but cannot create", () => {
    const html = render(createElement(ApiKeysManager, { max: 5, readOnly: true, keys: [key()] }));
    expect(html).not.toContain("Create key");
    expect(html).toContain("Revoke");
    expect(html).toContain("Zap");
    expect(render(createElement(ApiKeysManager, { max: 5, keys: [key()] }))).toContain("Create key");
  });
});

describe("kept data note", () => {
  const ent = (inPlan: boolean) => ({ inPlan: new Set(inPlan ? ["webhooks"] : []), usable: new Set(), block: null }) as unknown as CompanyEntitlements;

  it("links to add the feature when the plan lacks it", () => {
    const html = renderToStaticMarkup(createElement(KeptDataNote, { feature: "webhooks", label: "webhooks", entitlements: ent(false), what: "Your webhooks" }));
    expect(html).toContain("Add webhooks to your plan");
    expect(html).toContain("/dashboard/upgrade?feature=webhooks");
  });

  it("only says it is paused when the plan has it", () => {
    const html = renderToStaticMarkup(createElement(KeptDataNote, { feature: "webhooks", label: "webhooks", entitlements: ent(true), what: "Your webhooks" }));
    expect(html).toContain("paused for a short while");
    expect(html).not.toContain("to your plan");
  });
});
