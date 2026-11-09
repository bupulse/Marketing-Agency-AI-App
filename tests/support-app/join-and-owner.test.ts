import { beforeEach, describe, expect, it, vi } from "vitest";

// Support dashboard (docs/SUPPORT_DASHBOARD.md, owner 9 November 2026): staff ask to join and wait for approval;
// admin@bupulse.com gets its supervisor row with the admin console's own sign-in.

const m = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    agents: [] as Record<string, unknown>[],
    staff: null as null | { id: string },
    authUser: null as null | { id: string },
    links: [] as { agentId: string; departmentId: string }[],
    audit: [] as { action: string; target: string | null; before?: unknown; after?: unknown }[],
    generateLink: fn(async (args: { type: string; email: string }) => ({ data: { user: { id: "new-user" }, properties: { hashed_token: `hash_${args.type}_0123456789` } }, error: null })),
    deleteUser: fn(async () => ({ error: null })),
    sendEmail: fn<(e: { to: string; subject?: string; text: string }) => Promise<boolean>>(async () => true),
  };
});

vi.mock("@/lib/errors", () => ({ logError: vi.fn(), redact: (v: unknown) => v }));
vi.mock("@/lib/publishing/email", () => ({ sendEmail: m.sendEmail, renderEmail: (a: { intro: string; button?: { url: string } }) => ({ html: a.intro, text: `${a.intro}\n${a.button?.url ?? ""}` }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { generateLink: m.generateLink, deleteUser: m.deleteUser } } }) }));
vi.mock("@/lib/admin/auth", () => ({
  can: (i: { permissions: string[] }, p: string) => i.permissions.includes(p),
  isAdminEmail: (e: string) => ["admin@bupulse.com", "other-admin@bupulse.com"].includes(e),
  adminEmails: () => ["admin@bupulse.com", "other-admin@bupulse.com"],
}));
vi.mock("@/lib/db", () => {
  const match = (a: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => a[k] === v);
  const audit = { create: async ({ data }: { data: { action: string; target: string | null; before?: unknown; after?: unknown } }) => void m.audit.push(data) };
  const supportAgent = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => m.agents.find((a) => (where.id ? a.id === where.id : a.email === where.email)) ?? null,
    findMany: async ({ where }: { where: { status: string } }) => m.agents.filter((a) => a.status === where.status).map((a) => ({ ...a, createdAt: new Date("2026-11-09T08:00:00Z") })),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (m.agents.some((a) => a.email === data.email)) throw new Error("unique");
      const row = { id: `ag${m.agents.length + 1}`, userId: null, ...data };
      m.agents.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(m.agents.find((a) => a.id === where.id)!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = m.agents.filter((a) => match(a, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = m.agents.length;
      m.agents = m.agents.filter((a) => !match(a, where));
      return { count: before - m.agents.length };
    },
  };
  const supportAgentDepartment = { deleteMany: async () => ({ count: 0 }), createMany: async ({ data }: { data: { agentId: string; departmentId: string }[] }) => { m.links.push(...data); return { count: data.length }; } };
  const tx = { supportAgent, auditLog: audit, supportAgentDepartment };
  return {
    prisma: {
      ...tx,
      staffMember: { findUnique: async () => m.staff },
      supportDepartment: { findMany: async ({ where }: { where?: { key?: { in: string[] } } } = {}) => ["sales", "technical", "billing", "creators"].filter((k) => !where?.key || where.key.in.includes(k)).map((key) => ({ key, id: `d-${key}` })), createMany: async () => ({}) },
      $queryRaw: async () => (m.authUser ? [m.authUser] : []),
      $transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
});

import { answerJoinRequest, approveJoinRequest, declineJoinRequest, inviteAgent, listJoinRequests, requestToJoin } from "@/lib/support/agents";
import { ensureOwnerAgent, isSupportOwnerEmail } from "@/lib/support/owner";
import { canSeeChatStats, canSeeMonitoring, canSeeVisitorAnalytics } from "@/lib/support/roles";
import type { AdminIdentity } from "@/lib/admin/auth";

const ctx = { actor: "support:admin@bupulse.com", ip: null, viaApi: false };

beforeEach(() => {
  m.agents = [];
  m.staff = null;
  m.authUser = null;
  m.audit = [];
  m.links = [];
  vi.stubEnv("SUPPORT_APP_URL", "https://support.bupulse.com");
  for (const f of [m.generateLink, m.deleteUser, m.sendEmail]) f.mockClear();
});

describe("asking to join", () => {
  it("records a pending request (agent or technical, never supervisor) and tells every admin address", async () => {
    await requestToJoin({ name: "  Aline U. ", email: " Aline@Example.COM ", role: "TECH" });
    await requestToJoin({ name: "Bob K", email: "bob@example.com", role: "SUPERVISOR" });
    expect(m.agents).toMatchObject([
      { email: "aline@example.com", name: "Aline U.", role: "TECH", status: "pending", invitedBy: "self:join" },
      { email: "bob@example.com", role: "AGENT", status: "pending" },
    ]);
    expect(m.sendEmail.mock.calls.map(([e]) => e.to)).toEqual(["admin@bupulse.com", "other-admin@bupulse.com", "admin@bupulse.com", "other-admin@bupulse.com"]);
    expect(m.generateLink).not.toHaveBeenCalled(); // nothing can sign in yet
    expect(await listJoinRequests()).toHaveLength(2);
  });

  it("never reveals or touches a taken address: admin, staff, an agent or a client sign-in", async () => {
    await requestToJoin({ name: "X", email: "admin@bupulse.com", role: "AGENT" }).catch(() => undefined);
    await requestToJoin({ name: "Xx", email: "admin@bupulse.com", role: "AGENT" });
    m.staff = { id: "st1" };
    await requestToJoin({ name: "Staff", email: "staff@example.com", role: "AGENT" });
    m.staff = null;
    m.agents.push({ id: "agX", email: "jean@example.com", status: "active" });
    await requestToJoin({ name: "Jean", email: "jean@example.com", role: "AGENT" });
    m.authUser = { id: "client" };
    await requestToJoin({ name: "Client", email: "client@example.com", role: "AGENT" });
    expect(m.agents).toHaveLength(1);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("approving sends the usual invite and makes the row invited; declining removes it; each answers once", async () => {
    await requestToJoin({ name: "Aline U.", email: "aline@example.com", role: "AGENT" });
    m.sendEmail.mockClear();
    const r = await approveJoinRequest(ctx, "ag1");
    expect(r).toEqual({ id: "ag1", emailed: true });
    expect(m.agents[0]).toMatchObject({ status: "invited", invitedBy: ctx.actor });
    expect(m.links.map((l) => l.departmentId)).toEqual(["d-sales", "d-technical", "d-billing", "d-creators"]); // every department until narrowed
    expect(m.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: "invite", email: "aline@example.com" }));
    expect(m.sendEmail.mock.calls[0][0].text).toContain("https://support.bupulse.com/accept?token_hash=");
    await expect(approveJoinRequest(ctx, "ag1")).rejects.toThrow(/already answered/);
    await requestToJoin({ name: "Bob K", email: "bob@example.com", role: "AGENT" });
    await declineJoinRequest(ctx, "ag2");
    expect(m.agents.map((a) => a.email)).toEqual(["aline@example.com"]);
    expect(m.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["support_agent_join_request", "support_agent_join_approve", "support_agent_join_decline"]));
  });

  it("Admin -> Live chat needs the Live chat permission; inviting a pending address approves it (one row per address)", async () => {
    await requestToJoin({ name: "Aline U.", email: "aline@example.com", role: "AGENT" });
    await expect(answerJoinRequest(ctx, { permissions: ["overview"] } as unknown as AdminIdentity, "ag1", true)).rejects.toThrow(/Live chat permission/);
    const r = await inviteAgent(ctx, { permissions: ["liveChat"] } as unknown as AdminIdentity, { email: "aline@example.com", name: "Aline", role: "TECH", departments: ["technical"] });
    expect(r.id).toBe("ag1");
    expect(m.agents).toHaveLength(1);
    expect(m.agents[0]).toMatchObject({ status: "invited", role: "TECH", name: "Aline" });
    expect(m.links).toEqual([{ agentId: "ag1", departmentId: "d-technical" }]);
  });
});

describe("admin@bupulse.com in the support app", () => {
  it("is the only owner: admin@bupulse.com while it is an admin address", () => {
    expect(isSupportOwnerEmail(" Admin@BuPulse.com ")).toBe(true);
    expect(isSupportOwnerEmail("other-admin@bupulse.com")).toBe(false);
    expect(isSupportOwnerEmail("agent@example.com")).toBe(false);
  });

  it("gets a supervisor row linked to its sign-in on the first visit, repaired if needed, never for others", async () => {
    await ensureOwnerAgent({ id: "u-admin", email: "admin@bupulse.com", emailConfirmed: true });
    expect(m.agents).toEqual([expect.objectContaining({ email: "admin@bupulse.com", role: "SUPERVISOR", status: "active", userId: "u-admin" })]);
    Object.assign(m.agents[0], { role: "AGENT", status: "invited" });
    await ensureOwnerAgent({ id: "u-admin", email: "admin@bupulse.com", emailConfirmed: true });
    expect(m.agents[0]).toMatchObject({ role: "SUPERVISOR", status: "active" });
    await ensureOwnerAgent({ id: "u-other", email: "admin@bupulse.com", emailConfirmed: true }); // someone else's sign-in
    expect(m.agents[0].userId).toBe("u-admin");
    await ensureOwnerAgent({ id: "u2", email: "other-admin@bupulse.com", emailConfirmed: true });
    await ensureOwnerAgent({ id: "u3", email: "admin@bupulse.com", emailConfirmed: false });
    expect(m.agents).toHaveLength(1);
  });
});

describe("who sees what", () => {
  it("agents see visitors; technical staff and supervisors also see the server; only supervisors see chat stats", () => {
    expect([canSeeVisitorAnalytics("AGENT"), canSeeMonitoring("AGENT"), canSeeChatStats("AGENT")]).toEqual([true, false, false]);
    expect([canSeeVisitorAnalytics("TECH"), canSeeMonitoring("TECH"), canSeeChatStats("TECH")]).toEqual([true, true, false]);
    expect([canSeeVisitorAnalytics("SUPERVISOR"), canSeeMonitoring("SUPERVISOR"), canSeeChatStats("SUPERVISOR")]).toEqual([true, true, true]);
  });
});
