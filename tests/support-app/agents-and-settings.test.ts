import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    agents: [] as Record<string, unknown>[],
    staff: null as null | { id: string },
    authUser: null as null | { id: string },
    setting: null as null | { value: unknown },
    audit: [] as { action: string; target: string | null; before?: unknown; after?: unknown }[],
    executeRaw: fn(async () => 1),
    generateLink: fn(async (args: { type: string; email: string }) => ({ data: { user: { id: "new-user" }, properties: { hashed_token: `hash_${args.type}_0123456789` } }, error: null })),
    deleteUser: fn(async () => ({ error: null })),
    listFactors: fn(async () => ({ data: { factors: [{ id: "f1" }, { id: "f2" }] }, error: null })),
    deleteFactor: fn(async () => ({ error: null })),
    sendEmail: fn<(e: { to: string; text: string }) => Promise<boolean>>(async () => true),
    upsert: fn(async () => ({})),
    releaseChats: fn(async () => ({ count: 2 })),
  };
});

vi.mock("@/lib/errors", () => ({ logError: vi.fn(), redact: (v: unknown) => v }));
vi.mock("@/lib/publishing/email", () => ({ sendEmail: m.sendEmail, renderEmail: (a: { intro: string; button?: { url: string } }) => ({ html: a.intro, text: `${a.intro}\n${a.button?.url ?? ""}` }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { generateLink: m.generateLink, deleteUser: m.deleteUser, mfa: { listFactors: m.listFactors, deleteFactor: m.deleteFactor } } } }) }));
vi.mock("@/lib/admin/auth", () => ({
  can: (i: { permissions: string[] }, p: string) => i.permissions.includes(p),
  isAdminEmail: (e: string) => e === "owner@bupulse.com",
}));
vi.mock("@/lib/db", () => {
  const audit = { create: async ({ data }: { data: { action: string; target: string | null; before?: unknown; after?: unknown } }) => void m.audit.push(data) };
  const supportAgent = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => m.agents.find((a) => (where.id ? a.id === where.id : a.email === where.email)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `ag${m.agents.length + 1}`, departments: [], userId: null, ...data };
      m.agents.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(m.agents.find((a) => a.id === where.id)!, data),
  };
  const supportConversation = { updateMany: m.releaseChats };
  const tx = { supportAgent, supportConversation, auditLog: audit, supportAgentDepartment: { deleteMany: async () => ({}) }, adminSetting: { upsert: m.upsert } };
  return {
    prisma: {
      ...tx,
      staffMember: { findUnique: async () => m.staff },
      supportDepartment: { findMany: async () => [{ key: "sales", id: "d-sales" }, { key: "technical", id: "d-tech" }, { key: "billing", id: "d-bill" }, { key: "creators", id: "d-cre" }], createMany: async () => ({}) },
      adminSetting: { findUnique: async () => m.setting, upsert: m.upsert },
      $queryRaw: async () => (m.authUser ? [m.authUser] : []),
      $executeRaw: m.executeRaw,
      $transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
});

import { inviteAgent, normalizeAgentEmail, resetAgentAuthenticator, resendAgentInvite, setAgentLocked, updateAgent } from "@/lib/support/agents";
import { DEFAULT_SUPPORT_SETTINGS, hoursSummary, saveSupportSettings, supportSettingsProblems, type SupportSettings } from "@/lib/support/settings";
import type { AdminIdentity } from "@/lib/admin/auth";

const ctx = { actor: "admin", ip: null, viaApi: false };
const owner = { permissions: ["liveChat"] } as unknown as AdminIdentity;
const noPerm = { permissions: ["overview", "system"] } as unknown as AdminIdentity;
const input = { email: "  Jean.M@Example.COM ", name: "Jean M.", role: "AGENT", departments: ["billing", "sales"] };

beforeEach(() => {
  m.agents = [];
  m.staff = null;
  m.authUser = null;
  m.setting = null;
  m.audit = [];
  vi.stubEnv("SUPPORT_APP_URL", "https://support.bupulse.com");
  for (const f of [m.executeRaw, m.generateLink, m.deleteUser, m.listFactors, m.deleteFactor, m.sendEmail, m.upsert, m.releaseChats]) f.mockClear();
});

describe("support agents (Admin -> Live chat)", () => {
  it("only the owner or staff with the Live chat permission can change agents", async () => {
    await expect(inviteAgent(ctx, noPerm, input)).rejects.toThrow(/Live chat permission/);
    m.agents.push({ id: "ag1", email: "a@example.com", name: "A", status: "active", userId: "u1", departments: [] });
    await expect(setAgentLocked(ctx, noPerm, "ag1", true)).rejects.toThrow(/Live chat permission/);
    await expect(resetAgentAuthenticator(ctx, noPerm, "ag1")).rejects.toThrow(/Live chat permission/);
    expect(m.executeRaw).not.toHaveBeenCalled();
  });
  it("invites with a lower-cased address, audits it, and emails our own accept link (never returned)", async () => {
    const out = await inviteAgent(ctx, owner, input);
    expect(out).toEqual({ id: "ag1", emailed: true });
    expect(m.agents[0]).toMatchObject({ email: "jean.m@example.com", status: "invited", role: "AGENT", invitedBy: "admin" });
    expect(m.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: "invite", email: "jean.m@example.com" }));
    const mail = m.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("jean.m@example.com");
    expect(mail.text).toContain("https://support.bupulse.com/accept?token_hash=hash_invite_0123456789&type=invite");
    expect(m.audit).toHaveLength(1);
    expect(m.audit[0]).toMatchObject({ action: "support_agent_invite", target: "support_agent:ag1" });
    expect(JSON.stringify(m.audit)).not.toContain("hash_invite");
    expect(JSON.stringify(out)).not.toContain("hash_invite");
  });
  it("refuses duplicates, admin and staff addresses, and addresses that already sign in to BuPulse", async () => {
    await inviteAgent(ctx, owner, input);
    await expect(inviteAgent(ctx, owner, { ...input, email: "JEAN.M@example.com" })).rejects.toThrow(/already a support agent/);
    await expect(inviteAgent(ctx, owner, { ...input, email: "owner@bupulse.com" })).rejects.toThrow(/admin console/);
    m.staff = { id: "s1" };
    await expect(inviteAgent(ctx, owner, { ...input, email: "staff@example.com" })).rejects.toThrow(/admin console/);
    m.staff = null;
    m.authUser = { id: "client" };
    await expect(inviteAgent(ctx, owner, { ...input, email: "client@example.com" })).rejects.toThrow(/already signs in to BuPulse/);
    expect(m.generateLink).toHaveBeenCalledTimes(1);
  });
  it("checks the form: email, name, role, a department for agents, chats at once", async () => {
    expect(() => normalizeAgentEmail("not-an-email")).toThrow(/valid work email/);
    await expect(inviteAgent(ctx, owner, { ...input, name: "J" })).rejects.toThrow(/name/);
    await expect(inviteAgent(ctx, owner, { ...input, role: "ADMIN" })).rejects.toThrow(/Agent or Supervisor/);
    await expect(inviteAgent(ctx, owner, { ...input, departments: [] })).rejects.toThrow(/at least one department/);
    await expect(inviteAgent(ctx, owner, { ...input, role: "SUPERVISOR", departments: [], maxChats: "50" })).rejects.toThrow(/1 to 20/);
    await expect(inviteAgent(ctx, owner, { ...input, role: "SUPERVISOR", departments: [] })).resolves.toMatchObject({ emailed: true });
  });
  it("locking signs the agent out everywhere at once and is audited; unlocking makes them active again", async () => {
    m.agents.push({ id: "ag1", email: "a@example.com", name: "A", status: "active", userId: "11111111-1111-1111-1111-111111111111", departments: [] });
    await expect(setAgentLocked(ctx, owner, "ag1", true)).resolves.toEqual({ id: "ag1", status: "locked" });
    expect(m.agents[0]).toMatchObject({ status: "locked", availability: "offline" });
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
    expect(String((m.executeRaw.mock.calls[0] as unknown[])[0])).toContain("DELETE FROM auth.sessions");
    expect(m.audit.map((a) => a.action)).toEqual(["support_agent_lock"]);
    // Their open chats go back to Waiting, for someone else to take.
    expect(m.releaseChats).toHaveBeenCalledWith({ where: { assigneeId: "ag1", status: { in: ["OPEN", "WAITING"] } }, data: expect.objectContaining({ status: "WAITING", assigneeId: null }) });
    expect(m.audit[0].after).toMatchObject({ status: "locked", chatsBackToWaiting: 2 });
    await expect(setAgentLocked(ctx, owner, "ag1", false)).resolves.toEqual({ id: "ag1", status: "active" });
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
  });
  it("resets the authenticator: every factor removed, signed out, audited", async () => {
    m.agents.push({ id: "ag1", email: "a@example.com", name: "A", status: "active", userId: "u1", departments: [] });
    await expect(resetAgentAuthenticator(ctx, owner, "ag1")).resolves.toEqual({ id: "ag1", removed: 2 });
    expect(m.deleteFactor).toHaveBeenCalledTimes(2);
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
    expect(m.audit.map((a) => a.action)).toEqual(["support_agent_reset_2fa"]);
    m.agents.push({ id: "ag2", email: "b@example.com", name: "B", status: "invited", userId: null, departments: [] });
    await expect(resetAgentAuthenticator(ctx, owner, "ag2")).rejects.toThrow(/not signed in yet/);
  });
  it("resends an invite only to someone who has not finished signing up", async () => {
    m.agents.push({ id: "ag1", email: "a@example.com", name: "A", status: "active", userId: "u1", departments: [] });
    await expect(resendAgentInvite(ctx, owner, "ag1")).rejects.toThrow(/already signed in/);
    m.agents.push({ id: "ag2", email: "b@example.com", name: "B", status: "invited", userId: null, departments: [] });
    await expect(resendAgentInvite(ctx, owner, "ag2")).resolves.toEqual({ id: "ag2", emailed: true });
  });
  it("edits name, role, departments and chats at once, with the before and after in the audit log", async () => {
    m.agents.push({ id: "ag1", email: "a@example.com", name: "A B", role: "AGENT", maxChats: 5, status: "active", userId: "u1", departments: [{ department: { key: "sales" } }] });
    await updateAgent(ctx, owner, "ag1", { name: "A Bee", role: "SUPERVISOR", departments: ["technical"], maxChats: "8" });
    expect(m.audit[0]).toMatchObject({ action: "support_agent_update", before: { name: "A B", role: "AGENT", maxChats: 5, departments: ["sales"] }, after: { name: "A Bee", role: "SUPERVISOR", maxChats: 8, departments: ["technical"] } });
  });
});

describe("support settings", () => {
  const settings = (over: Partial<SupportSettings> = {}): SupportSettings => ({ ...structuredClone(DEFAULT_SUPPORT_SETTINGS), ...over });
  it("accepts the defaults", () => {
    expect(supportSettingsProblems(settings())).toEqual([]);
  });
  it("finds hours that end before they start, overlap or are not times", () => {
    expect(supportSettingsProblems(settings({ hours: { "1": [{ from: "20:00", to: "08:00" }] } }))[0]).toMatch(/Monday: 20:00 to 08:00 ends before it starts/);
    expect(supportSettingsProblems(settings({ hours: { "2": [{ from: "08:00", to: "13:00" }, { from: "12:00", to: "18:00" }] } }))[0]).toMatch(/Tuesday: two time ranges overlap/);
    expect(supportSettingsProblems(settings({ hours: { "3": [{ from: "25:00", to: "26:00" }] } }))[0]).toMatch(/Wednesday: use times/);
  });
  it("finds greeting pages without a slash, twice the same page, and a WhatsApp number without its country code", () => {
    const g = DEFAULT_SUPPORT_SETTINGS.greetings[0];
    expect(supportSettingsProblems(settings({ greetings: [{ ...g, path: "pricing" }] }))[0]).toMatch(/start with "\/"/);
    expect(supportSettingsProblems(settings({ greetings: [g, g] }))[0]).toMatch(/one greeting only/);
    expect(supportSettingsProblems(settings({ whatsapp: "0788000000" }))[0]).toMatch(/country code/);
  });
  it("saves with the Live chat permission only, audited with before and after", async () => {
    await expect(saveSupportSettings(ctx, noPerm, settings())).rejects.toThrow(/Live chat permission/);
    await expect(saveSupportSettings(ctx, owner, { ...settings(), aiEnabled: "yes" })).rejects.toThrow(/not valid/);
    await expect(saveSupportSettings(ctx, owner, settings({ whatsapp: "+250 788-000-000" }))).resolves.toMatchObject({ whatsapp: "+250788000000" });
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.audit[0]).toMatchObject({ action: "support_settings_save", target: "setting:support.settings", before: undefined });
  });
  it("sums up the team hours for the stats page", () => {
    expect(hoursSummary(DEFAULT_SUPPORT_SETTINGS)).toBe("Mon–Sat 08:00–20:00 Kigali");
    expect(hoursSummary({ hours: { "1": [{ from: "08:00", to: "17:00" }], "2": [{ from: "08:00", to: "17:00" }], "6": [{ from: "09:00", to: "13:00" }] } })).toBe("Mon–Tue 08:00–17:00, Sat 09:00–13:00 Kigali");
    expect(hoursSummary({ hours: {} })).toBe("no team hours set");
  });
});
