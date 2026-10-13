import { beforeEach, describe, expect, it, vi } from "vitest";

// The staff review: Jarvis keys carry their maker's permissions, managing someone needs their permissions, no
// self-referral, no staff from an unconfirmed sign-in, Kigali months, and admin-code limits per address and email.

const h = vi.hoisted(() => ({
  staffMember: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  staffRole: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  adminApiKey: { count: vi.fn(async () => 0), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  business: { updateMany: vi.fn() },
  clientAssignment: { create: vi.fn() },
  queryRaw: vi.fn(),
  rateLimit: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    staffMember: h.staffMember,
    staffRole: h.staffRole,
    adminApiKey: h.adminApiKey,
    business: h.business,
    clientAssignment: h.clientAssignment,
    auditLog: { create: vi.fn() },
    $queryRaw: h.queryRaw,
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ staffMember: h.staffMember, staffRole: h.staffRole, business: h.business, clientAssignment: h.clientAssignment, auditLog: { create: vi.fn() } }),
  },
}));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit, RateLimitError: class extends Error {}, rateLimitMessage: () => "slow down" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { keyPermissions } from "@/lib/admin/api-auth";
import { createAdminKey, rotateAdminKey } from "@/lib/admin/keys";
import { TOOL_NAMES, TOOL_PERMISSION, callTool, toolAllowed } from "@/lib/admin/tools";
import { apiContext, consoleContext } from "@/lib/admin/types";
import { publicLimited } from "@/lib/request-limits";
import { assignReferral } from "@/lib/sales/referral";
import { ALL_PERMISSIONS, isPermission, permissionsOf } from "@/lib/staff/permissions";
import { changeStaffRole, inviteStaff, setStaffDisabled } from "@/lib/staff/service";
import { kigaliDayStart, kigaliMonthOf, kigaliMonthRange } from "@/lib/time/kigali";

const it_ = { id: "u-it", email: "it@x.co", staffId: "s-it", role: "it", roleName: "IT", permissions: permissionsOf("it"), isOwner: false, isSales: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("API_KEY_PEPPER", "test-pepper-test-pepper-test-pepper");
});

describe("Jarvis keys carry their maker's permissions", () => {
  it("every tool names a known permission", () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_PERMISSION[name], name).toBeDefined();
      for (const p of TOOL_PERMISSION[name]) expect(isPermission(p), `${name}: ${p}`).toBe(true);
    }
  });

  it("an owner key runs everything; a scoped key only its tools; a key without permissions nothing", async () => {
    expect(toolAllowed("issue_refund", apiContext("k", null, "all"))).toBe(true);
    expect(toolAllowed("get_system_health", apiContext("k", null, ["system"]))).toBe(true);
    expect(toolAllowed("issue_refund", apiContext("k", null, ["system"]))).toBe(false);
    expect(toolAllowed("get_system_health", apiContext("k"))).toBe(false);
    await expect(callTool("issue_refund", {}, apiContext("k", null, ["system"]))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a staff key works only while its maker is enabled, and only with what they still hold", async () => {
    expect(await keyPermissions({ scoped: false, permissions: [], createdByStaffId: null })).toBe("all");
    h.staffMember.findUnique.mockResolvedValueOnce({ roleKey: "it", status: "disabled" });
    expect(await keyPermissions({ scoped: true, permissions: ["system"], createdByStaffId: "s-it" })).toBeNull();
    h.staffMember.findUnique.mockResolvedValueOnce(null);
    expect(await keyPermissions({ scoped: true, permissions: ["system"], createdByStaffId: "gone" })).toBeNull();
    // Their role lost "ai" since the key was made: the key loses it too.
    h.staffMember.findUnique.mockResolvedValueOnce({ roleKey: "marketing", status: "active" });
    expect(await keyPermissions({ scoped: true, permissions: ["ai", "content"], createdByStaffId: "s1" })).toEqual(["content"]);
  });

  it("a staff member's key is saved scoped to their permissions; the owner's is not", async () => {
    h.adminApiKey.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "k1", ...data }));
    await createAdminKey(consoleContext(), { name: "Ops" }, it_);
    expect(h.adminApiKey.create.mock.calls[0][0].data).toMatchObject({ scoped: true, permissions: permissionsOf("it"), createdByStaffId: "s-it" });
    await createAdminKey(consoleContext(), { name: "Owner" });
    expect(h.adminApiKey.create.mock.calls[1][0].data).toMatchObject({ scoped: false, createdByStaffId: null });
  });

  it("staff cannot rotate (and so take over) a key someone else made", async () => {
    h.adminApiKey.findUnique.mockResolvedValueOnce({ id: "k0", name: "Owner key", prefix: "bpj", ipAllowList: [], revokedAt: null, scoped: false, permissions: [], createdByStaffId: null });
    await expect(rotateAdminKey(consoleContext(), "k0", it_)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("managing staff needs the target's permissions", () => {
  it("IT cannot change or disable Finance (it lacks payments permissions)", async () => {
    h.staffMember.findUnique.mockResolvedValue({ id: "s-fin", email: "fin@x.co", roleKey: "finance", status: "active", userId: "u2" });
    await expect(changeStaffRole(consoleContext(), it_, "s-fin", "marketing")).rejects.toThrow(/permissions you do not have/);
    await expect(setStaffDisabled(consoleContext(), it_, "s-fin", true)).rejects.toThrow(/permissions you do not have/);
    expect(h.staffMember.update).not.toHaveBeenCalled();
  });
  it("the owner can", async () => {
    h.staffMember.findUnique.mockResolvedValue({ id: "s-fin", email: "fin@x.co", roleKey: "finance", status: "active", userId: "u2" });
    h.staffMember.update.mockResolvedValue({});
    const owner = { ...it_, staffId: null, email: "admin@bupulse.com", isOwner: true, permissions: ALL_PERMISSIONS };
    await expect(setStaffDisabled(consoleContext(), owner, "s-fin", true)).resolves.toMatchObject({ status: "disabled" });
  });
});

describe("invitations", () => {
  it("refuse an existing sign-in whose email was never confirmed", async () => {
    h.staffMember.findUnique.mockResolvedValue(null);
    h.queryRaw.mockResolvedValueOnce([{ id: "u9", confirmed: false }]);
    await expect(inviteStaff(consoleContext(), { ...it_, isOwner: true, permissions: ALL_PERMISSIONS }, { email: "new@x.co", roleKey: "support" })).rejects.toThrow(/never confirmed/);
  });
});

describe("referrals", () => {
  it("never give a company to the agent who signed it up themselves", async () => {
    h.staffMember.findUnique.mockResolvedValue({ id: "s1", status: "active", roleKey: "sales_agent", userId: "u-agent", email: "agent@x.co" });
    expect(await assignReferral({ businessId: "b1", userId: "u-agent", code: "K7Q2A" })).toBeNull();
    expect(await assignReferral({ businessId: "b1", userId: "u-other", email: "Agent@X.co", code: "K7Q2A" })).toBeNull();
    expect(h.business.updateMany).not.toHaveBeenCalled();
  });
});

describe("Kigali months", () => {
  it("a payment at 01:00 Kigali on the 1st is in the new month", () => {
    expect(kigaliMonthOf(new Date("2026-10-31T23:00:00Z"))).toBe("2026-11");
    expect(kigaliMonthOf(new Date("2026-10-31T21:59:00Z"))).toBe("2026-10");
    expect(kigaliMonthRange("2026-11").start.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(kigaliDayStart(new Date("2026-10-18T21:30:00Z")).toISOString()).toBe("2026-10-17T22:00:00.000Z");
  });
});

describe("admin code limits", () => {
  it("count the email per address, so a stranger elsewhere cannot lock the owner out", async () => {
    await publicLimited("adminCode", "admin@bupulse.com", "203.0.113.1");
    await publicLimited("adminCode", "admin@bupulse.com", "198.51.100.2");
    const keys = (h.rateLimit.mock.calls as unknown as [string][]).map((c) => c[0]).filter((k) => k.includes(":email:"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
