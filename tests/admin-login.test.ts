import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOtp, verifyOtp, padTo, publicLimited } = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn(), padTo: vi.fn(async (...args: [number, number]) => void args), publicLimited: vi.fn(async () => null) }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect:${url}`), { url });
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithOtp, verifyOtp } }) }));
vi.mock("@/lib/request-limits", () => ({ publicLimited, padTo }));
vi.mock("@/lib/db", () => ({ prisma: { staffMember: { findUnique: vi.fn(async () => null) } } }));

import { sendAdminCode, verifyAdminCode } from "@/app/admin/(auth)/login/actions";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  verifyOtp.mockReset();
});

describe("admin sign-in by emailed code", () => {
  it("emails a code to an admin address, without creating accounts", async () => {
    expect(await sendAdminCode({}, form({ email: "Admin@BuPulse.com" }))).toEqual({ sentTo: "admin@bupulse.com" });
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "admin@bupulse.com", options: { shouldCreateUser: false } });
  });

  it("answers the same for any other address but sends nothing", async () => {
    expect(await sendAdminCode({}, form({ email: "ana@example.com" }))).toEqual({ sentTo: "ana@example.com" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("takes the same time for an admin and a stranger, and counts per address and email (no lock-out from elsewhere)", async () => {
    padTo.mockClear();
    await sendAdminCode({}, form({ email: "admin@bupulse.com" }));
    await sendAdminCode({}, form({ email: "ana@example.com" }));
    expect(padTo).toHaveBeenCalledTimes(2);
    expect(padTo.mock.calls[0][1]).toBe(padTo.mock.calls[1][1]);
    expect(publicLimited).toHaveBeenCalledWith("adminCode", "admin@bupulse.com");
    padTo.mockClear();
    await verifyAdminCode({}, form({ email: "ana@example.com", code: "12345678" }));
    expect(padTo).toHaveBeenCalledTimes(1);
  });

  it("goes on to the authenticator step after a good code", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(verifyAdminCode({}, form({ email: "admin@bupulse.com", code: "12345678" }))).rejects.toMatchObject({ url: "/admin" });
  });

  it("refuses a bad code, and never checks a code for a non-admin address", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect((await verifyAdminCode({}, form({ email: "admin@bupulse.com", code: "12345678" }))).error).toMatch(/did not work/);
    expect((await verifyAdminCode({}, form({ email: "ana@example.com", code: "12345678" }))).error).toMatch(/did not work/);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });
});
