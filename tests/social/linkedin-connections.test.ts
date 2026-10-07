import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const state = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

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
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of state.rows.values()) {
          const hasScope = (row.scopes as string[]).includes(where.scopes.has);
          if (row.businessId === where.businessId && row.provider === where.provider && hasScope && !where.id.notIn.includes(row.id)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
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
