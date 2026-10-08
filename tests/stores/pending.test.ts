import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conn: null as null | { id: string; storeUrl: string },
  pending: null as null | { id: string; businessId: string; provider: string; storeUrl: string; credentialsEncrypted: string; currency: string | null; expiresAt: Date },
  deletedMappings: [] as string[],
  upserts: [] as Record<string, unknown>[],
}));
const mocks = vi.hoisted(() => ({ requireActiveUser: vi.fn(), rateLimit: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { storeConnect: {}, storeImport: {} }, rateLimit: mocks.rateLimit, RateLimitError: class extends Error {}, rateLimitMessage: () => "slow down" }));
vi.mock("@/lib/db", () => ({
  prisma: {
    business: { findUnique: async () => ({ id: "biz1" }) },
    storeConnection: {
      findUnique: async () => db.conn,
      upsert: async (args: Record<string, unknown>) => void db.upserts.push(args),
    },
    productSync: { deleteMany: async ({ where }: { where: { connectionId: string } }) => void db.deletedMappings.push(where.connectionId) },
    storeConnectionPending: {
      findUnique: async () => db.pending,
      upsert: async ({ create }: { create: never }) => (db.pending = { id: "pend1", ...(create as object) } as never),
      deleteMany: async () => void (db.pending = null),
    },
  },
}));

import { cancelPending, confirmPending, savePending } from "@/lib/stores/connection";
import { startWooConnectAction } from "@/app/dashboard/stores/actions";
import { decrypt } from "@/lib/crypto";

const KEYS = `ck_${"a".repeat(30)}:cs_${"b".repeat(30)}`;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.bupulse.test";
  db.conn = { id: "c1", storeUrl: "https://old-store.com" };
  db.pending = null;
  db.deletedMappings = [];
  db.upserts = [];
  vi.clearAllMocks();
  mocks.requireActiveUser.mockResolvedValue({ id: "u1" });
});

function formOf(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const call = (values: Record<string, string>) => startWooConnectAction(formOf(values)).then(() => "no redirect", (e: Error) => e.message);

describe("WooCommerce connect cannot be started or completed by a third party", () => {
  it("no GET route starts the flow any more (it is a server action: POST with Next's origin check)", () => {
    expect(existsSync("app/api/stores/woocommerce/connect")).toBe(false);
  });

  it("the start action sends the owner to the wc-auth page of the store they typed, with a sealed state", async () => {
    const result = await call({ store: "https://store.com" });
    expect(result).toMatch(/^REDIRECT:https:\/\/store\.com\/wc-auth\/v1\/authorize\?/);
    const state = new URL(result.slice("REDIRECT:".length)).searchParams.get("user_id")!;
    expect(JSON.parse(await decrypt(state))).toMatchObject({ userId: "u1", businessId: "biz1", storeUrl: "https://store.com" });
  });

  it("refuses private stores and a plain-http BuPulse", async () => {
    expect(await call({ store: "https://192.168.0.5" })).toContain("error=invalid_store");
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(await call({ store: "https://store.com" })).toContain("error=needs_https");
  });
});

describe("pending connections", () => {
  it("keys sit in a pending row, encrypted, and do not change the active connection", async () => {
    await savePending({ businessId: "biz1", provider: "woocommerce", storeUrl: "https://evil-store.com", secret: KEYS, currency: "USD" });
    expect(db.pending!.credentialsEncrypted).not.toContain("ck_");
    expect(db.upserts).toEqual([]);
    expect(db.deletedMappings).toEqual([]);
  });

  it("only the confirmed pending row (right id, unexpired) becomes the connection", async () => {
    const now = 1_000_000;
    await savePending({ businessId: "biz1", provider: "woocommerce", storeUrl: "https://old-store.com", secret: KEYS }, now);
    expect(await confirmPending("biz1", "woocommerce", "wrong-id", now + 1000)).toBe(false);
    expect(await confirmPending("biz1", "woocommerce", "pend1", now + 31 * 60_000)).toBe(false);
    expect(db.upserts).toEqual([]);
    expect(await confirmPending("biz1", "woocommerce", "pend1", now + 1000)).toBe(true);
    expect(db.upserts).toHaveLength(1);
    expect(db.pending).toBeNull();
  });

  it("product mappings survive confirming the same store and are dropped only when the store host changes", async () => {
    await savePending({ businessId: "biz1", provider: "woocommerce", storeUrl: "https://old-store.com", secret: KEYS });
    await confirmPending("biz1", "woocommerce", "pend1");
    expect(db.deletedMappings).toEqual([]);
    await savePending({ businessId: "biz1", provider: "woocommerce", storeUrl: "https://other-store.com", secret: KEYS });
    await confirmPending("biz1", "woocommerce", "pend1");
    expect(db.deletedMappings).toEqual(["c1"]);
  });

  it("cancel discards the pending keys", async () => {
    await savePending({ businessId: "biz1", provider: "woocommerce", storeUrl: "https://x-store.com", secret: KEYS });
    await cancelPending("biz1", "woocommerce");
    expect(db.pending).toBeNull();
  });
});
