import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp, exchangeCodeForSession, ensureAccount } = vi.hoisted(() => ({ verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(), ensureAccount: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));
vi.mock("@/lib/account", () => ({ ensureAccount }));

import { GET } from "@/app/auth/confirm/route";

async function confirmResponse(query: string) {
  return GET(new NextRequest(`https://bupulse.test/auth/confirm${query}`));
}

async function confirm(query: string) {
  return (await confirmResponse(query)).headers.get("location");
}

describe("auth confirm route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bupulse.test"); // the routes send people back to the site address
    verifyOtp.mockReset();
    ensureAccount.mockReset();
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    exchangeCodeForSession.mockReset();
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1" }, session: {}, redirectType: null }, error: null });
  });

  it("confirms a sign-up, creates the account and follows next", async () => {
    expect(await confirm("?token_hash=h&type=signup&next=/dashboard")).toBe("https://bupulse.test/dashboard");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "h" });
    expect(ensureAccount).toHaveBeenCalledTimes(1);
  });

  it("treats type=email like a sign-up", async () => {
    await confirm("?token_hash=h&type=email");
    expect(ensureAccount).toHaveBeenCalledTimes(1);
  });

  it("sends recovery links to the reset page without creating an account", async () => {
    expect(await confirm("?token_hash=h&type=recovery&next=/reset-password")).toBe("https://bupulse.test/reset-password");
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it("does not start a trial for an email change", async () => {
    await confirm("?token_hash=h&type=email_change&next=/dashboard/settings");
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it.each(["//evil.com", "https://evil.com"])("ignores the external target %s", async (next) => {
    expect(await confirm(`?token_hash=h&type=signup&next=${encodeURIComponent(next)}`)).toBe("https://bupulse.test/dashboard");
  });

  it("without a next, follows the sign-up's metadata: a creator's start page, or the business return path", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1", user_metadata: { account_kind: "creator" } } }, error: null });
    expect(await confirm("?token_hash=h&type=email")).toBe("https://bupulse.test/creator/profile");
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1", user_metadata: { return_to: "/dashboard/stores/shopify?shop=a" } } }, error: null });
    const response = await confirmResponse("?token_hash=h&type=email");
    expect(response.headers.get("location")).toBe("https://bupulse.test/dashboard/stores/shopify?shop=a");
    expect(response.cookies.get("bp_return")?.value).toBe("/dashboard/stores/shopify?shop=a");
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1", user_metadata: { return_to: "//evil.com" } } }, error: null });
    expect(await confirm("?token_hash=h&type=email")).toBe("https://bupulse.test/dashboard");
  });

  it("sends a bad reset link to forgot-password with the expired note", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    expect(await confirm("?token_hash=h&type=recovery&next=/reset-password")).toBe("https://bupulse.test/forgot-password?error=expired");
  });

  it("goes to login with a confirm error when the token is bad", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    expect(await confirm("?token_hash=h&type=signup")).toBe("https://bupulse.test/login?error=confirm");
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it.each(["", "?type=signup", "?token_hash=h", "?token_hash=h&type=magiclink"])("rejects %j without verifying", async (q) => {
    expect(await confirm(q)).toBe("https://bupulse.test/login?error=confirm");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  describe("PKCE code from Supabase's own email", () => {
    it("signs in, creates the account and follows next in the browser that signed up", async () => {
      expect(await confirm("?code=c1&next=%2Fcreator%2Fprofile")).toBe("https://bupulse.test/creator/profile");
      expect(exchangeCodeForSession).toHaveBeenCalledWith("c1");
      expect(ensureAccount).toHaveBeenCalledTimes(1);
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it("sends a recovery code to the reset page without creating an account", async () => {
      expect(await confirm("?code=c1&type=recovery&next=/reset-password")).toBe("https://bupulse.test/reset-password");
      exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1" }, session: {}, redirectType: "recovery" }, error: null });
      expect(await confirm("?code=c1")).toBe("https://bupulse.test/reset-password");
      expect(ensureAccount).not.toHaveBeenCalled();
    });

    it("the default Supabase reset email, back in the same browser, opens Choose a new password (not the expired screen)", async () => {
      // /forgot-password asks for redirectTo /auth/confirm?type=recovery&next=/reset-password; Supabase's /verify appends the code.
      const location = await confirm("?type=recovery&next=%2Freset-password&code=0b6f4c7e-1d2a-4c55-9a3e-7f1e2d3c4b5a");
      expect(location).toBe("https://bupulse.test/reset-password");
      expect(location).not.toContain("error=confirm");
      expect(exchangeCodeForSession).toHaveBeenCalledWith("0b6f4c7e-1d2a-4c55-9a3e-7f1e2d3c4b5a");
      expect(verifyOtp).not.toHaveBeenCalled();
      expect(ensureAccount).not.toHaveBeenCalled();
    });

    it("opened in another browser: the email is confirmed, so it asks to sign in (keeping next)", async () => {
      exchangeCodeForSession.mockResolvedValue({ data: { user: null, session: null, redirectType: null }, error: Object.assign(new Error("PKCE code verifier not found"), { code: "pkce_code_verifier_not_found" }) });
      expect(await confirm("?code=c1&next=%2Fdashboard")).toBe("https://bupulse.test/login?notice=confirmed");
      expect(await confirm("?code=c1&next=%2Fcreator%2Fprofile")).toBe("https://bupulse.test/login?notice=confirmed&next=%2Fcreator%2Fprofile");
      expect(await confirm("?code=c1&next=%2F%2Fevil.com")).toBe("https://bupulse.test/login?notice=confirmed");
      expect(ensureAccount).not.toHaveBeenCalled();
    });

    it("a reset opened in another browser asks for a new code", async () => {
      exchangeCodeForSession.mockResolvedValue({ data: { user: null, session: null, redirectType: null }, error: new Error("no verifier") });
      expect(await confirm("?code=c1&type=recovery&next=/reset-password")).toBe("https://bupulse.test/forgot-password?error=other-browser");
    });
  });

  it.each([
    "?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    "?error_code=otp_expired&code=c1",
    "?error=access_denied&token_hash=h&type=signup",
  ])("Supabase's own error %s shows the expired screen without verifying", async (q) => {
    expect(await confirm(q)).toBe("https://bupulse.test/login?error=confirm");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("an expired reset from Supabase goes to forgot-password", async () => {
    expect(await confirm("?error=access_denied&error_code=otp_expired&type=recovery")).toBe("https://bupulse.test/forgot-password?error=expired");
  });
});
