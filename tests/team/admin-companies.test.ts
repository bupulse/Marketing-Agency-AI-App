import { beforeEach, describe, expect, it, vi } from "vitest";

// Super-admin actions on company users. Supabase and the database are mocked; what is checked: audit rows, the notice to
// the OLD address, reset-link calls, confirm on the API, the rate limits and "a company always keeps its Owner".

const h = vi.hoisted(() => {
  const tx = {
    user: { create: vi.fn(), update: vi.fn() },
    membership: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    invite: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    tx,
    prisma: {
      ...tx,
      business: { findUnique: vi.fn() },
      user: { ...tx.user, findUnique: vi.fn() },
      membership: { ...tx.membership, findUnique: vi.fn() },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    },
    auth: { createUser: vi.fn(), updateUserById: vi.fn(), deleteUser: vi.fn(), generateLink: vi.fn() },
    resetPasswordForEmail: vi.fn(),
    sendEmail: vi.fn(),
    rateLimit: vi.fn(),
    erase: vi.fn(),
    seats: { limit: 3, members: 1, pending: 0 },
  };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}), redact: (v: unknown) => v }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: h.auth } }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } }) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: h.sendEmail }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));
vi.mock("@/lib/account-deletion", () => ({ eraseTeammateLogin: h.erase }));
vi.mock("@/lib/team/service", () => ({
  normalizeEmail: (s: string) => s.trim().toLowerCase(),
  lockSeats: async () => {},
  seatLimit: async () => h.seats.limit,
  seatsUsed: async () => ({ members: h.seats.members, pending: h.seats.pending }),
}));

import { changeCompanyUserRole, changeUserEmail, createCompanyUser, maskEmail, removeCompanyUser, sendPasswordReset } from "@/lib/admin/actions/companies";
import { RateLimitError } from "@/lib/rate-limit";
import { AdminError, apiContext, consoleContext } from "@/lib/admin/types";

const UID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const console_ = consoleContext("1.2.3.4");
const api = apiContext("key1", "9.9.9.9", "all");

const audits = () => h.tx.auditLog.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  h.seats = { limit: 3, members: 1, pending: 0 };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "anon";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com";
  h.prisma.$transaction.mockImplementation(async (fn: (t: typeof h.tx) => unknown) => fn(h.tx));
  h.prisma.$queryRaw.mockResolvedValue([]); // no auth.users row with that email
  h.prisma.user.findUnique.mockResolvedValue(null);
  h.prisma.business.findUnique.mockResolvedValue({ id: "biz1", name: "Acme", userId: OWNER });
  h.prisma.membership.findUnique.mockResolvedValue({ businessId: "biz1", role: "MEMBER", user: { email: "pat@old.com", name: "Pat" }, business: { name: "Acme", userId: OWNER } });
  h.auth.createUser.mockResolvedValue({ data: { user: { id: UID } }, error: null });
  h.auth.updateUserById.mockResolvedValue({ data: {}, error: null });
  h.auth.deleteUser.mockResolvedValue({ error: null });
  h.auth.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hashed123" } }, error: null });
  h.resetPasswordForEmail.mockResolvedValue({ error: null });
  h.sendEmail.mockResolvedValue(true);
  h.rateLimit.mockResolvedValue(undefined);
  h.erase.mockResolvedValue(undefined);
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("nadine@example.com")).toBe("n***@example.com");
  });
});

describe("createCompanyUser", () => {
  const input = { businessId: "biz1", email: " New.Person@Example.com ", role: "MEMBER", name: "New Person" };

  it("creates the sign-in with no password, the profile and membership, an audit row, and emails a link to choose a password", async () => {
    const result = await createCompanyUser(console_, input);
    expect(result).toMatchObject({ userId: UID, email: "new.person@example.com", role: "MEMBER", emailSent: true });
    const created = h.auth.createUser.mock.calls[0][0];
    expect(created).toMatchObject({ email: "new.person@example.com", email_confirm: true });
    expect(created).not.toHaveProperty("password");
    expect(h.tx.user.create).toHaveBeenCalledWith({ data: { id: UID, email: "new.person@example.com", name: "New Person", signUpMethod: "PASSWORD" } });
    expect(h.tx.membership.create).toHaveBeenCalledWith({ data: { businessId: "biz1", userId: UID, role: "MEMBER" } });
    expect(audits()).toEqual([expect.objectContaining({ actor: "admin", action: "create_company_user", target: `user:${UID}`, ip: "1.2.3.4" })]);
    const mail = h.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("new.person@example.com");
    expect(mail.text).toContain("https://app.example.com/auth/confirm?token_hash=hashed123&type=recovery&next=/reset-password");
  });

  it("refuses an Owner role, a bad address, a taken address and a full company", async () => {
    await expect(createCompanyUser(console_, { ...input, role: "OWNER" })).rejects.toThrow(/ADMIN or MEMBER/);
    await expect(createCompanyUser(console_, { ...input, email: "nope" })).rejects.toThrow(/valid email/);
    h.prisma.user.findUnique.mockResolvedValue({ id: "x" });
    await expect(createCompanyUser(console_, input)).rejects.toThrow(/already has a BuPulse sign-in/);
    h.prisma.user.findUnique.mockResolvedValue(null);
    h.seats.members = 3;
    await expect(createCompanyUser(console_, input)).rejects.toThrow(/all are taken/);
    expect(h.auth.createUser).not.toHaveBeenCalled();
  });

  it("removes the sign-in again when the database write fails", async () => {
    h.prisma.$transaction.mockRejectedValue(new Error("db down"));
    await expect(createCompanyUser(console_, input)).rejects.toThrow("db down");
    expect(h.auth.deleteUser).toHaveBeenCalledWith(UID);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("needs confirm over the API and is rate limited", async () => {
    await expect(createCompanyUser(api, input)).rejects.toMatchObject({ code: "confirm_required" });
    await createCompanyUser(api, { ...input, confirm: true });
    expect(audits()[0]).toMatchObject({ actor: "jarvis:key1" });
    h.rateLimit.mockRejectedValue(new RateLimitError(600));
    await expect(createCompanyUser(console_, input)).rejects.toBeInstanceOf(AdminError);
  });
});

describe("sendPasswordReset", () => {
  it("asks Supabase to mail the standard reset link to the current address and audits it without the link", async () => {
    const result = await sendPasswordReset(console_, { userId: UID });
    expect(result.sentTo).toBe("p***@old.com");
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith("pat@old.com", { redirectTo: "https://app.example.com/auth/confirm?type=recovery&next=/reset-password" });
    expect(audits()[0]).toMatchObject({ action: "send_password_reset", target: `user:${UID}` });
    expect(JSON.stringify(audits()[0])).not.toContain("hashed");
  });

  it("is limited per person and refuses a stranger who is not in a company", async () => {
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(100));
    await expect(sendPasswordReset(console_, { userId: UID })).rejects.toBeInstanceOf(AdminError);
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
    h.prisma.membership.findUnique.mockResolvedValue(null);
    await expect(sendPasswordReset(console_, { userId: UID })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("changeUserEmail", () => {
  it("confirms the new address at once, writes the audit row, and warns the OLD address with a masked new one", async () => {
    const result = await changeUserEmail(console_, { userId: UID, newEmail: "Pat@New.com", sendReset: true });
    expect(h.auth.updateUserById).toHaveBeenCalledWith(UID, { email: "pat@new.com", email_confirm: true });
    expect(h.tx.user.update).toHaveBeenCalledWith({ where: { id: UID }, data: { email: "pat@new.com" } });
    // every session of that person is ended
    const sql = h.tx.$executeRaw.mock.calls.map((c) => (c[0] as string[]).join("?"));
    expect(sql.some((q) => q.includes("DELETE FROM auth.sessions"))).toBe(true);
    expect(audits()[0]).toMatchObject({ action: "change_user_email", target: `user:${UID}`, before: expect.objectContaining({ email: "pat@old.com" }), after: expect.objectContaining({ email: "pat@new.com", resetLinkSent: true }) });
    const notice = h.sendEmail.mock.calls[0][0];
    expect(notice.to).toBe("pat@old.com");
    expect(notice.text).toContain("changed by BuPulse support to p***@new.com");
    expect(notice.text).toContain("If this wasn't you, contact us");
    expect(notice.text).not.toContain("pat@new.com");
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith("pat@new.com", expect.any(Object));
    expect(result).toMatchObject({ noticeSent: true, resetSent: true });
  });

  it("sends no reset link unless asked", async () => {
    await changeUserEmail(console_, { userId: UID, newEmail: "pat@new.com" });
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("puts the old address back when the database write fails, and refuses an address already in use", async () => {
    h.prisma.$transaction.mockRejectedValue(new Error("db down"));
    await expect(changeUserEmail(console_, { userId: UID, newEmail: "pat@new.com" })).rejects.toThrow("db down");
    expect(h.auth.updateUserById).toHaveBeenLastCalledWith(UID, { email: "pat@old.com", email_confirm: true });
    expect(h.sendEmail).not.toHaveBeenCalled();
    h.prisma.$transaction.mockImplementation(async (fn: (t: typeof h.tx) => unknown) => fn(h.tx));
    h.prisma.user.findUnique.mockResolvedValue({ id: "other" });
    await expect(changeUserEmail(console_, { userId: UID, newEmail: "taken@x.com" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses the same address and needs confirm over the API", async () => {
    await expect(changeUserEmail(console_, { userId: UID, newEmail: "PAT@old.com" })).rejects.toThrow(/already their email/);
    // Over the API an email change is never direct (see tests/team/approvals.test.ts), even with confirm.
    await expect(changeUserEmail(api, { userId: UID, newEmail: "a@b.co", confirm: true })).rejects.toMatchObject({ code: "forbidden" });
    expect(h.auth.updateUserById).not.toHaveBeenCalled();
  });
});

describe("removeCompanyUser and changeCompanyUserRole keep the Owner", () => {
  it("removes a member in one transaction with its audit row", async () => {
    await removeCompanyUser(console_, { userId: UID });
    // aimed at the company with no personal detail, written AFTER the erase so the erase cannot redact it
    expect(audits()[0]).toMatchObject({ action: "remove_company_user", target: "company:biz1", before: { company: "Acme", role: "MEMBER" } });
    expect(JSON.stringify(audits()[0])).not.toContain("@");
    expect(h.erase.mock.invocationCallOrder[0]).toBeLessThan(h.tx.auditLog.create.mock.invocationCallOrder[0]);
    expect(h.erase).toHaveBeenCalledWith(UID, h.tx);
  });

  it("never removes the Owner or the person holding the company account", async () => {
    h.prisma.membership.findUnique.mockResolvedValue({ businessId: "biz1", role: "OWNER", user: { email: "o@x.com", name: null }, business: { name: "Acme", userId: OWNER } });
    await expect(removeCompanyUser(console_, { userId: UID })).rejects.toThrow(/needs an owner/);
    h.prisma.membership.findUnique.mockResolvedValue({ businessId: "biz1", role: "ADMIN", user: { email: "a@x.com", name: null }, business: { name: "Acme", userId: UID } });
    await expect(removeCompanyUser(console_, { userId: UID })).rejects.toThrow(/company account/);
    expect(h.erase).not.toHaveBeenCalled();
  });

  it("refuses to demote the Owner directly", async () => {
    h.prisma.membership.findUnique.mockResolvedValue({ businessId: "biz1", role: "OWNER", user: { email: "o@x.com", name: null }, business: { name: "Acme", userId: OWNER } });
    await expect(changeCompanyUserRole(console_, { userId: UID, role: "MEMBER" })).rejects.toThrow(/needs an owner/);
  });

  it("makes someone Owner by handing ownership over: the previous owner becomes Admin, exactly one Owner remains", async () => {
    h.tx.membership.findFirst.mockResolvedValue({ userId: OWNER });
    h.tx.membership.count.mockResolvedValue(1);
    const result = await changeCompanyUserRole(console_, { userId: UID, role: "OWNER" });
    expect(h.tx.membership.update).toHaveBeenCalledWith({ where: { userId: OWNER }, data: { role: "ADMIN" } });
    expect(h.tx.membership.update).toHaveBeenCalledWith({ where: { userId: UID }, data: { role: "OWNER" } });
    expect(result).toMatchObject({ role: "OWNER", previousOwner: OWNER });
    expect(audits()[0]).toMatchObject({ action: "change_company_user_role" });
  });

  it("rolls back when the result would not have exactly one Owner", async () => {
    h.tx.membership.findFirst.mockResolvedValue({ userId: OWNER });
    h.tx.membership.count.mockResolvedValue(2);
    await expect(changeCompanyUserRole(console_, { userId: UID, role: "OWNER" })).rejects.toThrow(/exactly one owner/);
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses to make someone Owner over the API (it is an approval), but allows it from the console", async () => {
    await expect(changeCompanyUserRole(api, { userId: UID, role: "OWNER", confirm: true })).rejects.toMatchObject({ code: "forbidden" });
    expect(h.tx.membership.update).not.toHaveBeenCalled();
  });

  it("changes a plain role and audits it", async () => {
    h.tx.membership.count.mockResolvedValue(1);
    await changeCompanyUserRole(console_, { userId: UID, role: "ADMIN" });
    expect(h.tx.membership.update).toHaveBeenCalledWith({ where: { userId: UID }, data: { role: "ADMIN" } });
    expect(audits()[0]).toMatchObject({ after: expect.objectContaining({ role: "ADMIN" }) });
  });

  it("deletes the open invitations of someone demoted to Member", async () => {
    h.tx.membership.count.mockResolvedValue(1);
    h.prisma.membership.findUnique.mockResolvedValue({ businessId: "biz1", role: "ADMIN", user: { email: "a@x.com", name: null }, business: { name: "Acme", userId: OWNER } });
    await changeCompanyUserRole(console_, { userId: UID, role: "MEMBER" });
    expect(h.tx.invite.deleteMany).toHaveBeenCalledWith({ where: { businessId: "biz1", invitedBy: UID, acceptedAt: null } });
  });
});
