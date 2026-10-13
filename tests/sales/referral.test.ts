import { beforeEach, describe, expect, it, vi } from "vitest";

// Referral links: the first-click cookie (proxy.ts) and the sign-up assignment (lib/account.ts). No database.

const db = vi.hoisted(() => ({
  staffMember: { findUnique: vi.fn(), updateMany: vi.fn() },
  staffRole: { findUnique: vi.fn() },
  business: { updateMany: vi.fn() },
  clientAssignment: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { REF_COOKIE, REF_MAX_AGE, refCookieFor } from "@/lib/sales/ref-cookie";
import { assignReferral, ensureRefCode, randomRefCode, refUrl } from "@/lib/sales/referral";
import { REF_CODE } from "@/lib/staff/permissions";

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.staffRole.findUnique.mockResolvedValue(null);
  db.business.updateMany.mockResolvedValue({ count: 1 });
  db.clientAssignment.create.mockResolvedValue({});
});

describe("first-click cookie", () => {
  it("sets a valid code for 30 days, httpOnly and lax, secure in production", () => {
    const c = refCookieFor("k7q2", undefined, true);
    expect(c).toEqual({ name: REF_COOKIE, value: "K7Q2", options: { path: "/", maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: "lax", secure: true } });
    expect(REF_MAX_AGE).toBe(2_592_000);
    expect(refCookieFor("K7Q2", undefined, false)?.options.secure).toBe(false);
  });

  it("never replaces an existing valid code: the first link wins", () => {
    expect(refCookieFor("ABCD", "K7Q2")).toBeNull();
  });

  it("replaces a cookie that is not a valid code", () => {
    expect(refCookieFor("ABCD", "bad!")?.value).toBe("ABCD");
  });

  it("ignores invalid codes", () => {
    for (const bad of [null, "", "ABC", "ABCDEFGHJ", "AB0D", "AB1D", "<script>", "AB CD"]) expect(refCookieFor(bad, undefined)).toBeNull();
  });
});

describe("codes and links", () => {
  it("makes codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) expect(randomRefCode()).toMatch(REF_CODE);
  });

  it("puts the code on any page", () => {
    expect(refUrl("K7Q2")).toMatch(/\/\?ref=K7Q2$/);
    expect(refUrl("K7Q2", "/pricing")).toMatch(/\/pricing\?ref=K7Q2$/);
  });

  it("keeps an existing code", async () => {
    db.staffMember.findUnique.mockResolvedValue({ refCode: "K7Q2" });
    expect(await ensureRefCode("s1")).toBe("K7Q2");
    expect(db.staffMember.updateMany).not.toHaveBeenCalled();
  });

  it("retries after a collision", async () => {
    db.staffMember.findUnique.mockResolvedValue({ refCode: null });
    db.staffMember.updateMany.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" })).mockResolvedValueOnce({ count: 1 });
    const code = await ensureRefCode("s1");
    expect(code).toMatch(REF_CODE);
    expect(db.staffMember.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe("sign-up assignment", () => {
  const input = { businessId: "b1", userId: "u1", code: "k7q2", at: new Date("2026-10-13T10:00:00Z") };

  it("gives the company to an active sales agent", async () => {
    db.staffMember.findUnique.mockResolvedValue({ id: "s1", status: "active", roleKey: "sales_agent" });
    expect(await assignReferral(input)).toBe("s1");
    expect(db.staffMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { refCode: "K7Q2" } }));
    expect(db.business.updateMany).toHaveBeenCalledWith({ where: { id: "b1", salesAgentId: null }, data: { salesAgentId: "s1" } });
    expect(db.clientAssignment.create).toHaveBeenCalledWith({ data: { businessId: "b1", userId: "u1", staffId: "s1", startsAt: input.at, source: "referral", by: "referral" } });
  });

  it("counts an invited agent too", async () => {
    db.staffMember.findUnique.mockResolvedValue({ id: "s1", status: "invited", roleKey: "sales_manager" });
    expect(await assignReferral(input)).toBe("s1");
  });

  it("ignores a disabled agent, an unknown code, a non-sales role and no code", async () => {
    db.staffMember.findUnique.mockResolvedValueOnce({ id: "s1", status: "disabled", roleKey: "sales_agent" });
    expect(await assignReferral(input)).toBeNull();
    db.staffMember.findUnique.mockResolvedValueOnce(null);
    expect(await assignReferral(input)).toBeNull();
    db.staffMember.findUnique.mockResolvedValueOnce({ id: "s2", status: "active", roleKey: "finance" });
    expect(await assignReferral(input)).toBeNull();
    expect(await assignReferral({ ...input, code: null })).toBeNull();
    expect(await assignReferral({ ...input, code: "bad code" })).toBeNull();
    expect(db.clientAssignment.create).not.toHaveBeenCalled();
  });

  it("never fails the sign-up", async () => {
    db.staffMember.findUnique.mockRejectedValue(new Error("database down"));
    await expect(assignReferral(input)).resolves.toBeNull();
    db.staffMember.findUnique.mockResolvedValue({ id: "s1", status: "active", roleKey: "sales_agent" });
    db.clientAssignment.create.mockRejectedValue(new Error("unique"));
    await expect(assignReferral(input)).resolves.toBeNull();
  });
});
