import { beforeEach, describe, expect, it, vi } from "vitest";

// Every database call Client 360 makes is recorded, so the test can check what each one is scoped to.
type Call = { model: string; method: string; args: Record<string, unknown> };
const calls: Call[] = [];
const state = { unknownUser: false, withChildren: false };
const A = "0e2a8f55-1c57-4c5e-9b4a-7a0d2c0d6f11";
const B = "9d1f0c33-2b8e-4a35-8f0a-5a8a3a3c2b77";

const empty: Record<string, unknown> = { findMany: [], groupBy: [], count: 0, findFirst: null, findUnique: null, aggregate: { _count: { _all: 0 }, _sum: { costUsd: null } } };
vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, {
    get: (_t, model: string) =>
      new Proxy({}, {
        get: (_u, method: string) => async (args: Record<string, unknown> = {}) => {
          calls.push({ model, method, args });
          if (model === "user" && method === "findUnique") {
            if (state.unknownUser) return null;
            return { id: (args.where as { id: string }).id, email: "a@example.com", name: null, createdAt: new Date(), suspendedAt: null, suspendedReason: null, deletionScheduledFor: null, subscription: { plan: "STANDARD", status: "ACTIVE", provider: "PADDLE", interval: "MONTH", trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false }, business: { id: "bizA", name: "A Shop", industry: null, country: null, website: null, onboardedAt: new Date(), createdAt: new Date() } };
          }
          if (state.withChildren && method === "findMany") {
            if (model === "connection") return [{ id: "c1", kind: "SOCIAL", provider: "instagram", displayName: "A", status: "ERROR", postingMode: "AUTO", expiresAt: null, lastError: "boom sk-abcdefghijklmnopqrstuvwxyz123456", lastCheckedAt: null }];
            if (model === "webhookEndpoint") return [{ id: "w1" }];
            if (model === "apiKey") return [{ id: "k1" }];
            if (model === "storeConnection") return [{ id: "s1" }];
          }
          if (state.withChildren && method === "findUnique") {
            if (model === "cloudflareConnection") return { businessId: "bizA" };
            if (model === "canvaConnection") return { id: "cv1" };
          }
          return empty[method] ?? null;
        },
      }),
  }),
}));
vi.mock("@/lib/admin/plan-limits", () => ({ getPlanLimits: async () => ({ text: 10, image: 5, videoSeconds: 0, voiceCharacters: 0, chat: 20 }), USAGE_METRICS: ["text", "image", "videoSeconds", "voiceCharacters", "chat"] }));
vi.mock("@/lib/admin/connections", () => ({ getClientConnections: async (businessId: string) => { calls.push({ model: "connections", method: "getClientConnections", args: { where: { businessId } } }); return { stores: 0, cloudflare: 0, importedFiles: 0 }; } }));

const { getClient360, loadClient } = await import("@/lib/admin/client360");

beforeEach(() => { calls.length = 0; state.unknownUser = false; state.withChildren = false; });

describe("Client 360 scoping", () => {
  it("scopes every read to this client's user id or business id", async () => {
    const data = await getClient360(A);
    expect(data.overview.user.id).toBe(A);
    const reads = calls.filter((c) => !(c.model === "user" && c.method === "findUnique"));
    expect(reads.length).toBeGreaterThan(10);
    for (const c of reads) {
      const where = JSON.stringify(c.args.where ?? {});
      // Pageviews are looked up by the visit session of this client's sign-up event, which was itself scoped to the user.
      // planDefinition is the shared price list, not client data.
      const scoped = where.includes(A) || where.includes("bizA") || c.model === "pageView" || c.model === "planDefinition";
      expect(scoped, `${c.model}.${c.method} where ${where}`).toBe(true);
      expect(where).not.toContain(B);
    }
  });

  it("derives the business from the user, never from a caller-supplied id", async () => {
    await getClient360(A);
    const userLookup = calls.find((c) => c.model === "user" && c.method === "findUnique")!;
    expect(userLookup.args.where).toEqual({ id: A });
    expect(calls.some((c) => JSON.stringify(c.args.where ?? {}).includes("bizA"))).toBe(true);
  });

  it("notes are read only for this user", async () => {
    await getClient360(A);
    const notes = calls.find((c) => c.model === "adminNote")!;
    expect(notes.args.where).toEqual({ userId: A });
  });

  it("refuses an unknown user", async () => {
    state.unknownUser = true;
    await expect(loadClient(B)).rejects.toMatchObject({ code: "not_found" });
    state.unknownUser = false;
  });

  it("the audit tab includes actions on this client's channels, connectors, webhooks, keys and widget", async () => {
    state.withChildren = true;
    const { getClient360 } = await import("@/lib/admin/client360");
    const data = await getClient360(A);
    const audit = calls.find((c) => c.model === "auditLog")!;
    const targets = (audit.args.where as { target: { in: string[] } }).target.in;
    expect(targets).toEqual(expect.arrayContaining([`user:${A}`, "business:bizA", "widget:bizA", "connection:c1", "webhook:w1", "api_key:k1", "store:s1", "cloudflare:bizA", "canva:cv1"]));
    expect(targets.some((t) => t.includes(B))).toBe(false);
    // text that can carry a secret is scrubbed before it is shown or sent out
    expect(JSON.stringify(data.channels.connections)).not.toContain("sk-abcdefghijklmnop");
  });
});
