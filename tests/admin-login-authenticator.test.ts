import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin sign-in while the emailed code is off: email + authenticator code (app/admin/(auth)/login/actions.ts).
const h = vi.hoisted(() => ({
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  setSession: vi.fn(async () => ({ error: null })),
  rateLimit: vi.fn(async () => {}),
  padTo: vi.fn(async (...args: [number, number]) => void args),
  publicLimited: vi.fn(async (): Promise<string | null> => null),
  logError: vi.fn(async () => {}),
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
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { verifyOtp: h.verifyOtp, signOut: h.signOut, getSession: h.getSession, mfa: { listFactors: h.listFactors, challengeAndVerify: h.challengeAndVerify } } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { setSession: h.setSession } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { generateLink: h.generateLink } } }) }));
vi.mock("@/lib/admin/service-keys", () => ({ loadServiceKeys: async () => {} }));
vi.mock("@/lib/rate-limit", async () => {
  class RateLimitError extends Error {}
  return { rateLimit: h.rateLimit, RateLimitError };
});
vi.mock("@/lib/request-limits", () => ({ publicLimited: h.publicLimited, padTo: h.padTo }));
vi.mock("@/lib/db", () => ({ prisma: { staffMember: { findUnique: vi.fn(async () => null) } } }));
vi.mock("@/lib/errors", () => ({ logError: h.logError }));

import { signInWithAuthenticator } from "@/app/admin/(auth)/login/actions";
import { RateLimitError } from "@/lib/rate-limit";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const owner = { email: "admin@bupulse.com", code: "123456" };
const session = { access_token: "at-aal2", refresh_token: "rt-aal2" };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  vi.stubEnv("ADMIN_LOGIN_EMAIL_CODE", "");
  for (const f of Object.values(h)) f.mockClear();
  h.generateLink.mockReset().mockResolvedValue({ data: { properties: { hashed_token: "hash" } }, error: null });
  h.verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: "owner-id" } }, error: null });
  h.listFactors.mockReset().mockResolvedValue({ data: { totp: [{ id: "f1", status: "verified" }] } });
  h.challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
  h.getSession.mockReset().mockResolvedValue({ data: { session } });
  h.publicLimited.mockReset().mockResolvedValue(null);
  h.rateLimit.mockReset().mockResolvedValue(undefined);
});

describe("admin sign-in with the authenticator code only", () => {
  it("signs the owner in with the right code: checks it first, then stores the AAL2 session, emails nothing", async () => {
    await expect(signInWithAuthenticator({}, form({ email: "Admin@BuPulse.com", code: "123456" }))).rejects.toMatchObject({ url: "/admin" });
    expect(h.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "admin@bupulse.com" });
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "email" });
    expect(h.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(h.setSession).toHaveBeenCalledWith(session);
    expect(h.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(h.setSession.mock.invocationCallOrder[0]);
    expect(h.rateLimit).toHaveBeenCalledWith("admin-verify:owner-id", expect.anything());
  });

  it("a wrong code stores no session and closes the one it opened", async () => {
    h.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "invalid" } });
    expect((await signInWithAuthenticator({}, form(owner))).error).toMatch(/did not work/);
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("an account with no authenticator set up cannot sign in this way", async () => {
    h.listFactors.mockResolvedValue({ data: { totp: [{ id: "f1", status: "unverified" }] } });
    expect((await signInWithAuthenticator({}, form(owner))).error).toMatch(/did not work/);
    expect(h.challengeAndVerify).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("a non-admin address gets the same answer after the same wait, and no session is ever opened", async () => {
    expect((await signInWithAuthenticator({}, form({ email: "ana@example.com", code: "123456" }))).error).toMatch(/did not work/);
    expect(h.generateLink).not.toHaveBeenCalled();
    expect(h.padTo).toHaveBeenCalledTimes(1);
  });

  it("checks the form before anything else", async () => {
    expect((await signInWithAuthenticator({}, form({ email: "nope", code: "123456" }))).error).toMatch(/admin email/);
    expect((await signInWithAuthenticator({}, form({ email: "admin@bupulse.com", code: "12345" }))).error).toMatch(/6-digit/);
    expect(h.generateLink).not.toHaveBeenCalled();
  });

  it("respects the per-address limit and the per-admin code limit", async () => {
    h.publicLimited.mockResolvedValueOnce("Too many tries.");
    expect((await signInWithAuthenticator({}, form(owner))).error).toBe("Too many tries.");
    expect(h.generateLink).not.toHaveBeenCalled();
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    expect((await signInWithAuthenticator({}, form(owner))).error).toMatch(/Too many attempts/);
    expect(h.challengeAndVerify).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalled();
  });

  it("is refused when the emailed code is switched back on (ADMIN_LOGIN_EMAIL_CODE=on)", async () => {
    vi.stubEnv("ADMIN_LOGIN_EMAIL_CODE", "on");
    expect((await signInWithAuthenticator({}, form(owner))).error).toMatch(/emailed code/);
    expect(h.generateLink).not.toHaveBeenCalled();
  });
});
