import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, getAal, listFactors, challengeAndVerify, rateLimit, enroll, unenroll, getSession } = vi.hoisted(() => ({
  enroll: vi.fn(),
  unenroll: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  getAal: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  rateLimit: vi.fn(),
}));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}
class NotFound extends Error {
  constructor() {
    super("notfound");
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser, getSession, mfa: { getAuthenticatorAssuranceLevel: getAal, listFactors, challengeAndVerify, enroll, unenroll } },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  RateLimitError: class RateLimitError extends Error {},
}));

import { hasRecentEmailProof, adminEmails, isAdminEmail, limitVerifyAttempts, requireAdmin, requireAdminIdentity } from "@/lib/admin/auth";
import { startEnrollment, verifyCode } from "@/app/admin/(auth)/actions";

const verifiedFactor = { id: "f1", status: "verified" };
function signedIn(email: string, confirmed = true) {
  getUser.mockResolvedValue({
    data: { user: { id: "u1", email, email_confirmed_at: confirmed ? "2026-10-01T00:00:00Z" : null } },
    error: null,
  });
}
function level(currentLevel: string, nextLevel: string) {
  getAal.mockResolvedValue({ data: { currentLevel, nextLevel }, error: null });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  for (const m of [getUser, getAal, listFactors, challengeAndVerify, rateLimit, enroll, unenroll, getSession]) m.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: `x.${Buffer.from(JSON.stringify({ session_id: "sess-aaaa-1111" })).toString("base64url")}.y` } } });
  listFactors.mockResolvedValue({ data: { totp: [verifiedFactor], all: [verifiedFactor] }, error: null });
  rateLimit.mockResolvedValue(undefined);
});

describe("requireAdmin", () => {
  it("returns 404 for a signed-in non-admin", async () => {
    signedIn("ana@example.com");
    level("aal2", "aal2");
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotFound);
  });

  it("returns 404 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotFound);
  });

  it("refuses an unverified email even if it is on the list", async () => {
    signedIn("admin@bupulse.com", false);
    level("aal2", "aal2");
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotFound);
  });

  it("sends an admin at AAL1 with an enrolled app to /admin/verify", async () => {
    signedIn("admin@bupulse.com");
    level("aal1", "aal2");
    await expect(requireAdmin()).rejects.toMatchObject({ url: "/admin/verify" });
  });

  it("sends an admin with no authenticator yet to setup", async () => {
    signedIn("admin@bupulse.com");
    level("aal1", "aal1");
    await expect(requireAdmin()).rejects.toMatchObject({ url: "/admin/setup-2fa" });
  });

  it("allows an admin at AAL2", async () => {
    signedIn("admin@bupulse.com");
    level("aal2", "aal2");
    await expect(requireAdmin()).resolves.toMatchObject({ id: "u1", email: "admin@bupulse.com", isOwner: true, staffId: null });
  });

  it("matches the email case-insensitively", async () => {
    vi.stubEnv("ADMIN_EMAILS", " Admin@BuPulse.com , other@x.com");
    signedIn("ADMIN@bupulse.COM");
    level("aal2", "aal2");
    await expect(requireAdmin()).resolves.toMatchObject({ email: "admin@bupulse.com" });
  });

  it("refuses AAL2 when no verified TOTP factor exists", async () => {
    signedIn("admin@bupulse.com");
    level("aal2", "aal2");
    listFactors.mockResolvedValue({ data: { totp: [{ id: "f", status: "unverified" }], all: [] }, error: null });
    await expect(requireAdmin()).rejects.toMatchObject({ url: "/admin/setup-2fa" });
  });

  it("refuses everyone when ADMIN_EMAILS is empty", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    signedIn("admin@bupulse.com");
    await expect(requireAdminIdentity()).rejects.toBeInstanceOf(NotFound);
  });
});

describe("email list", () => {
  it("parses, trims and lower-cases", () => {
    expect(adminEmails(" A@x.com,,b@y.com ")).toEqual(["a@x.com", "b@y.com"]);
    expect(isAdminEmail(null)).toBe(false);
  });
});

describe("verification step", () => {
  it("rate-limits per admin", async () => {
    await limitVerifyAttempts("u1");
    expect(rateLimit).toHaveBeenCalledWith("admin-verify:u1", expect.objectContaining({ limit: 8 }));
  });

  it("rejects a malformed code without calling Supabase", async () => {
    signedIn("admin@bupulse.com");
    const form = new FormData();
    form.set("code", "12ab");
    const result = await verifyCode({}, form);
    expect(result.error).toMatch(/6-digit/);
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("goes to the console after a good code", async () => {
    signedIn("admin@bupulse.com");
    challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const form = new FormData();
    form.set("code", "123456");
    await expect(verifyCode({}, form)).rejects.toMatchObject({ url: "/admin" });
  });

  it("is a 404 for a non-admin trying the verify action", async () => {
    signedIn("ana@example.com");
    const form = new FormData();
    form.set("code", "123456");
    await expect(verifyCode({}, form)).rejects.toBeInstanceOf(NotFound);
  });
});

describe("enrolling an authenticator", () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const aal1 = (methods: unknown) => getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: methods }, error: null });
  beforeEach(() => {
    signedIn("admin@bupulse.com");
    listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
    enroll.mockResolvedValue({ data: { id: "nf", totp: { qr_code: "qr", secret: "SECRET" } }, error: null });
  });

  it("detects a recent emailed-code sign-in only", () => {
    expect(hasRecentEmailProof([{ method: "password", timestamp: nowSec() }])).toBe(false);
    expect(hasRecentEmailProof([{ method: "otp", timestamp: nowSec() - 3600 }])).toBe(false);
    expect(hasRecentEmailProof([{ method: "otp", timestamp: nowSec() - 60 }])).toBe(true);
    expect(hasRecentEmailProof(["password"])).toBe(false);
  });

  it("refuses a password-only session", async () => {
    aal1([{ method: "password", timestamp: nowSec() }]);
    expect(await startEnrollment()).toMatchObject({ needEmail: true });
    expect(enroll).not.toHaveBeenCalled();
  });

  it("enrols after an emailed code", async () => {
    aal1([{ method: "password", timestamp: nowSec() }, { method: "otp", timestamp: nowSec() }]);
    expect(await startEnrollment()).toMatchObject({ factorId: "nf", secret: "SECRET" });
  });

  it("does not replace a fresh setup started by another session", async () => {
    aal1([{ method: "otp", timestamp: nowSec() }]);
    const other = { id: "old", status: "unverified", friendly_name: "BuPulse admin zzzzzzzz", created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() };
    listFactors.mockResolvedValue({ data: { totp: [], all: [other] }, error: null });
    const r = await startEnrollment();
    expect(r.error).toMatch(/already in progress/);
    expect(unenroll).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
  });

  it("replaces its own earlier attempt and any stale setup", async () => {
    aal1([{ method: "otp", timestamp: nowSec() }]);
    const mine = { id: "mine", status: "unverified", friendly_name: "BuPulse admin sess-aaa", created_at: new Date().toISOString() };
    const stale = { id: "stale", status: "unverified", friendly_name: "BuPulse admin other", created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() };
    listFactors.mockResolvedValue({ data: { totp: [], all: [mine, stale] }, error: null });
    await startEnrollment();
    expect(unenroll).toHaveBeenCalledWith({ factorId: "mine" });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(enroll).toHaveBeenCalled();
  });

  it("sends an admin who already has an authenticator to verify", async () => {
    aal1([{ method: "otp", timestamp: nowSec() }]);
    listFactors.mockResolvedValue({ data: { totp: [{ id: "f1", status: "verified" }], all: [] }, error: null });
    await expect(startEnrollment()).rejects.toMatchObject({ url: "/admin/verify" });
  });
});
