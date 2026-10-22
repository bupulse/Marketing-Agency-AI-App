import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOtp, verifyOtp, padTo, publicLimited } = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn(), padTo: vi.fn(async (...args: [number, number]) => void args), publicLimited: vi.fn(async () => null) }));
const { queryRaw, createUser, logError } = vi.hoisted(() => ({ queryRaw: vi.fn(async (): Promise<{ id: string }[]> => []), createUser: vi.fn(), logError: vi.fn(async () => {}) }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect:${url}`), { url });
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithOtp, verifyOtp } }) }));
vi.mock("@/lib/request-limits", () => ({ publicLimited, padTo }));
vi.mock("@/lib/db", () => ({ prisma: { staffMember: { findUnique: vi.fn(async () => null) }, $queryRaw: queryRaw } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { createUser } } }) }));
vi.mock("@/lib/errors", () => ({ logError }));

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
  queryRaw.mockReset().mockResolvedValue([]);
  createUser.mockReset().mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  logError.mockClear();
});

const noSignIn = { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" };

describe("admin code that cannot be sent", () => {
  it("creates the owner's missing sign-in (confirmed, no password) and sends the code", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: noSignIn }).mockResolvedValueOnce({ error: null });
    expect(await sendAdminCode({}, form({ email: "admin@bupulse.com" }))).toEqual({ sentTo: "admin@bupulse.com" });
    expect(createUser).toHaveBeenCalledWith({ email: "admin@bupulse.com", email_confirm: true, user_metadata: { admin_owner: true } });
    expect(createUser.mock.calls[0][0]).not.toHaveProperty("password");
    expect(signInWithOtp).toHaveBeenCalledTimes(2);
    expect(logError).not.toHaveBeenCalled();
  });

  it("never touches an existing sign-in; logs the failure and answers like everyone else", async () => {
    queryRaw.mockResolvedValue([{ id: "someone" }]);
    signInWithOtp.mockResolvedValue({ error: noSignIn });
    expect(await sendAdminCode({}, form({ email: "admin@bupulse.com" }))).toEqual({ sentTo: "admin@bupulse.com" });
    expect(createUser).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(noSignIn, expect.objectContaining({ source: "admin.login.code", code: "otp_disabled", status: 422 }));
  });

  it("creates nothing for a staff address (their sign-in is made when they are invited)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.staffMember.findUnique).mockResolvedValueOnce({ status: "active" } as never);
    signInWithOtp.mockResolvedValue({ error: noSignIn });
    expect(await sendAdminCode({}, form({ email: "staff@bupulse.com" }))).toEqual({ sentTo: "staff@bupulse.com" });
    expect(createUser).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("still says to wait when Supabase limits the sends", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    expect((await sendAdminCode({}, form({ email: "admin@bupulse.com" }))).error).toMatch(/Wait a minute/);
    expect(createUser).not.toHaveBeenCalled();
  });
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
