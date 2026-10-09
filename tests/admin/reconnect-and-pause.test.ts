/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const s = vi.hoisted(() => ({ posts: [] as Row[], conns: [] as Row[], hooks: [] as Row[], deliveries: [] as Row[] }));

// Just enough of Prisma for these filters: equality, in, startsWith, lte.
const ok = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([k, c]) => {
    const v = row[k] ?? null;
    if (c && typeof c === "object" && !(c instanceof Date)) {
      if ("in" in c) return c.in.includes(v);
      if ("startsWith" in c) return typeof v === "string" && v.startsWith(c.startsWith);
      if ("lte" in c) return v !== null && v <= c.lte;
      return true;
    }
    return v === c;
  });

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/social/registry", () => ({ getProvider: () => ({}) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no"); } }));
vi.mock("@/lib/db", () => {
  const prisma: any = {
    connection: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const k = where.businessId_provider_externalAccountId;
        const hit = s.conns.find((c) => c.businessId === k.businessId && c.externalAccountId === k.externalAccountId);
        if (hit) return Object.assign(hit, update);
        const row = { id: `c${s.conns.length + 1}`, ...create };
        s.conns.push(row);
        return row;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    post: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = s.posts.filter((p) => ok(p, where));
        hit.forEach((p) => Object.assign(p, data));
        return { count: hit.length };
      }),
    },
    webhookEndpoint: {
      findFirst: vi.fn(async ({ where }: any) => s.hooks.find((h) => ok(h, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = s.hooks.filter((h) => ok(h, where));
        hit.forEach((h) => Object.assign(h, data));
        return { count: hit.length };
      }),
    },
    webhookDelivery: { findFirst: vi.fn(async () => s.deliveries[0] ?? null) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma };
});

import { PICK_NEW_TIME, NEEDS_RECONNECT_PREFIX, saveConnections } from "@/lib/social/connections";
import { PAUSED_BY_SUPPORT, retryDelivery, setEndpointEnabled, updateEndpoint } from "@/lib/webhooks/endpoints";

const NOTE = `${NEEDS_RECONNECT_PREFIX} Disconnected by BuPulse support. Reconnect this account to publish.`;
const HOUR = 3_600_000;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  s.posts = [];
  s.conns = [{ id: "c1", businessId: "biz1", provider: "instagram", externalAccountId: "ig1", status: "REVOKED", accessTokenEncrypted: null }];
  s.hooks = [];
  s.deliveries = [];
});

describe("reconnecting clears the needs-reconnect state", () => {
  it("future posts lose the note, past-due ones need a new time, other posts are untouched", async () => {
    const future = new Date(Date.now() + HOUR);
    const past = new Date(Date.now() - HOUR);
    s.posts = [
      { id: "future", connectionId: "c1", status: "SCHEDULED", scheduledAt: future, lastError: NOTE },
      { id: "past", connectionId: "c1", status: "SCHEDULED", scheduledAt: past, lastError: NOTE },
      { id: "approval", connectionId: "c1", status: "PENDING_APPROVAL", scheduledAt: past, lastError: NOTE },
      { id: "other-error", connectionId: "c1", status: "SCHEDULED", scheduledAt: future, lastError: "Rate limited" },
      { id: "other-account", connectionId: "c2", status: "SCHEDULED", scheduledAt: past, lastError: NOTE },
      { id: "published", connectionId: "c1", status: "PUBLISHED", scheduledAt: past, lastError: null },
    ];
    const oauth = { accessToken: "t", scopes: [], accounts: [{ externalAccountId: "ig1", displayName: "@a", accountType: "business" }] };
    await saveConnections("biz1", "instagram", oauth, ["ig1"]);
    const get = (id: string) => s.posts.find((p) => p.id === id)!;
    expect(get("future")).toMatchObject({ status: "SCHEDULED", lastError: null, scheduledAt: future });
    expect(get("past")).toMatchObject({ status: "NEEDS_ACTION", lastError: PICK_NEW_TIME });
    expect(get("approval")).toMatchObject({ status: "PENDING_APPROVAL", lastError: null });
    expect(get("other-error")).toMatchObject({ status: "SCHEDULED", lastError: "Rate limited" });
    expect(get("other-account")).toMatchObject({ status: "SCHEDULED", lastError: NOTE });
    expect(get("published")).toMatchObject({ status: "PUBLISHED" });
    expect(s.posts).toHaveLength(6);
  });
});

describe("a webhook paused by support", () => {
  beforeEach(() => {
    s.hooks = [{ id: "w1", businessId: "b1", enabled: true, pausedByAdminAt: new Date(), pausedByAdminReason: "abuse" }];
  });

  it("cannot be turned back on by the owner", async () => {
    await expect(setEndpointEnabled("b1", "w1", true)).rejects.toThrow(PAUSED_BY_SUPPORT);
    await expect(updateEndpoint("b1", "w1", { url: "https://hooks.zapier.com/x", events: ["lead.created"], enabled: true })).rejects.toThrow(PAUSED_BY_SUPPORT);
    expect(s.hooks[0].pausedByAdminAt).toBeInstanceOf(Date);
  });

  it("may still be switched off by the owner, and an unpaused one switches on as before", async () => {
    await setEndpointEnabled("b1", "w1", false);
    expect(s.hooks[0].enabled).toBe(false);
    s.hooks[0].pausedByAdminAt = null;
    await setEndpointEnabled("b1", "w1", true);
    expect(s.hooks[0].enabled).toBe(true);
  });

  it("cannot retry a delivery", async () => {
    s.deliveries = [{ id: "d1", status: "failed", endpoint: s.hooks[0] }];
    await expect(retryDelivery("b1", "d1")).rejects.toThrow(PAUSED_BY_SUPPORT);
  });
});
