import { beforeEach, describe, expect, it, vi } from "vitest";

// Team page: the admin adds a member with a password; they add an authenticator at their first sign-in without an
// emailed code (lib/support/setup-grant.ts). Owner request, 10 November 2026.

const m = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    agents: [] as Record<string, unknown>[],
    authUser: null as null | { id: string },
    audit: [] as { action: string; target: string | null; after?: unknown }[],
    createUser: fn(async (args: Record<string, unknown>) => ({ data: { user: { id: "user-new", ...args } }, error: null as null | { code?: string } })),
    updateUserById: fn(async () => ({ error: null as null | { code?: string } })),
    deleteUser: fn(async () => ({ error: null })),
    listFactors: fn(async () => ({ data: { factors: [{ id: "f1" }] }, error: null })),
    deleteFactor: fn(async () => ({ error: null })),
    executeRaw: fn(async () => 1),
    deptCreate: fn(async () => ({})),
  };
});

vi.mock("@/lib/errors", () => ({ logError: vi.fn(), redact: (v: unknown) => v }));
vi.mock("@/lib/publishing/email", () => ({ sendEmail: vi.fn(), renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { createUser: m.createUser, updateUserById: m.updateUserById, deleteUser: m.deleteUser, mfa: { listFactors: m.listFactors, deleteFactor: m.deleteFactor } } } }),
}));
vi.mock("@/lib/admin/auth", () => ({ can: () => true, isAdminEmail: (e: string) => e === "admin@bupulse.com", adminEmails: () => ["admin@bupulse.com"] }));
vi.mock("@/lib/support/owner", () => ({ isSupportOwnerEmail: (e: string) => e === "admin@bupulse.com" }));
vi.mock("@/lib/db", () => {
  const audit = { create: async ({ data }: { data: { action: string; target: string | null; after?: unknown } }) => void m.audit.push(data) };
  const supportAgent = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => m.agents.find((a) => (where.id ? a.id === where.id : a.email === where.email)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `ag${m.agents.length + 1}`, departments: [], ...data };
      m.agents.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(m.agents.find((a) => a.id === where.id)!, data),
  };
  const tx = { supportAgent, auditLog: audit, supportAgentDepartment: { deleteMany: async () => ({}), createMany: m.deptCreate } };
  return {
    prisma: {
      ...tx,
      staffMember: { findUnique: async () => null },
      supportDepartment: { findMany: async () => [{ key: "sales", id: "d-sales" }, { key: "technical", id: "d-tech" }, { key: "billing", id: "d-bill" }, { key: "creators", id: "d-cre" }], createMany: async () => ({}) },
      $queryRaw: async () => (m.authUser ? [m.authUser] : []),
      $executeRaw: m.executeRaw,
      $transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
});

import { adminSetAgentPassword, createAgentWithPassword, requireNewAgentAuthenticator } from "@/lib/support/agents";
import { SETUP_GRANT_KEY, hasSetupGrant, setupGrantUntil, suggestPassword } from "@/lib/support/setup-grant";

const ctx = { actor: "support:admin@bupulse.com", ip: null, viaApi: false };
const input = { name: "Aline Uwase", email: "Aline@Example.com", role: "AGENT", departments: [] as string[], password: "Kigali2026ok" };

beforeEach(() => {
  m.agents = [];
  m.authUser = null;
  m.audit = [];
  for (const f of [m.createUser, m.updateUserById, m.deleteUser, m.listFactors, m.deleteFactor, m.executeRaw, m.deptCreate]) f.mockClear();
});

describe("the one-time authenticator setup permission", () => {
  it("is valid for 7 days and only while in the future", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const until = setupGrantUntil(now);
    expect(until).toBe("2026-11-17T12:00:00.000Z");
    expect(hasSetupGrant({ [SETUP_GRANT_KEY]: until }, now)).toBe(true);
    expect(hasSetupGrant({ [SETUP_GRANT_KEY]: until }, new Date("2026-11-18T00:00:00Z"))).toBe(false);
    expect(hasSetupGrant({ [SETUP_GRANT_KEY]: null }, now)).toBe(false);
    expect(hasSetupGrant({}, now)).toBe(false);
    expect(hasSetupGrant(null, now)).toBe(false);
  });

  it("suggests 14-character passwords with a lower-case letter, a capital and a digit, nothing easy to mix up", () => {
    let i = 0;
    const p = suggestPassword((n) => (i++ * 7) % n);
    expect(p).toHaveLength(14);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[2-9]/);
    expect(p).not.toMatch(/[01OIl]/);
  });
});

describe("adding a team member with a password", () => {
  it("creates a confirmed sign-in with the password and the setup permission, and an agent row linked to it", async () => {
    const r = await createAgentWithPassword(ctx, input);
    expect(r.email).toBe("aline@example.com");
    const args = m.createUser.mock.calls[0][0] as { email: string; password: string; email_confirm: boolean; app_metadata: Record<string, string> };
    expect(args).toMatchObject({ email: "aline@example.com", password: "Kigali2026ok", email_confirm: true });
    expect(hasSetupGrant(args.app_metadata)).toBe(true);
    expect(m.agents[0]).toMatchObject({ email: "aline@example.com", name: "Aline Uwase", role: "AGENT", status: "invited", userId: "user-new" });
    // Every department until narrowed in Admin -> Live chat.
    expect((m.deptCreate.mock.calls[0] as unknown as [{ data: unknown[] }])[0].data).toHaveLength(4);
    expect(m.audit.at(-1)?.action).toBe("support_agent_create_with_password");
    expect(JSON.stringify(m.audit)).not.toContain("Kigali2026ok");
  });

  it("refuses short or weak passwords before creating anything", async () => {
    await expect(createAgentWithPassword(ctx, { ...input, password: "short1" })).rejects.toThrow();
    await expect(createAgentWithPassword(ctx, { ...input, password: "onlyletterslong" })).rejects.toThrow();
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("never turns an admin address, an existing agent or another BuPulse sign-in into a team member", async () => {
    await expect(createAgentWithPassword(ctx, { ...input, email: "admin@bupulse.com" })).rejects.toThrow(/admin console/);
    m.agents.push({ id: "ag9", email: "aline@example.com", status: "active" });
    await expect(createAgentWithPassword(ctx, input)).rejects.toThrow(/already in the support team/);
    m.agents = [];
    m.authUser = { id: "client" };
    await expect(createAgentWithPassword(ctx, input)).rejects.toThrow(/already signs in to BuPulse/);
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("turns someone who asked to join into this account (one row per address)", async () => {
    m.agents.push({ id: "ag1", email: "aline@example.com", name: "Aline", role: "AGENT", status: "pending" });
    await createAgentWithPassword(ctx, input);
    expect(m.agents).toHaveLength(1);
    expect(m.agents[0]).toMatchObject({ status: "invited", userId: "user-new" });
  });

  it("removes the new sign-in when saving the row fails", async () => {
    m.deptCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(createAgentWithPassword(ctx, input)).rejects.toThrow("db down");
    expect(m.deleteUser).toHaveBeenCalledWith("user-new");
  });
});

describe("managing a member", () => {
  beforeEach(() => {
    m.agents.push({ id: "ag1", email: "aline@example.com", name: "Aline", status: "active", userId: "u1", departments: [] });
  });

  it("sets a new password and signs them out everywhere", async () => {
    await adminSetAgentPassword(ctx, "ag1", "NewPassword99");
    expect(m.updateUserById).toHaveBeenCalledWith("u1", { password: "NewPassword99" });
    expect(m.executeRaw).toHaveBeenCalled();
    expect(JSON.stringify(m.audit)).not.toContain("NewPassword99");
  });

  it("asks for a new authenticator: removes the old one, grants setup once, signs them out", async () => {
    const r = await requireNewAgentAuthenticator(ctx, "ag1");
    expect(r.removed).toBe(1);
    const [, attrs] = m.updateUserById.mock.calls[0] as unknown as [string, { app_metadata: Record<string, string> }];
    expect(hasSetupGrant(attrs.app_metadata)).toBe(true);
    expect(m.executeRaw).toHaveBeenCalled();
  });

  it("never manages admin@bupulse.com or someone with no sign-in", async () => {
    m.agents.push({ id: "own", email: "admin@bupulse.com", name: "Admin", status: "active", userId: "uo", departments: [] }, { id: "inv", email: "x@example.com", name: "X", status: "invited", userId: null, departments: [] });
    await expect(adminSetAgentPassword(ctx, "own", "NewPassword99")).rejects.toThrow(/admin console/);
    await expect(requireNewAgentAuthenticator(ctx, "inv")).rejects.toThrow(/no sign-in/);
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
});
