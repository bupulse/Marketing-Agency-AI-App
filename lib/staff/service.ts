import "server-only";
// Staff and roles (Admin -> Organisation). Every change is audited. Rules that stop someone giving themselves more:
// - only the owner may make someone Owner or change an Owner;
// - nobody changes, disables or removes their own membership;
// - someone who is not the owner may only give roles (and build custom roles) whose permissions they hold themselves.
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { ensureRefCode } from "@/lib/sales/referral";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/admin/audit";
import { isAdminEmail, type AdminIdentity } from "@/lib/admin/auth";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { BUILT_IN_ROLES, OWNER_ROLE, builtInRole, isPermission, isSalesRole, permissionsOf, type Permission } from "./permissions";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StaffView = { id: string; email: string; name: string | null; phone: string | null; roleKey: string; roleName: string; status: string; refCode: string | null; lastSignInAt: string | null; createdAt: string; invitedBy: string };
export type RoleView = { key: string; name: string; description: string; permissions: Permission[]; builtIn: boolean; members: number };

export async function listStaff(): Promise<StaffView[]> {
  const [rows, roles] = await Promise.all([prisma.staffMember.findMany({ orderBy: [{ status: "asc" }, { createdAt: "asc" }] }), prisma.staffRole.findMany({ select: { key: true, name: true } })]);
  const roleName = (key: string) => builtInRole(key)?.name ?? roles.find((r) => r.key === key)?.name ?? key;
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, phone: r.phone, roleKey: r.roleKey, roleName: roleName(r.roleKey), status: r.status, refCode: r.refCode, lastSignInAt: r.lastSignInAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), invitedBy: r.invitedBy }));
}

export async function listRoles(): Promise<RoleView[]> {
  const [custom, counts] = await Promise.all([prisma.staffRole.findMany({ orderBy: { name: "asc" } }), prisma.staffMember.groupBy({ by: ["roleKey"], where: { status: { not: "disabled" } }, _count: { _all: true } })]);
  const members = (key: string) => counts.find((c) => c.roleKey === key)?._count._all ?? 0;
  return [
    ...BUILT_IN_ROLES.map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: [...r.permissions], builtIn: true, members: members(r.key) })),
    ...custom.map((r) => ({ key: r.key, name: r.name, description: "Custom role.", permissions: r.permissions.filter(isPermission), builtIn: false, members: members(r.key) })),
  ];
}

async function rolePermissions(roleKey: string): Promise<Permission[] | null> {
  if (builtInRole(roleKey)) return permissionsOf(roleKey);
  const row = await prisma.staffRole.findUnique({ where: { key: roleKey }, select: { key: true, permissions: true } });
  return row ? permissionsOf(roleKey, [row]) : null;
}

/** Refuses giving a role the actor could not hold themselves (the owner can give anything). */
export function assertCanGrant(actor: Pick<AdminIdentity, "isOwner" | "permissions">, roleKey: string, permissions: readonly Permission[]) {
  if (roleKey === OWNER_ROLE && !actor.isOwner) throw new AdminError("forbidden", "Only the owner can make someone Owner.");
  if (actor.isOwner) return;
  const extra = permissions.filter((p) => !actor.permissions.includes(p));
  if (extra.length) throw new AdminError("forbidden", `You cannot give permissions you do not have yourself (${extra.join(", ")}).`);
}

function assertNotSelf(actor: Pick<AdminIdentity, "staffId" | "email">, member: { id: string; email: string }) {
  if (actor.staffId === member.id || actor.email === member.email) throw new AdminError("forbidden", "You cannot change your own membership. Ask the owner or another staff manager.");
}

function assertNotOwnerTarget(actor: Pick<AdminIdentity, "isOwner">, member: { roleKey: string }) {
  if (member.roleKey === OWNER_ROLE && !actor.isOwner) throw new AdminError("forbidden", "Only the owner can change an Owner.");
}

/** The person's sign-in: kept if it exists (Google or password), else created confirmed and without a password. */
async function ensureSignIn(email: string, name: string | null): Promise<"existing" | "created"> {
  const [hit] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${email} LIMIT 1`;
  if (hit) return "existing";
  const created = await createAdminClient().auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name ?? undefined, staff: true } });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists") return "existing";
    await logError(created.error ?? new Error("createUser returned no user"), { source: "staff.invite" });
    throw new AdminError("unavailable", "The sign-in could not be created. Nothing was changed.");
  }
  return "created";
}

/** The invitation: a link to choose a password (new sign-in) or a plain pointer to /admin (existing), and the second step. */
async function sendInvite(email: string, name: string | null, roleName: string, signIn: "existing" | "created"): Promise<boolean> {
  try {
    let url = `${siteUrl()}/admin`;
    if (signIn === "created") {
      const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
      const hash = data?.properties?.hashed_token;
      if (error || !hash) throw error ?? new Error("generateLink returned no token");
      url = `${siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=recovery&next=/reset-password`;
    }
    const { html, text } = renderEmail({
      heading: "You were added to the BuPulse team",
      intro: `${name ? `Hi ${name}, ` : ""}you can now use the BuPulse admin console as ${roleName}. ${signIn === "created" ? "Choose your password first (or sign in with Google using this address)." : "Sign in with your usual BuPulse account (Google or password)."} Then open ${siteUrl()}/admin and add an authenticator app (Microsoft Authenticator, Google Authenticator or 1Password): the console asks for its 6-digit code at every sign-in.`,
      button: { label: signIn === "created" ? "Choose my password" : "Open the console", url },
      footer: "If you were not expecting this email, you can ignore it.",
    });
    return await sendEmail({ to: email, subject: "You were added to the BuPulse team", html, text });
  } catch (error) {
    await logError(error, { source: "staff.invite.email" });
    return false;
  }
}

export async function inviteStaff(ctx: AdminContext, actor: AdminIdentity, input: { email: string; name?: string; phone?: string; roleKey: string }) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new AdminError("invalid", "Enter a valid email address.");
  if (isAdminEmail(email)) throw new AdminError("conflict", "That address is the owner's: it already has every permission.");
  const permissions = await rolePermissions(input.roleKey);
  if (!permissions) throw new AdminError("invalid", "Pick a role.");
  assertCanGrant(actor, input.roleKey, permissions);
  const name = input.name?.trim().slice(0, 80) || null;
  const phone = input.phone?.trim().slice(0, 30) || null;
  if (await prisma.staffMember.findUnique({ where: { email }, select: { id: true } })) throw new AdminError("conflict", "That person is already on the staff list.");
  const signIn = await ensureSignIn(email, name);
  const member = await prisma.$transaction(async (tx) => {
    const row = await tx.staffMember.create({ data: { email, name, phone, roleKey: input.roleKey, status: "invited", invitedBy: ctx.actor } });
    await writeAudit(tx, ctx, "invite_staff", `staff:${row.id}`, null, { email, name, roleKey: input.roleKey });
    return row;
  });
  if (isSalesRole(input.roleKey, permissions)) await ensureRefCode(member.id).catch((error) => logError(error, { source: "staff.refcode" }));
  const roleName = builtInRole(input.roleKey)?.name ?? (await prisma.staffRole.findUnique({ where: { key: input.roleKey }, select: { name: true } }))?.name ?? input.roleKey;
  const emailed = await sendInvite(email, name, roleName, signIn);
  return { id: member.id, emailed };
}

export async function changeStaffRole(ctx: AdminContext, actor: AdminIdentity, id: string, roleKey: string) {
  const member = await prisma.staffMember.findUnique({ where: { id } });
  if (!member) throw new AdminError("not_found", "No staff member with that id.");
  assertNotSelf(actor, member);
  assertNotOwnerTarget(actor, member);
  const permissions = await rolePermissions(roleKey);
  if (!permissions) throw new AdminError("invalid", "Pick a role.");
  assertCanGrant(actor, roleKey, permissions);
  if (member.roleKey === roleKey) return { id, changed: false };
  await prisma.$transaction(async (tx) => {
    await tx.staffMember.update({ where: { id }, data: { roleKey } });
    await writeAudit(tx, ctx, "change_staff_role", `staff:${id}`, { roleKey: member.roleKey }, { roleKey });
  });
  if (isSalesRole(roleKey, permissions)) await ensureRefCode(id).catch((error) => logError(error, { source: "staff.refcode" }));
  return { id, changed: true };
}

/** Disabled: the next page or action refuses them (checked on every request). Their clients stay assigned until reassigned. */
export async function setStaffDisabled(ctx: AdminContext, actor: AdminIdentity, id: string, disabled: boolean) {
  const member = await prisma.staffMember.findUnique({ where: { id } });
  if (!member) throw new AdminError("not_found", "No staff member with that id.");
  assertNotSelf(actor, member);
  assertNotOwnerTarget(actor, member);
  const status = disabled ? "disabled" : member.userId ? "active" : "invited";
  if (member.status === status) return { id, status };
  await prisma.$transaction(async (tx) => {
    await tx.staffMember.update({ where: { id }, data: { status, disabledAt: disabled ? new Date() : null } });
    await writeAudit(tx, ctx, disabled ? "disable_staff" : "enable_staff", `staff:${id}`, { status: member.status }, { status });
  });
  return { id, status };
}

/** Removes a disabled member from the list. Their past sales stay in the assignment history (shown as former staff). */
export async function removeStaff(ctx: AdminContext, actor: AdminIdentity, id: string) {
  const member = await prisma.staffMember.findUnique({ where: { id } });
  if (!member) throw new AdminError("not_found", "No staff member with that id.");
  assertNotSelf(actor, member);
  assertNotOwnerTarget(actor, member);
  if (member.status !== "disabled") throw new AdminError("conflict", "Disable the person first, then remove them.");
  await prisma.$transaction(async (tx) => {
    await tx.staffMember.delete({ where: { id } });
    await writeAudit(tx, ctx, "remove_staff", `staff:${id}`, { email: member.email, roleKey: member.roleKey }, null);
  });
  return { id };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/** Adds a custom role, or changes one (`key`). Built-in roles cannot be edited. */
export async function saveCustomRole(ctx: AdminContext, actor: AdminIdentity, input: { key?: string; name: string; permissions: string[] }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 40) throw new AdminError("invalid", "Name the role (2 to 40 characters).");
  const permissions = [...new Set(input.permissions.filter(isPermission))];
  if (permissions.length === 0) throw new AdminError("invalid", "Tick at least one permission.");
  if (BUILT_IN_ROLES.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new AdminError("conflict", "That is the name of a built-in role.");
  assertCanGrant(actor, input.key ?? "custom", permissions);
  if (input.key) {
    if (builtInRole(input.key)) throw new AdminError("forbidden", "Built-in roles cannot be changed; make a custom role instead.");
    const before = await prisma.staffRole.findUnique({ where: { key: input.key } });
    if (!before) throw new AdminError("not_found", "No role with that key.");
    // Changing the role you hold yourself would be giving yourself permissions.
    if (actor.staffId && (await prisma.staffMember.findUnique({ where: { id: actor.staffId }, select: { roleKey: true } }))?.roleKey === input.key) {
      throw new AdminError("forbidden", "You cannot change your own role.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.staffRole.update({ where: { key: input.key }, data: { name, permissions } });
      await writeAudit(tx, ctx, "update_staff_role", `role:${input.key}`, { name: before.name, permissions: before.permissions }, { name, permissions });
    });
    return { key: input.key };
  }
  const key = `custom_${slug(name) || "role"}`;
  if (await prisma.staffRole.findUnique({ where: { key }, select: { id: true } })) throw new AdminError("conflict", "A role with that name already exists.");
  await prisma.$transaction(async (tx) => {
    await tx.staffRole.create({ data: { key, name, permissions, createdBy: ctx.actor } });
    await writeAudit(tx, ctx, "create_staff_role", `role:${key}`, null, { name, permissions });
  });
  return { key };
}

export async function deleteCustomRole(ctx: AdminContext, actor: AdminIdentity, key: string) {
  if (builtInRole(key)) throw new AdminError("forbidden", "Built-in roles cannot be deleted.");
  const role = await prisma.staffRole.findUnique({ where: { key } });
  if (!role) throw new AdminError("not_found", "No role with that key.");
  assertCanGrant(actor, key, role.permissions.filter(isPermission));
  const used = await prisma.staffMember.count({ where: { roleKey: key } });
  if (used > 0) throw new AdminError("conflict", `${used} ${used === 1 ? "person has" : "people have"} this role. Give them another role first.`);
  await prisma.$transaction(async (tx) => {
    await tx.staffRole.delete({ where: { key } });
    await writeAudit(tx, ctx, "delete_staff_role", `role:${key}`, { name: role.name, permissions: role.permissions }, null);
  });
  return { key };
}
