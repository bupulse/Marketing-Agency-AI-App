import "server-only";
// Support agents and departments (Admin -> Live chat, docs/SUPPORT_CHAT.md "Support app and Admin"). Every change is
// audited. Agents get their own sign-in: an invite email sets the password, then they add an authenticator app.
// Rules:
// - only the owner or staff with the liveChat permission change anything;
// - an address is lower-cased, used once, and never the owner's, a staff member's or one that already signs in to BuPulse;
// - locking (and resetting the authenticator) signs the agent out everywhere at once.
// Invite and reset links are emailed only: never returned, logged or written to the audit log.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/admin/audit";
import { can, isAdminEmail, type AdminIdentity } from "@/lib/admin/auth";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { DEPARTMENT_KEYS, type DepartmentKey } from "./contract";
import { forceLogout } from "./realtime";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SUPPORT_ROLES = ["AGENT", "SUPERVISOR"] as const;
export type SupportRoleKey = (typeof SUPPORT_ROLES)[number];

export const DEFAULT_DEPARTMENTS: Record<DepartmentKey, string> = { sales: "Sales", technical: "Technical help", billing: "Billing", creators: "Creators" };

export type AgentAdminView = {
  id: string;
  email: string;
  name: string;
  role: SupportRoleKey;
  status: string;
  availability: string;
  maxChats: number;
  departments: DepartmentKey[];
  /** The agent has a verified authenticator app (null when it could not be read). */
  authenticator: boolean | null;
  lastSeenAt: string | null;
  createdAt: string;
};
export type DepartmentView = { key: DepartmentKey; name: string; sort: number; agents: number };

export type AgentInput = { email?: string; name: string; role: string; departments: string[]; maxChats?: number | string };

/** Where agents open the support app: SUPPORT_APP_URL (https://support.bupulse.com once its domain is set), else <site>/support. */
export function supportAppUrl(): string {
  return (process.env.SUPPORT_APP_URL || `${publicSiteUrl()}/support`).replace(/\/$/, "");
}

function assertLiveChat(actor: Pick<AdminIdentity, "permissions">) {
  if (!can(actor, "liveChat")) throw new AdminError("forbidden", "You need the Live chat permission for this.");
}

export function normalizeAgentEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new AdminError("invalid", "Enter a valid work email.");
  return email;
}

function cleanAgent(input: AgentInput): { name: string; role: SupportRoleKey; departments: DepartmentKey[]; maxChats: number } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new AdminError("invalid", "Enter the agent's name (2 to 80 characters).");
  const role = SUPPORT_ROLES.find((r) => r === input.role);
  if (!role) throw new AdminError("invalid", "Pick a role: Agent or Supervisor.");
  const departments = [...new Set(input.departments)].filter((d): d is DepartmentKey => (DEPARTMENT_KEYS as readonly string[]).includes(d));
  if (role === "AGENT" && departments.length === 0) throw new AdminError("invalid", "Tick at least one department: it decides which chats reach the agent.");
  const maxChats = input.maxChats === undefined || input.maxChats === "" ? 5 : Number(input.maxChats);
  if (!Number.isInteger(maxChats) || maxChats < 1 || maxChats > 20) throw new AdminError("invalid", "Chats at once: a number from 1 to 20.");
  return { name, role, departments, maxChats };
}

/** The four departments always exist (they route chats); a missing row is made with its default name. */
export async function ensureDepartments(): Promise<void> {
  const rows = await prisma.supportDepartment.findMany({ select: { key: true } });
  const missing = DEPARTMENT_KEYS.filter((k) => !rows.some((r) => r.key === k));
  if (missing.length) await prisma.supportDepartment.createMany({ data: missing.map((key) => ({ key, name: DEFAULT_DEPARTMENTS[key], sort: DEPARTMENT_KEYS.indexOf(key) })), skipDuplicates: true });
}

async function departmentIds(keys: DepartmentKey[]): Promise<string[]> {
  if (!keys.length) return [];
  await ensureDepartments();
  const rows = await prisma.supportDepartment.findMany({ where: { key: { in: keys } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Who has a verified authenticator app, read from Supabase Auth's own table (one query for the whole list). */
async function verifiedTotpUsers(userIds: string[]): Promise<Set<string> | null> {
  if (!userIds.length) return new Set();
  try {
    const rows = await prisma.$queryRaw<{ user_id: string }[]>`SELECT DISTINCT user_id::text AS user_id FROM auth.mfa_factors WHERE factor_type = 'totp' AND status = 'verified' AND user_id = ANY(${userIds}::uuid[])`;
    return new Set(rows.map((r) => r.user_id));
  } catch {
    return null;
  }
}

export async function listAgents(): Promise<AgentAdminView[]> {
  const rows = await prisma.supportAgent.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { departments: { select: { department: { select: { key: true } } } } } });
  const totp = await verifiedTotpUsers(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    availability: r.availability,
    maxChats: r.maxChats,
    departments: r.departments.map((d) => d.department.key as DepartmentKey).filter((k) => (DEPARTMENT_KEYS as readonly string[]).includes(k)),
    authenticator: !r.userId ? false : totp ? totp.has(r.userId) : null,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listDepartments(): Promise<DepartmentView[]> {
  await ensureDepartments();
  const rows = await prisma.supportDepartment.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], include: { _count: { select: { agents: true } } } });
  return rows.filter((r) => (DEPARTMENT_KEYS as readonly string[]).includes(r.key)).map((r) => ({ key: r.key as DepartmentKey, name: r.name, sort: r.sort, agents: r._count.agents }));
}

/** A one-time link to the invite (or new-password) page. Our own page verifies it, so a mail scanner's visit cannot use it up. */
async function emailLink(email: string, kind: "invite" | "recovery", page: "accept" | "reset", userData?: Record<string, unknown>): Promise<{ url: string; userId: string } | { error: { code?: string } }> {
  const auth = createAdminClient().auth.admin;
  const { data, error } = kind === "invite" ? await auth.generateLink({ type: "invite", email, options: { data: userData } }) : await auth.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token || !data.user) return { error: { code: error?.code } };
  const url = `${supportAppUrl()}/${page}?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${kind}`;
  return { url, userId: data.user.id };
}

async function sendInviteEmail(email: string, name: string, url: string): Promise<boolean> {
  try {
    const { html, text } = renderEmail({
      heading: "You were added to BuPulse Support",
      intro: `Hi ${name}, you can now answer BuPulse's support chats. Open the link to choose your password, then add an authenticator app (Microsoft Authenticator, Google Authenticator or 1Password): the support app asks for its 6-digit code at every sign-in. The link works once; if it has expired, ask your supervisor for a new invite.`,
      button: { label: "Choose my password", url },
      footer: "If you were not expecting this email, you can ignore it.",
    });
    return await sendEmail({ to: email, subject: "Your BuPulse Support account", html, text });
  } catch (error) {
    await logError(error, { source: "support.agents.invite_email" });
    return false;
  }
}

async function sendResetEmail(email: string, name: string, url: string): Promise<boolean> {
  try {
    const { html, text } = renderEmail({
      heading: "Choose a new password",
      intro: `Hi ${name}, someone asked to reset your BuPulse Support password. Open the link to choose a new one. You still need your authenticator app's 6-digit code to sign in. The link works once.`,
      button: { label: "Choose a new password", url },
      footer: "If you did not ask for this, ignore this email: your password stays the same.",
    });
    return await sendEmail({ to: email, subject: "Reset your BuPulse Support password", html, text });
  } catch (error) {
    await logError(error, { source: "support.agents.reset_email" });
    return false;
  }
}

/**
 * Ends every session of a sign-in at once (their refresh tokens go with them). The support app's guard refuses a locked
 * agent on the very next page or API call, so the access token they still hold opens nothing.
 */
export async function signOutEverywhere(userId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${userId}::uuid`;
}

export async function inviteAgent(ctx: AdminContext, actor: AdminIdentity, input: AgentInput): Promise<{ id: string; emailed: boolean }> {
  assertLiveChat(actor);
  const email = normalizeAgentEmail(input.email ?? "");
  const clean = cleanAgent(input);
  // Agents never use the console's accounts: the owner and staff keep their admin sign-in apart.
  if (isAdminEmail(email) || (await prisma.staffMember.findUnique({ where: { email }, select: { id: true } }))) {
    throw new AdminError("conflict", "That address signs in to the admin console. Give the agent a separate work address.");
  }
  if (await prisma.supportAgent.findUnique({ where: { email }, select: { id: true } })) throw new AdminError("conflict", "That address is already a support agent.");
  // A client's or creator's sign-in is not turned into an agent (the password would change for their BuPulse account too).
  const [existing] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${email} LIMIT 1`;
  if (existing) throw new AdminError("conflict", "That address already signs in to BuPulse (a client or creator account). Use a separate work address for support.");
  const ids = await departmentIds(clean.departments);
  const link = await emailLink(email, "invite", "accept", { full_name: clean.name, support_agent: true });
  if ("error" in link) {
    await logError(new Error("generateLink(invite) failed"), { source: "support.agents.invite", code: link.error.code });
    throw new AdminError("unavailable", "The sign-in could not be created. Nothing was changed.");
  }
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const row = await tx.supportAgent.create({ data: { email, name: clean.name, role: clean.role, maxChats: clean.maxChats, status: "invited", invitedBy: ctx.actor, departments: { create: ids.map((departmentId) => ({ departmentId })) } } });
      await writeAudit(tx, ctx, "support_agent_invite", `support_agent:${row.id}`, null, { email, name: clean.name, role: clean.role, departments: clean.departments, maxChats: clean.maxChats });
      return row.id;
    });
  } catch (error) {
    // The sign-in made for the invite goes too, so the address can be invited again.
    await createAdminClient().auth.admin.deleteUser(link.userId).catch(() => undefined);
    throw error;
  }
  return { id, emailed: await sendInviteEmail(email, clean.name, link.url) };
}

async function agentById(id: string) {
  const agent = await prisma.supportAgent.findUnique({ where: { id }, include: { departments: { select: { department: { select: { key: true } } } } } });
  if (!agent) throw new AdminError("not_found", "No support agent with that id.");
  return agent;
}

export async function updateAgent(ctx: AdminContext, actor: AdminIdentity, id: string, input: AgentInput): Promise<{ id: string }> {
  assertLiveChat(actor);
  const agent = await agentById(id);
  const clean = cleanAgent(input);
  const ids = await departmentIds(clean.departments);
  const before = { name: agent.name, role: agent.role, maxChats: agent.maxChats, departments: agent.departments.map((d) => d.department.key) };
  await prisma.$transaction(async (tx) => {
    await tx.supportAgentDepartment.deleteMany({ where: { agentId: id } });
    await tx.supportAgent.update({ where: { id }, data: { name: clean.name, role: clean.role, maxChats: clean.maxChats, departments: { create: ids.map((departmentId) => ({ departmentId })) } } });
    await writeAudit(tx, ctx, "support_agent_update", `support_agent:${id}`, before, { name: clean.name, role: clean.role, maxChats: clean.maxChats, departments: clean.departments });
  });
  return { id };
}

/** Locked: signed out everywhere now, and refused from the next click. Unlocked: back to active (or invited, if never signed in). */
export async function setAgentLocked(ctx: AdminContext, actor: AdminIdentity, id: string, locked: boolean): Promise<{ id: string; status: string }> {
  assertLiveChat(actor);
  const agent = await agentById(id);
  const status = locked ? "locked" : agent.userId ? "active" : "invited";
  if (agent.status === status) return { id, status };
  await prisma.$transaction(async (tx) => {
    await tx.supportAgent.update({ where: { id }, data: locked ? { status, lockedAt: new Date(), availability: "offline" } : { status, lockedAt: null } });
    await writeAudit(tx, ctx, locked ? "support_agent_lock" : "support_agent_unlock", `support_agent:${id}`, { status: agent.status }, { status });
  });
  if (locked) {
    if (agent.userId) await signOutEverywhere(agent.userId);
    // Open support-app tabs keep their socket until the token expires: tell them to go to the sign-in page now.
    await forceLogout(id).catch((e) => logError(e, { source: "support.agent.forceLogout", level: "warn" }));
  }
  return { id, status };
}

/** A new invite link (the old one stops working). Only for agents who have not finished signing up. */
export async function resendAgentInvite(ctx: AdminContext, actor: AdminIdentity, id: string): Promise<{ id: string; emailed: boolean }> {
  assertLiveChat(actor);
  const agent = await agentById(id);
  if (agent.status === "locked") throw new AdminError("conflict", "Unlock the agent first.");
  if (agent.status !== "invited") throw new AdminError("conflict", "This agent already signed in. To change their password they use Forgot password on the sign-in page.");
  let link = await emailLink(agent.email, "invite", "accept", { full_name: agent.name, support_agent: true });
  // The invite was opened already (the sign-in is confirmed): a new-password link does the same job.
  if ("error" in link) link = await emailLink(agent.email, "recovery", "accept");
  if ("error" in link) {
    await logError(new Error("generateLink(resend) failed"), { source: "support.agents.resend", code: link.error.code });
    throw new AdminError("unavailable", "The invite could not be made. Please try again in a minute.");
  }
  await writeAudit(prisma, ctx, "support_agent_resend_invite", `support_agent:${id}`, null, { email: agent.email });
  return { id, emailed: await sendInviteEmail(agent.email, agent.name, link.url) };
}

/** Lost phone: removes their authenticator app and signs them out. At the next sign-in they add one again (with an emailed code). */
export async function resetAgentAuthenticator(ctx: AdminContext, actor: AdminIdentity, id: string): Promise<{ id: string; removed: number }> {
  assertLiveChat(actor);
  const agent = await agentById(id);
  if (!agent.userId) throw new AdminError("conflict", "This agent has not signed in yet, so there is no authenticator to reset.");
  const mfa = createAdminClient().auth.admin.mfa;
  const { data, error } = await mfa.listFactors({ userId: agent.userId });
  if (error) throw new AdminError("unavailable", "The authenticator could not be read. Nothing was changed.");
  let removed = 0;
  for (const f of data?.factors ?? []) {
    const { error: e } = await mfa.deleteFactor({ userId: agent.userId, id: f.id });
    if (!e) removed++;
  }
  await writeAudit(prisma, ctx, "support_agent_reset_2fa", `support_agent:${id}`, null, { removed });
  await signOutEverywhere(agent.userId);
  return { id, removed };
}

export async function renameDepartment(ctx: AdminContext, actor: AdminIdentity, key: string, rawName: string): Promise<{ key: DepartmentKey }> {
  assertLiveChat(actor);
  const dep = DEPARTMENT_KEYS.find((k) => k === key);
  if (!dep) throw new AdminError("invalid", "Unknown department.");
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) throw new AdminError("invalid", "Name the department (2 to 40 characters).");
  await ensureDepartments();
  const before = await prisma.supportDepartment.findUnique({ where: { key: dep }, select: { name: true } });
  if (before?.name === name) return { key: dep };
  await prisma.$transaction(async (tx) => {
    await tx.supportDepartment.update({ where: { key: dep }, data: { name } });
    await writeAudit(tx, ctx, "support_department_rename", `support_department:${dep}`, { name: before?.name ?? null }, { name });
  });
  return { key: dep };
}

/**
 * "Forgot password": a new-password link for an agent who has signed in before and is not locked. Anyone else gets
 * nothing, and the caller answers every address the same way.
 */
export async function sendAgentPasswordReset(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const agent = await prisma.supportAgent.findUnique({ where: { email }, select: { name: true, status: true, userId: true } }).catch(() => null);
  if (!agent || agent.status !== "active" || !agent.userId) return;
  const link = await emailLink(email, "recovery", "reset");
  if ("error" in link) {
    await logError(new Error("generateLink(recovery) failed"), { source: "support.agents.reset", code: link.error.code });
    return;
  }
  await sendResetEmail(email, agent.name, link.url);
}
