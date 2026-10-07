import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const state = vi.hoisted(() => ({ rows: new Map<string, Row>(), posts: [] as Record<string, unknown>[] }));
const provider = vi.hoisted(() => ({ refresh: vi.fn(), revoke: vi.fn() }));

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/social/registry", () => ({ getProvider: () => ({ refresh: provider.refresh, revoke: provider.revoke }) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no"); } }));
vi.mock("@/lib/db", () => {
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in (v as object) ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v));
  const prisma = {
    connection: {
      findUnique: vi.fn(async ({ where }) => (state.rows.get(where.id) ? { ...state.rows.get(where.id)! } : null)),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of state.rows.values()) if (match(row, where)) { Object.assign(row, data); count += 1; }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }) => { for (const row of [...state.rows.values()]) if (match(row, where)) state.rows.delete(row.id); }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = where.businessId_provider_externalAccountId;
        const existing = [...state.rows.values()].find((r) => r.businessId === key.businessId && r.provider === key.provider && r.externalAccountId === key.externalAccountId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `c${state.rows.size + 1}`, ...create };
        state.rows.set(row.id, row);
        return row;
      }),
    },
    post: {
      updateMany: vi.fn(async ({ where, data }) => {
        for (const p of state.posts) if (match(p as Row, where)) Object.assign(p, data);
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma };
});

import { decrypt, encrypt } from "@/lib/crypto";
import { deleteConnections, disconnect, loadCredentials, markConnectionError, saveConnections, saveReminderConnection } from "@/lib/social/connections";
import { SocialError } from "@/lib/social/types";

const MIN = 60_000;

async function seed(over: Record<string, unknown> = {}): Promise<Row> {
  const row: Row = {
    id: "c0", businessId: "biz1", kind: "SOCIAL", provider: "instagram", externalAccountId: "ig1", accountType: "business", postingMode: "AUTO", status: "ACTIVE",
    accessTokenEncrypted: await encrypt("old-token"), refreshTokenEncrypted: null, expiresAt: new Date(Date.now() + 30 * 24 * 60 * MIN), ...over,
  };
  state.rows.set(row.id, row);
  return row;
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  state.rows.clear();
  state.posts = [];
  provider.refresh.mockReset();
  provider.revoke.mockReset();
});

describe("saveConnections", () => {
  it("stores only the chosen accounts, tokens encrypted, per-account tokens first", async () => {
    const ids = await saveConnections(
      "biz1", "facebook",
      { accessToken: "user-token", scopes: ["pages_show_list"], accounts: [{ externalAccountId: "p1", displayName: "One", accountType: "page" }, { externalAccountId: "p2", displayName: "Two", accountType: "page" }], accountTokens: { p1: { accessToken: "page-token-1" }, p2: { accessToken: "page-token-2" } } },
      ["p2"], "AUTO",
    );
    expect(ids).toHaveLength(1);
    const row = state.rows.get(ids[0])!;
    expect(row.externalAccountId).toBe("p2");
    expect(row.accessTokenEncrypted).not.toContain("page-token-2");
    expect(await decrypt(row.accessTokenEncrypted as string)).toBe("page-token-2");
    expect(row.accountType).toBe("page");
  });

  it("reconnecting updates the same row and clears the error", async () => {
    const oauth = { accessToken: "t1", scopes: [], accounts: [{ externalAccountId: "ig1", displayName: "@a", accountType: "business" }] };
    const [first] = await saveConnections("biz1", "instagram", oauth, ["ig1"]);
    await markConnectionError(first, new SocialError("token revoked", "auth", "instagram"));
    const [second] = await saveConnections("biz1", "instagram", { ...oauth, accessToken: "t2" }, ["ig1"]);
    expect(second).toBe(first);
    expect(state.rows.get(first)!.status).toBe("ACTIVE");
    expect(state.rows.get(first)!.lastError).toBeNull();
  });

  it("saves a reminder connection without tokens", async () => {
    const id = await saveReminderConnection("biz1", "instagram", "@MyShop", "My Shop");
    expect(state.rows.get(id)).toMatchObject({ externalAccountId: "myshop", postingMode: "NOTIFY", accountType: "personal", accessTokenEncrypted: null });
  });
});

describe("loadCredentials", () => {
  it("returns the decrypted token without refreshing when it is not close to expiry", async () => {
    await seed();
    expect(await loadCredentials("c0")).toEqual({ connectionId: "c0", externalAccountId: "ig1", accountType: "business", accessToken: "old-token" });
    expect(provider.refresh).not.toHaveBeenCalled();
  });

  it("refreshes within ten minutes of expiry and stores the new tokens encrypted", async () => {
    await seed({ expiresAt: new Date(Date.now() + 5 * MIN) });
    const later = new Date(Date.now() + 60 * 24 * 60 * MIN);
    provider.refresh.mockResolvedValue({ accessToken: "new-token", expiresAt: later });
    expect((await loadCredentials("c0")).accessToken).toBe("new-token");
    const row = state.rows.get("c0")!;
    expect(await decrypt(row.accessTokenEncrypted as string)).toBe("new-token");
    expect(row.expiresAt).toEqual(later);
  });

  it("shares one refresh between simultaneous callers", async () => {
    await seed({ expiresAt: new Date(Date.now() + 5 * MIN) });
    provider.refresh.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return { accessToken: "new-token", expiresAt: new Date(Date.now() + 60 * 24 * 60 * MIN) }; });
    const tokens = await Promise.all([loadCredentials("c0"), loadCredentials("c0"), loadCredentials("c0")]);
    expect(provider.refresh).toHaveBeenCalledTimes(1);
    expect(tokens.map((t) => t.accessToken)).toEqual(["new-token", "new-token", "new-token"]);
  });

  it("uses the winner's tokens when another process already refreshed (single-use refresh token spent)", async () => {
    const row = await seed({ expiresAt: new Date(Date.now() + 5 * MIN) });
    provider.refresh.mockImplementation(async () => {
      // Another worker stores fresh tokens while this refresh is in flight, then this one is rejected.
      Object.assign(state.rows.get("c0")!, { accessTokenEncrypted: await encrypt("winner-token"), expiresAt: new Date(Date.now() + 60 * 24 * 60 * MIN) });
      throw new SocialError("invalid_grant", "auth", "instagram");
    });
    expect((await loadCredentials("c0")).accessToken).toBe("winner-token");
    expect(state.rows.get("c0")!.status).toBe("ACTIVE");
    expect(row.status).toBe("ACTIVE");
  });

  it("does not overwrite a newer token when the compare-and-swap loses", async () => {
    await seed({ expiresAt: new Date(Date.now() + 5 * MIN) });
    provider.refresh.mockImplementation(async () => {
      Object.assign(state.rows.get("c0")!, { accessTokenEncrypted: await encrypt("winner-token"), expiresAt: new Date(Date.now() + 60 * 24 * 60 * MIN) });
      return { accessToken: "loser-token", expiresAt: new Date(Date.now() + 60 * 24 * 60 * MIN) };
    });
    expect((await loadCredentials("c0")).accessToken).toBe("winner-token");
    expect(await decrypt(state.rows.get("c0")!.accessTokenEncrypted as string)).toBe("winner-token");
  });

  it("marks the connection EXPIRED and throws when the grant is dead", async () => {
    await seed({ expiresAt: new Date(Date.now() + 5 * MIN), refreshTokenEncrypted: await encrypt("refresh") });
    provider.refresh.mockRejectedValue(new SocialError("Session has expired", "auth", "instagram"));
    await expect(loadCredentials("c0")).rejects.toMatchObject({ kind: "auth" });
    expect(state.rows.get("c0")).toMatchObject({ status: "EXPIRED", lastError: "Session has expired" });
    await expect(loadCredentials("c0")).rejects.toMatchObject({ kind: "auth" });
    expect(provider.refresh).toHaveBeenCalledTimes(1);
  });

  it("without a refresh token, an auth failure only marks EXPIRING while the token is still valid", async () => {
    await seed({ expiresAt: new Date(Date.now() + 5 * MIN), refreshTokenEncrypted: null });
    provider.refresh.mockRejectedValue(new SocialError("no refresh token", "auth", "instagram"));
    expect((await loadCredentials("c0")).accessToken).toBe("old-token");
    expect(state.rows.get("c0")!.status).toBe("EXPIRING");
    state.rows.get("c0")!.expiresAt = new Date(Date.now() - MIN);
    state.rows.get("c0")!.status = "ACTIVE";
    await expect(loadCredentials("c0")).rejects.toMatchObject({ kind: "auth" });
    expect(state.rows.get("c0")!.status).toBe("EXPIRED");
  });

  it("keeps using a still-valid token when the refresh endpoint is temporarily down", async () => {
    await seed({ expiresAt: new Date(Date.now() + 5 * MIN) });
    provider.refresh.mockRejectedValue(new SocialError("down", "temporary", "instagram"));
    expect((await loadCredentials("c0")).accessToken).toBe("old-token");
    expect(state.rows.get("c0")!.status).toBe("ACTIVE");
  });

  it("refuses reminder-only connections", async () => {
    await seed({ postingMode: "NOTIFY", accessTokenEncrypted: null });
    await expect(loadCredentials("c0")).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("markConnectionError", () => {
  it("only records non-auth errors, without expiring the connection", async () => {
    await seed();
    await markConnectionError("c0", new SocialError("try later", "rate_limit", "instagram"));
    expect(state.rows.get("c0")).toMatchObject({ status: "ACTIVE", lastError: "try later" });
  });
});

describe("disconnect", () => {
  it("deletes the row, revokes best-effort and returns scheduled posts to drafts", async () => {
    await seed();
    state.posts = [{ id: "p1", connectionId: "c0", status: "SCHEDULED" }, { id: "p2", connectionId: "c0", status: "PUBLISHED" }, { id: "p3", connectionId: "other", status: "SCHEDULED" }, { id: "p4", connectionId: "c0", status: "PENDING_APPROVAL" }, { id: "p5", connectionId: "c0", status: "NEEDS_ACTION" }];
    provider.revoke.mockRejectedValue(new Error("network down"));
    expect(await disconnect("c0", { businessId: "biz1" })).toBe(true);
    expect(provider.revoke).toHaveBeenCalledOnce();
    expect(state.rows.has("c0")).toBe(false);
    expect(state.posts).toEqual([
      { id: "p1", connectionId: null, status: "DRAFT" },
      { id: "p2", connectionId: null, status: "PUBLISHED" },
      { id: "p3", connectionId: "other", status: "SCHEDULED" },
      { id: "p4", connectionId: null, status: "DRAFT" },
      { id: "p5", connectionId: null, status: "DRAFT" },
    ]);
  });

  it("refuses another business's connection (IDOR)", async () => {
    await seed();
    expect(await disconnect("c0", { businessId: "someone-elses" })).toBe(false);
    expect(state.rows.has("c0")).toBe(true);
    expect(provider.revoke).not.toHaveBeenCalled();
  });

  it("returns false for unknown ids and does nothing for an empty delete", async () => {
    expect(await disconnect("nope", { businessId: "biz1" })).toBe(false);
    await deleteConnections([]);
  });
});
