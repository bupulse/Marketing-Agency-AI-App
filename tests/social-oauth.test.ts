import { beforeEach, describe, expect, it } from "vitest";
import { openPending, openState, sealPending, sealState } from "@/lib/social/oauth";
import type { OAuthResult } from "@/lib/social/types";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
});

const base = { state: "s", verifier: "v".repeat(43), userId: USER, network: "instagram" as const, variant: "instagram", next: "/dashboard/connections" };

describe("sealed connect state", () => {
  it("round-trips for the same user and network", async () => {
    const result = await openState(await sealState(base), USER, "instagram");
    expect(result).toMatchObject({ ok: true, data: { state: "s", variant: "instagram", next: "/dashboard/connections" } });
  });

  it("rejects another user, another network and forged cookies", async () => {
    const sealed = await sealState(base);
    expect(await openState(sealed, OTHER, "instagram")).toEqual({ ok: false, reason: "invalid" });
    expect(await openState(sealed, USER, "facebook")).toEqual({ ok: false, reason: "invalid" });
    expect(await openState("v1:1:AAAA:BBBB", USER, "instagram")).toEqual({ ok: false, reason: "invalid" });
    expect(await openState(undefined, USER, "instagram")).toEqual({ ok: false, reason: "missing" });
  });

  it("expires after ten minutes", async () => {
    const sealed = await sealState(base, 1_000_000);
    expect((await openState(sealed, USER, "instagram", 1_000_000 + 9 * 60_000)).ok).toBe(true);
    expect(await openState(sealed, USER, "instagram", 1_000_000 + 11 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });
});

function result(pages: number): OAuthResult {
  const accounts = Array.from({ length: pages }, (_, i) => ({ externalAccountId: `page${i}`, displayName: `Page number ${i}`, avatarUrl: `https://scontent.example.com/${"a".repeat(180)}/${i}.jpg`, accountType: "page" }));
  const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(36)).join("").slice(0, n);
  return {
    accessToken: rand(200),
    scopes: ["pages_show_list"],
    accounts,
    accountTokens: Object.fromEntries(accounts.map((a) => [a.externalAccountId, { accessToken: rand(210) }])),
  };
}

describe("pending accounts cookie", () => {
  it("round-trips accounts and per-account tokens, split into small cookies", async () => {
    const original = result(6);
    const cookies = await sealPending(USER, "facebook", undefined, original);
    for (const value of Object.values(cookies)) expect(value.length).toBeLessThanOrEqual(3400);
    const opened = await openPending((name) => cookies[name], USER);
    expect(opened?.network).toBe("facebook");
    expect(opened?.result.accounts).toHaveLength(6);
    expect(opened?.result.accountTokens?.page3.accessToken).toBe(original.accountTokens!.page3.accessToken);
  });

  it("drops avatars and then accounts to stay within the cookie budget", async () => {
    const cookies = await sealPending(USER, "facebook", undefined, result(60));
    const opened = await openPending((name) => cookies[name], USER);
    expect(opened!.result.accounts.length).toBeGreaterThan(5);
    expect(opened!.result.accounts.length).toBeLessThan(60);
    for (const a of opened!.result.accounts) expect(opened!.result.accountTokens![a.externalAccountId]).toBeTruthy();
  });

  it("is not readable by another user or after it expires", async () => {
    const cookies = await sealPending(USER, "facebook", undefined, result(2), 1_000_000);
    expect(await openPending((n) => cookies[n], OTHER, 1_000_000)).toBeNull();
    expect(await openPending((n) => cookies[n], USER, 1_000_000 + 11 * 60_000)).toBeNull();
    expect(await openPending(() => undefined, USER)).toBeNull();
  });
});
