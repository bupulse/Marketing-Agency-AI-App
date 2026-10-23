import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { writeAudit } from "@/lib/admin/audit";
import { isAdminEmail } from "@/lib/admin/auth";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { supportAppUrl } from "./alerts";
import { DEPARTMENT_KEYS, type DepartmentKey } from "./contract";
import { broadcast } from "./realtime";
import { clearSupportSettingsCache, SUPPORT_SETTINGS_KEY, supportSettingsSchema, type SupportSettings } from "./settings";

// Support agents and departments, for Admin -> Live chat (sc-app builds the pages; these are the server side). Every
// change is audited. Agents are separate from admin staff: an ADMIN_EMAILS address cannot be an agent, and an agent's
// account never opens the admin console. Locking takes effect at once: the next API call is refused, the sessions are
// ended and the open app gets agent.force_logout.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AgentAdminView = {
  id: string;
  email: string;
  name: string;
  role: "AGENT" | "SUPERVISOR";
  status: string; // invited | active | locked
  availability: string;
  maxChats: number;
  departments: DepartmentKey[];
  lastSeenAt: string | null;
  createdAt: string;
};

export type DepartmentView = { key: DepartmentKey; name: string; agents: number };

const viewSelect = { id: true, email: true, name: true, role: true, status: true, availability: true, maxChats: true, lastSeenAt: true, createdAt: true, departments: { select: { department: { select: { key: true } } } } } as const;

function toView(a: { id: string; email: string; name: string; role: "AGENT" | "SUPERVISOR"; status: string; availability: string; maxChats: number; lastSeenAt: Date | null; createdAt: Date; departments: { department: { key: string } }[] }): AgentAdminView {
  return { ...a, departments: a.departments.map((d) => d.department.key as DepartmentKey), lastSeenAt: a.lastSeenAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() };
}

export async function listSupportAgents(): Promise<AgentAdminView[]> {
  const rows = await prisma.supportAgent.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], select: viewSelect });
  return rows.map(toView);
}

export async function listSupportDepartments(): Promise<DepartmentView[]> {
  const rows = await prisma.supportDepartment.findMany({ orderBy: { sort: "asc" }, select: { key: true, name: true, _count: { select: { agents: true } } } });
  return rows.map((d) => ({ key: d.key as DepartmentKey, name: d.name, agents: d._count.agents }));
}

async function departmentIds(keys: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(keys)].filter((k): k is DepartmentKey => (DEPARTMENT_KEYS as readonly string[]).includes(k));
  const rows = await prisma.supportDepartment.findMany({ where: { key: { in: wanted } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * The agent's sign-in: kept if it exists (confirmed), else created confirmed without a password. The invitation link
 * (a one-time password-reset token) lets them choose a password; the support app then has them add an authenticator.
 */
async function inviteLink(email: string, name: string): Promise<string> {
  const [hit] = await prisma.$queryRaw<{ id: string; confirmed: boolean }[]>`SELECT id, email_confirmed_at IS NOT NULL AS confirmed FROM auth.users WHERE lower(email) = ${email} LIMIT 1`;
  if (hit && !hit.confirmed) throw new AdminError("conflict", "That address has a BuPulse sign-in that was never confirmed. Ask them to confirm their email first, then invite them again.");
  const admin = createAdminClient();
  if (!hit) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name, support_agent: true } });
    if ((created.error && created.error.code !== "email_exists") || (!created.error && !created.data.user)) {
      await logError(created.error ?? new Error("createUser returned no user"), { source: "support.agent.invite" });
      throw new AdminError("unavailable", "The sign-in could not be created. Nothing was changed.");
    }
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new AdminError("unavailable", "The invitation link could not be made. Try again.");
  return supportAppUrl(`/setup?token_hash=${encodeURIComponent(hash)}&type=recovery`);
}

async function sendInvite(email: string, name: string, link: string): Promise<boolean> {
  try {
    const { html, text } = renderEmail({
      heading: "You were added to BuPulse support",
      intro: `Hi ${name}, you can now answer BuPulse's support chats. Open the link to choose your password, then add an authenticator app (Microsoft Authenticator, Google Authenticator or 1Password): the support app asks for its 6-digit code at every sign-in. The link works once and for 24 hours.`,
      button: { label: "Set up my account", url: link },
      footer: "If you were not expecting this email, you can ignore it.",
    });
    return await sendEmail({ to: email, subject: "You were added to BuPulse support", html, text });
  } catch (error) {
    await logError(error, { source: "support.agent.invite.email" });
    return false;
  }
}

export async function inviteSupportAgent(ctx: AdminContext, input: { email: string; name: string; role?: "AGENT" | "SUPERVISOR"; departments?: string[]; maxChats?: number }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 80);
  if (!EMAIL.test(email) || email.length > 254) throw new AdminError("invalid", "Enter a valid email address.");
  if (!name) throw new AdminError("invalid", "Enter the agent's name.");
  if (isAdminEmail(email)) throw new AdminError("conflict", "That address is the owner's admin account. Agents need their own address.");
  if (await prisma.supportAgent.findUnique({ where: { email }, select: { id: true } })) throw new AdminError("conflict", "That person is already a support agent.");
  const link = await inviteLink(email, name);
  const deps = await departmentIds(input.departments ?? []);
  const agent = await prisma.$transaction(async (tx) => {
    const row = await tx.supportAgent.create({
      data: { email, name, role: input.role ?? "AGENT", maxChats: Math.min(Math.max(input.maxChats ?? 5, 1), 50), invitedBy: ctx.actor, departments: { create: deps.map((departmentId) => ({ departmentId })) } },
      select: { id: true },
    });
    await writeAudit(tx, ctx, "invite_support_agent", `support_agent:${row.id}`, null, { email, name, role: input.role ?? "AGENT", departments: input.departments ?? [] });
    return row;
  });
  return { id: agent.id, emailed: await sendInvite(email, name, link) };
}

/** A new invitation link for an agent who has not finished setting up (or lost their password). */
export async function resendSupportInvite(ctx: AdminContext, id: string) {
  const agent = await prisma.supportAgent.findUnique({ where: { id }, select: { id: true, email: true, name: true, status: true } });
  if (!agent) throw new AdminError("not_found", "No support agent with that id.");
  if (agent.status === "locked") throw new AdminError("conflict", "Unlock the agent first.");
  const link = await inviteLink(agent.email, agent.name);
  await writeAudit(prisma, ctx, "resend_support_invite", `support_agent:${id}`, null, null);
  return { id, emailed: await sendInvite(agent.email, agent.name, link) };
}

export async function updateSupportAgent(ctx: AdminContext, id: string, input: { name?: string; role?: "AGENT" | "SUPERVISOR"; departments?: string[]; maxChats?: number }) {
  const before = await prisma.supportAgent.findUnique({ where: { id }, select: viewSelect });
  if (!before) throw new AdminError("not_found", "No support agent with that id.");
  const deps = input.departments ? await departmentIds(input.departments) : null;
  await prisma.$transaction(async (tx) => {
    await tx.supportAgent.update({
      where: { id },
      data: {
        ...(input.name?.trim() ? { name: input.name.trim().slice(0, 80) } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.maxChats ? { maxChats: Math.min(Math.max(input.maxChats, 1), 50) } : {}),
      },
    });
    if (deps) {
      await tx.supportAgentDepartment.deleteMany({ where: { agentId: id } });
      if (deps.length) await tx.supportAgentDepartment.createMany({ data: deps.map((departmentId) => ({ agentId: id, departmentId })) });
    }
    await writeAudit(tx, ctx, "update_support_agent", `support_agent:${id}`, toView(before), input);
  });
  return toView((await prisma.supportAgent.findUniqueOrThrow({ where: { id }, select: viewSelect })));
}

/** Locked: refused on the next call, sessions ended, the app told to sign out. Their open chats go back to waiting. */
export async function setSupportAgentLocked(ctx: AdminContext, id: string, locked: boolean) {
  const agent = await prisma.supportAgent.findUnique({ where: { id }, select: { id: true, status: true, userId: true } });
  if (!agent) throw new AdminError("not_found", "No support agent with that id.");
  const status = locked ? "locked" : agent.userId ? "active" : "invited";
  if (agent.status === status) return { id, status };
  await prisma.$transaction(async (tx) => {
    await tx.supportAgent.update({ where: { id }, data: { status, lockedAt: locked ? new Date() : null, ...(locked ? { availability: "offline" } : {}) } });
    if (locked) await tx.supportConversation.updateMany({ where: { assigneeId: id, status: { in: ["OPEN", "WAITING", "PENDING"] } }, data: { assigneeId: null, status: "WAITING", waitingSince: new Date() } });
    await writeAudit(tx, ctx, locked ? "lock_support_agent" : "unlock_support_agent", `support_agent:${id}`, { status: agent.status }, { status });
  });
  if (locked) {
    if (agent.userId) await prisma.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${agent.userId}::uuid`.catch((error) => logError(error, { source: "support.agent.lock" }));
    await broadcast({ type: "agent.force_logout", agentId: id }, { agent: id });
  }
  return { id, status };
}

/** Removes an agent (locked first). Their messages stay, shown without a name. */
export async function removeSupportAgent(ctx: AdminContext, id: string) {
  const agent = await prisma.supportAgent.findUnique({ where: { id }, select: { id: true, email: true, status: true } });
  if (!agent) throw new AdminError("not_found", "No support agent with that id.");
  if (agent.status !== "locked" && agent.status !== "invited") throw new AdminError("conflict", "Lock the agent first, then remove them.");
  await prisma.$transaction(async (tx) => {
    await tx.supportAgent.delete({ where: { id } });
    await writeAudit(tx, ctx, "remove_support_agent", `support_agent:${id}`, { email: agent.email }, null);
  });
  return { id };
}

export async function renameSupportDepartment(ctx: AdminContext, key: string, name: string) {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new AdminError("invalid", "Enter a name.");
  const before = await prisma.supportDepartment.findUnique({ where: { key }, select: { name: true } });
  if (!before) throw new AdminError("not_found", "No department with that key.");
  await prisma.$transaction(async (tx) => {
    await tx.supportDepartment.update({ where: { key }, data: { name: clean } });
    await writeAudit(tx, ctx, "rename_support_department", `support_department:${key}`, before, { name: clean });
  });
  return { key, name: clean };
}

/** Admin -> Live chat saves the team hours, greetings, AI rules and WhatsApp number here (one AdminSetting row). */
export async function saveSupportSettings(ctx: AdminContext, value: SupportSettings) {
  const parsed = supportSettingsSchema.safeParse(value);
  if (!parsed.success) throw new AdminError("invalid", parsed.error.issues[0]?.message ?? "These settings are not valid.");
  const before = await prisma.adminSetting.findUnique({ where: { key: SUPPORT_SETTINGS_KEY }, select: { value: true } });
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.upsert({ where: { key: SUPPORT_SETTINGS_KEY }, create: { key: SUPPORT_SETTINGS_KEY, value: parsed.data }, update: { value: parsed.data } });
    await writeAudit(tx, ctx, "save_support_settings", SUPPORT_SETTINGS_KEY, before?.value ?? null, parsed.data);
  });
  clearSupportSettingsCache();
  return parsed.data;
}
