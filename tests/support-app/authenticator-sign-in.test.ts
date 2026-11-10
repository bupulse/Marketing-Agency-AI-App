import { beforeEach, describe, expect, it, vi } from "vitest";

// support.bupulse.com sign-in while the emailed code is off: work email + authenticator code (app/support/(auth)/actions.ts).
const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  ensureOwnerAgent: vi.fn(async () => {}),
  agentFor: vi.fn(),
  findUnique: vi.fn(async (): Promise<{ status: string } | null> => null),
  rateLimit: vi.fn(async () => {}),
  padTo: vi.fn(async (...args: [number, number]) => void args),
  publicLimited: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect:${url}`), { url });
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/auth/authenticator-sign-in", () => ({ signInWithAuthenticatorCode: h.signIn }));
vi.mock("@/lib/admin/service-keys", () => ({ loadServiceKeys: async () => {} }));
vi.mock("@/lib/request-limits", () => ({ publicLimited: h.publicLimited, padTo: h.padTo, requestIp: async () => "1.2.3.4" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit, RateLimitError: class extends Error {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {} }) }));
vi.mock("@/lib/support/agents", () => ({ requestToJoin: vi.fn(), sendAgentPasswordReset: vi.fn() }));
vi.mock("@/lib/widget/turnstile", () => ({ turnstileEnabled: () => false, verifyTurnstile: vi.fn() }));
vi.mock("@/lib/support/app-auth", () => ({ agentFor: h.agentFor, requireAgentIdentity: vi.fn(), supportUrl: async (p: string) => p }));
vi.mock("@/lib/support/owner", () => ({ ensureOwnerAgent: h.ensureOwnerAgent, isSupportOwnerEmail: (e: string) => e === "admin@bupulse.com" }));
vi.mock("@/lib/db", () => ({ prisma: { supportAgent: { findUnique: h.findUnique }, staffMember: { findUnique: vi.fn(async () => null) } } }));

import { signInWithAuthenticator } from "@/app/support/(auth)/actions";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const ownerUser = { id: "owner-id", email: "admin@bupulse.com", email_confirmed_at: "2026-01-01" };
const ownerRow = { id: "a1", email: "admin@bupulse.com", userId: "owner-id", status: "active" };

beforeEach(() => {
  vi.stubEnv("ADMIN_LOGIN_EMAIL_CODE", "");
  for (const f of Object.values(h)) f.mockClear();
  h.findUnique.mockReset().mockResolvedValue(null);
  h.agentFor.mockReset().mockResolvedValue(ownerRow);
  h.signIn.mockReset().mockImplementation(async (opts: { allow: (u: typeof ownerUser) => Promise<true | string> }) => {
    const allowed = await opts.allow(ownerUser);
    return allowed === true ? { ok: true, user: ownerUser } : { ok: false, error: allowed };
  });
});

describe("support sign-in with the authenticator code only", () => {
  it("signs admin@bupulse.com in with email + code and opens the app; the owner row is made only after the code is right", async () => {
    await expect(signInWithAuthenticator({}, form({ email: "Admin@BuPulse.com", code: "123456" }))).rejects.toMatchObject({ url: "/" });
    expect(h.signIn).toHaveBeenCalledWith(expect.objectContaining({ email: "admin@bupulse.com", code: "123456" }));
    expect(h.ensureOwnerAgent).toHaveBeenCalledWith({ id: "owner-id", email: "admin@bupulse.com", emailConfirmed: true });
  });

  it("lets an active agent try, but never opens a session for an unknown address", async () => {
    expect((await signInWithAuthenticator({}, form({ email: "ana@example.com", code: "123456" }))).error).toMatch(/did not work/);
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.padTo).toHaveBeenCalledTimes(1);
  });

  it("refuses a locked agent even with the right code", async () => {
    h.findUnique.mockResolvedValue({ status: "active" });
    h.agentFor.mockResolvedValue({ id: "a2", email: "kim@bupulse.com", userId: "u2", status: "locked" });
    h.signIn.mockImplementation(async (opts: { allow: (u: unknown) => Promise<true | string> }) => {
      const allowed = await opts.allow({ id: "u2", email: "kim@bupulse.com", email_confirmed_at: "x" });
      return allowed === true ? { ok: true } : { ok: false, error: allowed };
    });
    expect((await signInWithAuthenticator({}, form({ email: "kim@bupulse.com", code: "123456" }))).error).toMatch(/locked/);
  });

  it("passes on a wrong code as the same answer", async () => {
    h.signIn.mockResolvedValue({ ok: false });
    expect((await signInWithAuthenticator({}, form({ email: "admin@bupulse.com", code: "123456" }))).error).toMatch(/did not work/);
  });

  it("is refused when the emailed code is switched back on", async () => {
    vi.stubEnv("ADMIN_LOGIN_EMAIL_CODE", "on");
    expect((await signInWithAuthenticator({}, form({ email: "admin@bupulse.com", code: "123456" }))).error).toMatch(/Reload/);
    expect(h.signIn).not.toHaveBeenCalled();
  });
});
