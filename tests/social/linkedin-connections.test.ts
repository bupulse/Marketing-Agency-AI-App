import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const state = vi.hoisted(() => ({ rows: new Map<string, Row>() }));
type LinkedInWhere = { businessId: string; provider: string; scopes: { has: string }; id: { notIn: string[] } };
const linkedinMatch = vi.hoisted(() => (row: Record<string, unknown>, where: LinkedInWhere) =>
  row.businessId === where.businessId && row.provider === where.provider && (row.scopes as string[]).includes(where.scopes.has) && !where.id.notIn.includes(row.id as string));

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/social/registry", () => ({ getProvider: () => ({}) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no"); } }));
vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = where.businessId_provider_externalAccountId;
        const existing = [...state.rows.values()].find((r) => r.businessId === key.businessId && r.provider === key.provider && r.externalAccountId === key.externalAccountId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `c${state.rows.size + 1}`, ...create };
        state.rows.set(row.id, row);
        return row;
      }),
      // BuPulse-Socials asks which Composio sign-ins it replaces (none in these tests); the rest is the shared LinkedIn token.
      findMany: vi.fn(async ({ where }) => (where.method === "COMPOSIO" ? [] : [...state.rows.values()].filter((row) => linkedinMatch(row, where)).map((row) => ({ id: row.id })))),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of state.rows.values()) {
          if (linkedinMatch(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    // restoreQueuedPosts (runs after every reconnect): there are no posts in these tests.
    post: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

import { decrypt } from "@/lib/crypto";
import { saveConnections } from "@/lib/social/connections";

const scopes = ["openid", "profile", "w_member_social", "w_organization_social", "li_member:p1"];
const member = { accessToken: "T1", scopes, accounts: [{ externalAccountId: "p1", displayName: "Jane", accountType: "member" }] };
const org = { accessToken: "T2", scopes, accounts: [{ externalAccountId: "11", displayName: "Acme", accountType: "organization" }] };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  state.rows.clear();
});

describe("connecting both LinkedIn variants", () => {
  it("gives the profile the newer token when the Page is connected afterwards", async () => {
    const [memberId] = await saveConnections("biz1", "linkedin", member, ["p1"]);
    const [orgId] = await saveConnections("biz1", "linkedin", org, ["11"]);
    expect(await decrypt(state.rows.get(memberId)!.accessTokenEncrypted as string)).toBe("T2");
    expect(await decrypt(state.rows.get(orgId)!.accessTokenEncrypted as string)).toBe("T2");
  });

  it("leaves other members and other businesses alone", async () => {
    const [other] = await saveConnections("biz1", "linkedin", { ...member, accessToken: "X", scopes: ["li_member:p9"], accounts: [{ externalAccountId: "p9", displayName: "Bob", accountType: "member" }] }, ["p9"]);
    const [elsewhere] = await saveConnections("biz2", "linkedin", member, ["p1"]);
    await saveConnections("biz1", "linkedin", org, ["11"]);
    expect(await decrypt(state.rows.get(other)!.accessTokenEncrypted as string)).toBe("X");
    expect(await decrypt(state.rows.get(elsewhere)!.accessTokenEncrypted as string)).toBe("T1");
  });
});

describe("saving the picked LinkedIn accounts", () => {
  // Placeholder names: one sign-in that found the profile and two Pages.
  const signIn = {
    accessToken: "ca_9",
    scopes: ["composio", "composio_account:ca_9"],
    accounts: [
      { externalAccountId: "p1", displayName: "Placeholder Person", accountType: "member" },
      { externalAccountId: "11", displayName: "Sample Bakery", avatarUrl: "https://media.licdn.com/placeholder/11.png", accountType: "organization" },
      { externalAccountId: "12", displayName: "Sample Shop", accountType: "organization" },
    ],
  };

  it("makes one connection per account ticked, and none for the rest", async () => {
    const ids = await saveConnections("biz1", "linkedin", signIn, ["11", "p1"]);
    expect(ids).toHaveLength(2);
    const rows = ids.map((id) => state.rows.get(id)!);
    expect(rows.map((r) => [r.externalAccountId, r.accountType, r.displayName, r.method])).toEqual([
      ["p1", "member", "Placeholder Person", "COMPOSIO"],
      ["11", "organization", "Sample Bakery", "COMPOSIO"],
    ]);
    expect(rows[1].avatarUrl).toBe("https://media.licdn.com/placeholder/11.png");
    expect([...state.rows.values()].some((r) => r.externalAccountId === "12")).toBe(false);
  });

  it("saves a Page on its own when only the Page is ticked", async () => {
    const ids = await saveConnections("biz1", "linkedin", signIn, ["12"]);
    expect(ids.map((id) => state.rows.get(id)!.accountType)).toEqual(["organization"]);
  });
});
