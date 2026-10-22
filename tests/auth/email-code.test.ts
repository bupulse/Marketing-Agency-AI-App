import { beforeEach, describe, expect, it, vi } from "vitest";

// "Confirm your email" and "Forgot password" by the code in the email: Supabase verifyOtp, the same next as the link,
// limited per address, and every wrong code answered the same way in the same time.

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  ensureAccount: vi.fn(async () => true),
  rememberReturn: vi.fn(async () => {}),
  publicLimited: vi.fn(async (): Promise<string | null> => null),
  padTo: vi.fn(async (...args: [number, number]) => void args),
  logError: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect:${url}`), { url });
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp: h.verifyOtp } }) }));
vi.mock("@/lib/account", () => ({ ensureAccount: h.ensureAccount, findAccountByEmail: vi.fn(async () => null) }));
vi.mock("@/lib/auth/return-server", () => ({ rememberReturn: h.rememberReturn }));
vi.mock("@/lib/request-limits", () => ({ publicLimited: h.publicLimited, padTo: h.padTo, requestIp: async () => null }));
vi.mock("@/lib/errors", () => ({ logError: h.logError }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/industries/server", () => ({ resolveIndustryChoice: async () => null }));
vi.mock("@/lib/sales/referral", () => ({ refFromCookie: async () => null }));

import { confirmEmailCode } from "@/app/signup/actions";
import { verifyResetCode } from "@/app/forgot-password/actions";
import { cleanEmailCode, confirmedNext } from "@/lib/auth/confirm-next";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const refused = { code: "otp_expired", status: 403, message: "Token has expired or is invalid" };
const user = (meta: Record<string, unknown> = {}) => ({ id: "u1", email: "aline@example.com", email_confirmed_at: "2026-10-22T00:00:00Z", user_metadata: meta });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockClear();
  h.verifyOtp.mockReset().mockResolvedValue({ data: { user: user(), session: {} }, error: null });
  h.publicLimited.mockResolvedValue(null);
});

describe("the code box helpers", () => {
  it("keeps 6 to 10 digits, without the spaces or dashes of a paste", () => {
    expect(cleanEmailCode("123 456")).toBe("123456");
    expect(cleanEmailCode(" 1234-5678 ")).toBe("12345678");
    expect(cleanEmailCode("12345")).toBeNull();
    expect(cleanEmailCode("12345678901")).toBeNull();
    expect(cleanEmailCode("12a456")).toBeNull();
    expect(cleanEmailCode(null)).toBeNull();
  });

  it("goes where the link goes: next, else the creator start page, else the remembered return path", () => {
    expect(confirmedNext(user(), "/dashboard/stores")).toBe("/dashboard/stores");
    expect(confirmedNext(user({ account_kind: "creator" }), null)).toBe("/creator/profile");
    expect(confirmedNext(user({ return_to: "/dashboard/billing" }), null)).toBe("/dashboard/billing");
    expect(confirmedNext(user({ return_to: "https://evil.com" }), null)).toBe("/dashboard");
    expect(confirmedNext(null, "//evil.com")).toBe("/dashboard");
  });
});

describe("confirm your email by code", () => {
  it("confirms, creates the account and follows next", async () => {
    await expect(confirmEmailCode({}, form({ email: "Aline@Example.com", code: "123 456", next: "/dashboard/stores" }))).rejects.toMatchObject({ url: "/dashboard/stores" });
    expect(h.verifyOtp).toHaveBeenCalledWith({ email: "aline@example.com", token: "123456", type: "email" });
    expect(h.ensureAccount).toHaveBeenCalledTimes(1);
    expect(h.rememberReturn).toHaveBeenCalledWith("/dashboard/stores");
    expect(h.publicLimited).toHaveBeenCalledWith("confirmCode", "aline@example.com");
  });

  it("sends a creator to their start page, and never off the site", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: user({ account_kind: "creator" }), session: {} }, error: null });
    await expect(confirmEmailCode({}, form({ email: "aline@example.com", code: "123456", next: "/creator/profile" }))).rejects.toMatchObject({ url: "/creator/profile" });
    await expect(confirmEmailCode({}, form({ email: "aline@example.com", code: "123456", next: "https://evil.com" }))).rejects.toMatchObject({ url: "/dashboard" });
  });

  it("tries the older sign-up type when Supabase refuses the code as type email", async () => {
    h.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: refused });
    await expect(confirmEmailCode({}, form({ email: "aline@example.com", code: "12345678" }))).rejects.toMatchObject({ url: "/dashboard" });
    expect(h.verifyOtp).toHaveBeenNthCalledWith(2, { email: "aline@example.com", token: "12345678", type: "signup" });
  });

  it("answers every wrong code the same way, padded to the same time, without logging it", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: refused });
    const a = await confirmEmailCode({}, form({ email: "aline@example.com", code: "123456" }));
    const b = await confirmEmailCode({}, form({ email: "nobody@example.com", code: "654321" }));
    expect(a).toEqual(b);
    expect(a.error).toMatch(/did not work/);
    expect(h.padTo).toHaveBeenCalledTimes(2);
    expect(h.padTo.mock.calls[0][1]).toBe(h.padTo.mock.calls[1][1]);
    expect(h.ensureAccount).not.toHaveBeenCalled();
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("logs an outage but still answers plainly", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "unexpected_failure", status: 500, message: "boom" } });
    expect((await confirmEmailCode({}, form({ email: "aline@example.com", code: "123456" }))).error).toMatch(/did not work/);
    expect(h.logError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "signup.code", status: 500 }));
  });

  it("checks the code's shape and the limit before asking Supabase", async () => {
    expect((await confirmEmailCode({}, form({ email: "aline@example.com", code: "12" }))).error).toMatch(/6 to 10 digits/);
    h.publicLimited.mockResolvedValueOnce("You're doing that a lot. Please try again in 10 minutes.");
    expect((await confirmEmailCode({}, form({ email: "aline@example.com", code: "123456" }))).error).toMatch(/doing that a lot/);
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("reset your password by code", () => {
  it("opens a recovery session and goes to the reset page", async () => {
    await expect(verifyResetCode({}, form({ email: "aline@example.com", code: "12345678" }))).rejects.toMatchObject({ url: "/reset-password" });
    expect(h.verifyOtp).toHaveBeenCalledWith({ email: "aline@example.com", token: "12345678", type: "recovery" });
    expect(h.publicLimited).toHaveBeenCalledWith("resetCode", "aline@example.com");
    expect(h.ensureAccount).not.toHaveBeenCalled();
  });

  it("answers a wrong code and an unknown address the same way, in the same time", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: refused });
    const a = await verifyResetCode({}, form({ email: "aline@example.com", code: "123456" }));
    const b = await verifyResetCode({}, form({ email: "nobody@example.com", code: "123456" }));
    expect(a).toEqual(b);
    expect(a.error).toMatch(/did not work/);
    expect(h.padTo).toHaveBeenCalledTimes(2);
  });
});
