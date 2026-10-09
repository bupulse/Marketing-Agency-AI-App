import { beforeEach, describe, expect, it, vi } from "vitest";

// requireActiveUser/checkActiveUser put the signed-in person into their company: `id` is the company account
// (Business.userId), `actorId` is the person. The role gate throws before any action body runs.

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  ensureAccount: vi.fn(),
  resolveCompany: vi.fn(),
  userFind: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/account", () => ({ ensureAccount: m.ensureAccount }));
vi.mock("@/lib/team/company", () => ({ resolveCompany: m.resolveCompany }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: m.userFind } } }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));

import { checkActiveUser, requireActiveUser, requirePersonalUser } from "@/lib/auth/require-user";
import { ForbiddenError } from "@/lib/team/roles";

const company = (role: string, extra: object = {}) => ({ actorId: "member-1", role, businessId: "biz1", ownerId: "owner-1", ownerDeleting: false, ownerSuspended: false, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue({ id: "member-1", email: "m@example.com" });
  m.ensureAccount.mockResolvedValue(true);
  m.userFind.mockResolvedValue({ deletionScheduledFor: null, suspendedAt: null });
  m.resolveCompany.mockResolvedValue(company("MEMBER"));
});

describe("company subject", () => {
  it("gives a teammate the company account's id and keeps their own as actorId", async () => {
    const check = await checkActiveUser();
    expect(check).toMatchObject({ status: "ok", user: { id: "owner-1", actorId: "member-1", role: "MEMBER", businessId: "biz1", email: "m@example.com" } });
  });

  it("requirePersonalUser keeps the person's own id for login-level things", async () => {
    expect((await requirePersonalUser()).id).toBe("member-1");
  });

  it("locks a teammate out while the company owner's deletion is pending, or the company is suspended", async () => {
    m.resolveCompany.mockResolvedValue(company("MEMBER", { ownerDeleting: true }));
    expect(await checkActiveUser()).toEqual({ status: "locked" });
    m.resolveCompany.mockResolvedValue(company("MEMBER", { ownerSuspended: true }));
    expect(await checkActiveUser()).toEqual({ status: "suspended" });
  });

  it("does not let a signed-out visitor through", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    expect(await checkActiveUser()).toEqual({ status: "signed_out" });
  });
});

describe("role gate", () => {
  it("lets a Member do content work but refuses billing, channels, connectors, webhooks, widget, settings and team", async () => {
    await expect(requireActiveUser("content")).resolves.toMatchObject({ role: "MEMBER" });
    for (const p of ["billing", "channels", "connectors", "webhooks", "widget", "settings", "team", "company", "autopilotSettings"] as const) {
      // Default: a friendly page, whatever shape the action returns
      await expect(requireActiveUser(p)).rejects.toThrow(`redirect:/dashboard/no-access?need=${p}`);
      // Callers that show the message inline ask for the error instead
      await expect(requireActiveUser(p, "throw")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("lets an Admin manage the team and channels but not billing or the company", async () => {
    m.resolveCompany.mockResolvedValue(company("ADMIN"));
    await expect(requireActiveUser("team")).resolves.toBeTruthy();
    await expect(requireActiveUser("channels")).resolves.toBeTruthy();
    await expect(requireActiveUser("billing", "throw")).rejects.toThrow("Ask your company owner to do this.");
    await expect(requireActiveUser("company")).rejects.toThrow("redirect:/dashboard/no-access?need=company");
  });

  it("lets the Owner do everything", async () => {
    m.resolveCompany.mockResolvedValue(company("OWNER"));
    for (const p of ["billing", "company", "team", "channels", "settings"] as const) await expect(requireActiveUser(p)).resolves.toBeTruthy();
  });
});
