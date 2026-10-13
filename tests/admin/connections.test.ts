/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: Record<string, any> = {
    connection: { findUnique: fn(), findMany: fn(), updateMany: fn() },
    post: { count: fn(), updateMany: fn(), groupBy: fn(), deleteMany: fn(), delete: fn() },
    storeConnection: { findUnique: fn(), findMany: fn() },
    cloudflareConnection: { findUnique: fn(), findMany: fn() },
    canvaConnection: { findUnique: fn(), findMany: fn() },
    webhookEndpoint: { findUnique: fn(), findMany: fn(), updateMany: fn() },
    webhookDelivery: { groupBy: fn(), findMany: fn() },
    apiKey: { findUnique: fn(), findMany: fn(), updateMany: fn() },
    chatWidget: { findUnique: fn(), findMany: fn(), updateMany: fn() },
    rateLimit: { groupBy: fn() },
    usageRecord: { findMany: fn() },
    subscription: { findMany: fn() },
    mediaAsset: { groupBy: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
  };
  db.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(db));
  return { db, disconnect: vi.fn(async () => {}), revoke: vi.fn(async () => {}), adminAction: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: h.db }));
vi.mock("@/lib/crypto", () => ({ decrypt: vi.fn(async (v: string) => `plain-${v}`) }));
vi.mock("@/lib/social/registry", () => ({ isNetwork: (n: string) => ["instagram", "facebook"].includes(n), getProvider: () => ({ revoke: h.revoke }) }));
vi.mock("@/lib/connectors/catalog", () => ({ ENTRIES: [{ id: "shopify", disconnect: h.disconnect }, { id: "cloudflare", disconnect: h.disconnect }, { id: "canva", disconnect: h.disconnect }] }));
vi.mock("@/lib/admin/plan-limits", () => ({ getPlanLimits: vi.fn(async () => ({ chat: 50 })) }));
vi.mock("@/lib/admin/console", async () => ({
  adminAction: h.adminAction,
  finish: async (_back: string, _ok: unknown, fn: () => Promise<unknown>) => {
    await fn();
  },
}));

import * as actions from "@/lib/admin/actions/connections";
import * as reads from "@/lib/admin/connections";
import * as consoleActions from "@/app/admin/(console)/(clients)/connections/actions";
import { apiContext, consoleContext } from "@/lib/admin/types";

const ctx = consoleContext("203.0.113.5");
const audits = () => h.db.auditLog.create.mock.calls.map((c: any[]) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(h.db));
  h.adminAction.mockResolvedValue(ctx);
});

const channel = { id: "c1", kind: "SOCIAL", provider: "instagram", businessId: "b1", displayName: "Shop", externalAccountId: "x1", status: "ACTIVE", postingMode: "AUTO", accessTokenEncrypted: "enc-a", refreshTokenEncrypted: "enc-r", expiresAt: null };

describe("force disconnect", () => {
  it("erases tokens, keeps the row and every post, marks queued posts, and audits", async () => {
    h.db.connection.findUnique.mockResolvedValue(channel);
    h.db.post.count.mockResolvedValue(3);
    h.db.connection.updateMany.mockResolvedValue({ count: 1 });
    h.db.post.updateMany.mockResolvedValue({ count: 3 });
    const r = await actions.forceDisconnectChannel(ctx, { connectionId: "c1", reason: "abuse" });
    expect(r).toMatchObject({ status: "REVOKED", postsMarkedNeedsReconnect: 3 });
    expect(h.revoke).toHaveBeenCalledTimes(1);
    const data = h.db.connection.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ accessTokenEncrypted: null, refreshTokenEncrypted: null, status: "REVOKED" });
    // Posts are only annotated: never deleted, detached or moved to another status.
    expect(h.db.post.deleteMany).not.toHaveBeenCalled();
    expect(h.db.post.delete).not.toHaveBeenCalled();
    const postData = h.db.post.updateMany.mock.calls[0][0].data;
    expect(Object.keys(postData)).toEqual(["lastError"]);
    expect(postData.lastError).toMatch(/Needs reconnect/);
    const [a] = audits();
    expect(a).toMatchObject({ actor: "admin", action: "force_disconnect_channel", target: "connection:c1" });
    expect(a.before.queuedPosts).toBe(3);
    expect(a.after).toMatchObject({ status: "REVOKED", postsDeleted: 0 });
    expect(JSON.stringify(a)).not.toContain("enc-a");
  });

  it("revokes at the network only after the database change commits, and audits the outcome", async () => {
    h.db.connection.findUnique.mockResolvedValue(channel);
    h.db.post.count.mockResolvedValue(0);
    h.db.post.updateMany.mockResolvedValue({ count: 0 });
    // The transaction fails (the row vanished): no network call, no audit row.
    h.db.connection.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(actions.forceDisconnectChannel(ctx, { connectionId: "c1" })).rejects.toMatchObject({ code: "not_found" });
    expect(h.revoke).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
    // It commits: the revoke runs afterwards and its outcome is a second audit row.
    h.db.connection.updateMany.mockResolvedValue({ count: 1 });
    const r = await actions.forceDisconnectChannel(ctx, { connectionId: "c1" });
    expect(r.networkRevoke).toBe("revoked");
    expect(audits().map((a: any) => a.action)).toEqual(["force_disconnect_channel", "force_disconnect_channel_revoke"]);
    expect(audits()[1].after).toEqual({ networkRevoke: "revoked" });
  });

  it("a failed network revoke does not block, an unknown id is refused, and the API needs confirm", async () => {
    h.db.connection.findUnique.mockResolvedValue(channel);
    h.db.connection.updateMany.mockResolvedValue({ count: 1 });
    h.db.post.updateMany.mockResolvedValue({ count: 0 });
    h.db.post.count.mockResolvedValue(0);
    h.revoke.mockRejectedValueOnce(new Error("network down"));
    await expect(actions.forceDisconnectChannel(ctx, { connectionId: "c1" })).resolves.toMatchObject({ status: "REVOKED" });
    h.db.connection.findUnique.mockResolvedValue(null);
    await expect(actions.forceDisconnectChannel(ctx, { connectionId: "nope" })).rejects.toMatchObject({ code: "not_found" });
    await expect(actions.forceDisconnectChannel(apiContext("k1"), { connectionId: "c1" })).rejects.toMatchObject({ code: "confirm_required" });
  });
});

describe("other actions audit", () => {
  it("disconnects a store through the connector entry and audits", async () => {
    h.db.storeConnection.findUnique.mockResolvedValue({ id: "s1", provider: "shopify", storeUrl: "https://shop.example.com/x", status: "ACTIVE", businessId: "b1", business: { userId: "u1" }, _count: { products: 4 } });
    await actions.disconnectConnector(ctx, { kind: "store", id: "s1" });
    expect(h.disconnect).toHaveBeenCalledWith({ userId: "u1", businessId: "b1" });
    expect(audits().map((a: any) => a.action)).toEqual(["disconnect_connector", "disconnect_connector_done"]);
    expect(audits()[0]).toMatchObject({ target: "store:s1" });
    expect(audits()[0].before.products).toBe(4);
  });

  it("audits the request before the connector runs, and records a failed disconnect", async () => {
    h.db.cloudflareConnection.findUnique.mockResolvedValue({ businessId: "b1", status: "ACTIVE", business: { userId: "u1" }, _count: { installs: 1 } });
    h.disconnect.mockRejectedValueOnce(new Error("boom"));
    await expect(actions.disconnectConnector(ctx, { kind: "cloudflare", id: "b1" })).rejects.toThrow("boom");
    expect(audits().map((a: any) => a.action)).toEqual(["disconnect_connector", "disconnect_connector_failed"]);
  });

  it("pauses and resumes a webhook, audited, with the host only", async () => {
    h.db.webhookEndpoint.findUnique.mockResolvedValueOnce({ id: "w1", businessId: "b1", url: "https://hooks.example.com/secret/path?k=1", enabled: true, failureCount: 5 });
    h.db.webhookEndpoint.updateMany.mockResolvedValue({ count: 1 });
    await actions.pauseWebhook(ctx, { endpointId: "w1", reason: "abuse" });
    h.db.webhookEndpoint.findUnique.mockResolvedValueOnce({ id: "w1", businessId: "b1", url: "https://hooks.example.com/x", enabled: true, failureCount: 5, pausedByAdminAt: new Date(), pausedByAdminReason: "abuse" });
    await actions.resumeWebhook(ctx, { endpointId: "w1" });
    expect(audits().map((a: any) => a.action)).toEqual(["pause_webhook", "resume_webhook"]);
    expect(JSON.stringify(audits())).not.toContain("secret/path");
    expect(h.db.webhookEndpoint.updateMany.mock.calls[0][0].data).toMatchObject({ pausedByAdminReason: "abuse" });
    expect(h.db.webhookEndpoint.updateMany.mock.calls[0][0].data.enabled).toBeUndefined();
    expect(h.db.webhookEndpoint.updateMany.mock.calls[1][0].data).toMatchObject({ pausedByAdminAt: null, failureCount: 0 });
  });

  it("revokes an API key once and audits only the prefix", async () => {
    h.db.apiKey.findUnique.mockResolvedValueOnce({ id: "k1", businessId: "b1", name: "n", prefix: "bp_live_ab", scopes: ["posts:read"], revokedAt: null });
    h.db.apiKey.updateMany.mockResolvedValue({ count: 1 });
    await actions.revokeClientApiKey(ctx, { keyId: "k1" });
    expect(audits()[0]).toMatchObject({ action: "revoke_client_api_key", target: "api_key:k1" });
    h.db.apiKey.findUnique.mockResolvedValueOnce({ id: "k1", revokedAt: new Date() });
    await expect(actions.revokeClientApiKey(ctx, { keyId: "k1" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("switches a widget off only with a reason, and on again", async () => {
    h.db.chatWidget.findUnique.mockResolvedValue({ businessId: "b1", enabled: true, disabledByAdminAt: null });
    h.db.chatWidget.updateMany.mockResolvedValue({ count: 1 });
    await expect(actions.switchOffWidget(ctx, { businessId: "b1", reason: "  " })).rejects.toMatchObject({ code: "invalid" });
    await actions.switchOffWidget(ctx, { businessId: "b1", reason: "Spam flood" });
    expect(h.db.chatWidget.updateMany.mock.calls[0][0].data).toMatchObject({ disabledByAdminReason: "Spam flood" });
    expect(h.db.chatWidget.updateMany.mock.calls[0][0].data.enabled).toBeUndefined();
    h.db.chatWidget.findUnique.mockResolvedValue({ businessId: "b1", disabledByAdminAt: new Date(), disabledByAdminReason: "Spam flood" });
    await actions.switchOnWidget(ctx, { businessId: "b1" });
    expect(audits().map((a: any) => a.action)).toEqual(["switch_off_widget", "switch_on_widget"]);
    await expect(actions.switchOffWidget(apiContext("k"), { businessId: "b1", reason: "x" })).rejects.toMatchObject({ code: "confirm_required" });
  });
});

describe("console server actions refuse non-admins", () => {
  it("never reach the database when the admin check throws", async () => {
    h.adminAction.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    const f = new FormData();
    f.set("id", "x");
    f.set("kind", "store");
    f.set("reason", "r");
    for (const fn of [consoleActions.forceDisconnectAction, consoleActions.disconnectConnectorAction, consoleActions.pauseWebhookAction, consoleActions.resumeWebhookAction, consoleActions.revokeApiKeyAction, consoleActions.switchOffWidgetAction, consoleActions.switchOnWidgetAction]) {
      await expect(fn(f)).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(h.db.auditLog.create).not.toHaveBeenCalled();
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.disconnect).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  const row = (i: number) => ({
    id: `c${i}`, provider: "instagram", displayName: "A", externalAccountId: "x", accountType: null, postingMode: "AUTO", status: "ACTIVE", expiresAt: null, lastCheckedAt: null,
    lastError: "failed with token abcdefghijklmnopqrstuvwxyz0123456789", createdAt: new Date(), accessTokenEncrypted: "enc-SECRET",
    business: { id: "b", name: "Biz", user: { id: "u", email: "o@x.com" } },
  });

  it("pages with a cursor and never returns token values", async () => {
    h.db.connection.findMany.mockResolvedValue([row(1), row(2), row(3)]);
    h.db.post.groupBy.mockResolvedValue([]);
    const p = await reads.listChannels({ limit: 2 });
    expect(p.items).toHaveLength(2);
    expect(p.nextCursor).toBe("c2");
    await reads.listChannels({ limit: 2, cursor: "c2" });
    expect(h.db.connection.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: "c2" }, skip: 1, take: 3 });
    const text = JSON.stringify(p);
    expect(text).not.toContain("enc-SECRET");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(p.items[0].status).toBe("healthy");
  });

  it("searches by business name or owner email and rejects unknown filters", async () => {
    h.db.connection.findMany.mockResolvedValue([]);
    await reads.listChannels({ q: "acme" });
    const where = h.db.connection.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where.business)).toContain("acme");
    expect(JSON.stringify(where.business)).toContain("email");
    await expect(reads.listChannels({ status: "bogus" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("derives channel status", () => {
    const base = { status: "ACTIVE", postingMode: "AUTO", accessTokenEncrypted: "e", expiresAt: null as Date | null };
    const now = Date.now();
    expect(reads.channelStatus(base, now)).toBe("healthy");
    expect(reads.channelStatus({ ...base, expiresAt: new Date(now + 3600_000) }, now)).toBe("expiring");
    expect(reads.channelStatus({ ...base, expiresAt: new Date(now - 1) }, now)).toBe("expired");
    expect(reads.channelStatus({ ...base, status: "REVOKED", accessTokenEncrypted: null }, now)).toBe("needs_reconnect");
    expect(reads.channelStatus({ ...base, postingMode: "NOTIFY", accessTokenEncrypted: null }, now)).toBe("healthy");
  });

  it("never selects secret columns and shows a webhook host only", async () => {
    h.db.webhookEndpoint.findMany.mockResolvedValue([{ id: "w", url: "https://h.example.com/p?k=secret", events: ["lead.created"], enabled: true, createdAt: new Date(), lastSuccessAt: null, lastFailureAt: null, failureCount: 2, business: { id: "b", name: "B", user: { id: "u", email: "e@x.com" } } }]);
    h.db.webhookDelivery.groupBy.mockResolvedValue([{ endpointId: "w", status: "success", _count: { _all: 9 } }, { endpointId: "w", status: "failed", _count: { _all: 1 } }]);
    h.db.webhookDelivery.findMany.mockResolvedValue([]);
    const p = await reads.listWebhookEndpoints({});
    expect(p.items[0]).toMatchObject({ host: "h.example.com", successRate7d: 90, failureStreak: 2 });
    expect(JSON.stringify(p)).not.toContain("secret");
    h.db.apiKey.findMany.mockResolvedValue([]);
    h.db.chatWidget.findMany.mockResolvedValue([]);
    h.db.storeConnection.findMany.mockResolvedValue([]);
    h.db.cloudflareConnection.findMany.mockResolvedValue([]);
    h.db.canvaConnection.findMany.mockResolvedValue([]);
    await Promise.all([reads.listApiKeys({}), reads.listWidgets({}), reads.listStoreConnections({}), reads.listCloudflareConnections({}), reads.listCanvaConnections({}), reads.listChannels({})]);
    const forbidden = /encrypted|hash|secret|webhookUrl/i;
    for (const [table, calls] of [["webhookEndpoint", h.db.webhookEndpoint.findMany.mock.calls], ["apiKey", h.db.apiKey.findMany.mock.calls], ["chatWidget", h.db.chatWidget.findMany.mock.calls], ["storeConnection", h.db.storeConnection.findMany.mock.calls], ["cloudflareConnection", h.db.cloudflareConnection.findMany.mock.calls], ["canvaConnection", h.db.canvaConnection.findMany.mock.calls]] as const) {
      expect(JSON.stringify(calls[0][0].select), table).not.toMatch(forbidden);
    }
    // Connection reads the token column only to learn whether one exists; the value never leaves the read function.
    expect(h.db.connection.findMany.mock.calls[0][0].select.refreshTokenEncrypted).toBeUndefined();
  });

  it("flags a chat traffic spike", () => {
    expect(reads.chatSpike({ c1: 40, c7: 46, c30: 100 })).toBe(true);
    expect(reads.chatSpike({ c1: 5, c7: 6, c30: 6 })).toBe(false);
    expect(reads.chatSpike({ c1: 40, c7: 400, c30: 400 })).toBe(false);
  });
});
