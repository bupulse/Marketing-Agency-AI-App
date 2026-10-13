import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin sign-in codes go to the owner and to enabled staff (invited ones too: the first sign-in activates them);
// a disabled member, a stranger or a database error gets none.

const h = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { staffMember: { findUnique: h.findUnique } } }));

import { canReceiveAdminCode, identityFor } from "@/lib/admin/auth";

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@bupulse.com");
  h.findUnique.mockReset();
});

describe("who gets an admin sign-in code", () => {
  it("the owner, without a staff row", async () => {
    expect(await canReceiveAdminCode("Admin@BuPulse.com")).toBe(true);
    expect(h.findUnique).not.toHaveBeenCalled();
  });
  it("active and invited staff, not disabled ones or strangers", async () => {
    h.findUnique.mockResolvedValueOnce({ status: "active" });
    expect(await canReceiveAdminCode("a@x.co")).toBe(true);
    h.findUnique.mockResolvedValueOnce({ status: "invited" });
    expect(await canReceiveAdminCode("b@x.co")).toBe(true);
    h.findUnique.mockResolvedValueOnce({ status: "disabled" });
    expect(await canReceiveAdminCode("c@x.co")).toBe(false);
    h.findUnique.mockResolvedValueOnce(null);
    expect(await canReceiveAdminCode("d@x.co")).toBe(false);
    h.findUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await canReceiveAdminCode("e@x.co")).toBe(false);
  });
});

describe("console identity", () => {
  it("gives a staff member their role's permissions and nothing else", async () => {
    h.findUnique.mockResolvedValueOnce({ id: "s1", roleKey: "finance", status: "active", userId: "u1", lastSignInAt: null });
    const id = await identityFor({ id: "u1", email: "f@x.co" });
    expect(id).toMatchObject({ staffId: "s1", roleName: "Finance", isOwner: false });
    expect(id!.permissions).toContain("payments.approve");
    expect(id!.permissions).not.toContain("staff.manage");
  });
  it("refuses a disabled member, and a staff row linked to another account", async () => {
    h.findUnique.mockResolvedValueOnce({ id: "s1", roleKey: "finance", status: "disabled", userId: "u1", lastSignInAt: null });
    expect(await identityFor({ id: "u1", email: "f@x.co" })).toBeNull();
    h.findUnique.mockResolvedValueOnce({ id: "s1", roleKey: "finance", status: "active", userId: "someone-else", lastSignInAt: null });
    expect(await identityFor({ id: "u1", email: "f@x.co" })).toBeNull();
  });
});
