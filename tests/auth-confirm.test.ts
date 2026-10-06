import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp, ensureAccount } = vi.hoisted(() => ({ verifyOtp: vi.fn(), ensureAccount: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/lib/account", () => ({ ensureAccount }));

import { GET } from "@/app/auth/confirm/route";

async function confirm(query: string) {
  const response = await GET(new NextRequest(`https://bupulse.test/auth/confirm${query}`));
  return response.headers.get("location");
}

describe("auth confirm route", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    ensureAccount.mockReset();
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
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

  it("goes to login with a confirm error when the token is bad", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    expect(await confirm("?token_hash=h&type=signup")).toBe("https://bupulse.test/login?error=confirm");
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it.each(["", "?type=signup", "?token_hash=h", "?token_hash=h&type=magiclink"])("rejects %j without verifying", async (q) => {
    expect(await confirm(q)).toBe("https://bupulse.test/login?error=confirm");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
