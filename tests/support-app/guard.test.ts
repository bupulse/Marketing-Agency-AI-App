import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at: string | null },
  agent: null as null | Record<string, unknown>,
  aal: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: 0 }] } as Record<string, unknown>,
  totp: [{ id: "f1", status: "verified" }] as { id: string; status: string }[],
  host: "support.bupulse.com",
  updateMany: vi.fn(async () => ({ count: 1 })),
}));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); }, notFound: () => { throw new Error("notfound"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: m.host }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: m.user }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: m.aal }), listFactors: async () => ({ data: { totp: m.totp } }) },
    },
  }),
}));
vi.mock("@/lib/db", () => ({ prisma: { supportAgent: { findFirst: async () => m.agent, updateMany: m.updateMany } } }));

import { agentAccess, agentIdentity, hasRecentMailboxProof } from "@/lib/support/app-access";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { previewAllowed } from "@/lib/support/preview";

const agentRow = (over: Record<string, unknown> = {}) => ({ id: "ag1", email: "jean@example.com", name: "Jean M.", userId: "u1", status: "active", role: "AGENT", availability: "online", lastSeenAt: new Date(), departments: [{ department: { key: "billing" } }], ...over });

async function gate(): Promise<string> {
  try {
    await requireSupportAgentPage();
    return "ok";
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
}

beforeEach(() => {
  m.user = { id: "u1", email: "jean@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
  m.agent = agentRow();
  m.aal = { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: 0 }] };
  m.totp = [{ id: "f1", status: "verified" }];
  m.host = "support.bupulse.com";
  m.updateMany.mockClear();
});

describe("support app page guard", () => {
  it("lets in an active agent at AAL2 with an authenticator app", async () => {
    await expect(requireSupportAgentPage()).resolves.toMatchObject({ id: "ag1", role: "AGENT", availability: "online", departments: ["billing"] });
  });
  it("sends a signed-out person to sign in (clean path on the support host, /support elsewhere)", async () => {
    m.user = null;
    expect(await gate()).toBe("/sign-in");
    m.host = "test.bupulse.com";
    expect(await gate()).toBe("/support/sign-in");
  });
  it("refuses a locked agent", async () => {
    m.agent = agentRow({ status: "locked" });
    expect(await gate()).toBe("/sign-in?error=locked");
  });
  it("refuses someone who is not an agent, or a row linked to another sign-in", async () => {
    m.agent = null;
    expect(await gate()).toBe("/sign-in?error=no_access");
    m.agent = agentRow({ userId: "someone-else" });
    expect(await gate()).toBe("/sign-in?error=no_access");
  });
  it("refuses an unconfirmed address and a Google-only session", async () => {
    m.user = { id: "u1", email: "jean@example.com", email_confirmed_at: null };
    expect(await gate()).toBe("/sign-in?error=no_access");
    m.user = { id: "u1", email: "jean@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
    m.aal = { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [{ method: "oauth", timestamp: 0 }] };
    expect(await gate()).toBe("/sign-in?error=no_access");
  });
  it("at AAL1 asks for the code, or for an authenticator app first", async () => {
    m.aal = { currentLevel: "aal1", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: 0 }] };
    expect(await gate()).toBe("/verify");
    m.aal = { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [{ method: "password", timestamp: 0 }] };
    m.totp = [];
    expect(await gate()).toBe("/setup");
  });
  it("does not trust AAL2 without a verified authenticator app", async () => {
    m.totp = [{ id: "f2", status: "unverified" }];
    expect(await gate()).toBe("/setup");
  });
  it("the first full sign-in links the sign-in to the invited row and makes it active", async () => {
    m.agent = agentRow({ status: "invited", userId: null });
    expect(await gate()).toBe("ok");
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: "ag1", status: { not: "locked" } }, data: expect.objectContaining({ userId: "u1", status: "active" }) });
  });
  it("the pure rules match the page (shared with the API guard)", () => {
    const base = { user: { id: "u1", email: "Jean@Example.com", emailConfirmed: true }, agent: { id: "a", email: "jean@example.com", userId: "u1", status: "active" }, methods: [{ method: "password" }], aal: { currentLevel: "aal2", nextLevel: "aal2" }, hasVerifiedTotp: true };
    expect(agentAccess(base)).toEqual({ ok: true, agent: base.agent, activate: false });
    expect(agentAccess({ ...base, agent: { ...base.agent, status: "locked" } })).toEqual({ ok: false, to: "sign-in", note: "locked" });
    expect(agentIdentity({ ...base, agent: { ...base.agent, email: "other@example.com" } })).toEqual({ ok: false, note: "no_access" });
  });
  it("adding an authenticator or a password needs an emailed link or code from the last 10 minutes", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    const at = (minAgo: number) => (now - minAgo * 60_000) / 1000;
    expect(hasRecentMailboxProof([{ method: "invite", timestamp: at(2) }], now)).toBe(true);
    expect(hasRecentMailboxProof([{ method: "recovery", timestamp: at(9) }], now)).toBe(true);
    expect(hasRecentMailboxProof([{ method: "otp", timestamp: at(11) }], now)).toBe(false);
    expect(hasRecentMailboxProof([{ method: "password", timestamp: at(1) }], now)).toBe(false);
  });
});

describe("dev-only preview", () => {
  it("is off in production", () => {
    expect(previewAllowed("production")).toBe(false);
    expect(previewAllowed("development")).toBe(true);
    expect(previewAllowed("test")).toBe(true);
  });
});
