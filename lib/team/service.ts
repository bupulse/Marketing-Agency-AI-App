import "server-only";
import { prisma } from "@/lib/db";
import type { MemberRole } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlanLimits } from "@/lib/plan-catalog";
import { siteUrl } from "@/lib/auth/site-url";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { logError } from "@/lib/errors";
import { eraseTeammateLogin } from "@/lib/account-deletion";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/types";
import { assignableRoles, atLeast, isRole, type Role } from "./roles";

// Team management for one company: seats, invites, roles, removal and ownership transfer.
// Every function takes the acting person's company (from requireActiveUser) and checks the rule itself, so the same rules
// hold for the Settings page, the server actions and the tests. Business.userId (the company account) never changes:
// ownership moves as a role, so billing, usage and Storage paths stay where they are.

export type TeamErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "seats" | "expired" | "used" | "other_company";

export class TeamError extends Error {
  constructor(public code: TeamErrorCode, message: string) {
    super(message);
    this.name = "TeamError";
  }
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Seats by plan until a plan carries its own `seats` limit (plan builder). */
const FALLBACK_SEATS: Record<string, number> = { TRIAL: 1, STANDARD: 3, PRO: 10 };

/** The person acting: the signed-in user's company view (`requireActiveUser()` result has all of these). */
export type TeamActor = { actorId: string; id: string; role: Role; businessId: string; email?: string | null };

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---- tokens ---------------------------------------------------------------------------------------------------

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function hashToken(token: string): Promise<string> {
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
export function newInviteToken(): string {
  return [...globalThis.crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- seats ----------------------------------------------------------------------------------------------------

/** How many users the company's plan allows. */
export async function seatLimit(companyId: string): Promise<number> {
  const sub = await prisma.subscription.findUnique({ where: { userId: companyId }, select: { plan: true } });
  const plan = sub?.plan ?? "TRIAL";
  const seats = (await getPlanLimits(plan)).seats;
  return typeof seats === "number" && seats >= 1 ? Math.floor(seats) : (FALLBACK_SEATS[plan] ?? 1);
}

type Db = Pick<typeof prisma, "membership" | "invite">;

/** Members plus invitations still open: both hold a seat. */
export async function seatsUsed(businessId: string, now = new Date(), db: Db = prisma): Promise<{ members: number; pending: number }> {
  const [members, pending] = await Promise.all([
    db.membership.count({ where: { businessId } }),
    db.invite.count({ where: { businessId, acceptedAt: null, expiresAt: { gt: now } } }),
  ]);
  return { members, pending };
}

/**
 * Seats are counted and then used, so two requests could both see a free seat. Everything that takes a seat does so inside a
 * transaction that first takes this per-company lock; the second request waits, then counts again.
 */
export async function lockSeats(tx: Pick<typeof prisma, "$executeRaw">, businessId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`;
}

async function assertSeatFree(tx: Db, businessId: string, limit: number, replacing = 0) {
  const used = await seatsUsed(businessId, new Date(), tx);
  if (used.members + used.pending - replacing >= limit) {
    throw new TeamError("seats", `Your plan includes ${limit} ${limit === 1 ? "user" : "users"} and all are taken. Remove someone or cancel an invitation, or move to a bigger plan.`);
  }
}

/** Team changes are written to the same audit log as admin actions, under the company, with the person as actor. Emails are masked. */
const teamCtx = (actor: TeamActor): AdminContext => ({ actor: `user:${actor.actorId}`, ip: null, viaApi: false });
const mask = (email: string) => `${email.split("@")[0]?.slice(0, 1) ?? ""}***@${email.split("@")[1] ?? ""}`;
async function audit(db: Pick<typeof prisma, "auditLog">, actor: TeamActor, action: string, before: unknown, after: unknown) {
  await writeAudit(db, teamCtx(actor), action, `company:${actor.businessId}`, before, after);
}

// ---- reads ----------------------------------------------------------------------------------------------------

export async function listTeam(businessId: string, companyId: string) {
  const [members, invites, limit] = await Promise.all([
    prisma.membership.findMany({
      where: { businessId },
      orderBy: [{ createdAt: "asc" }],
      select: { userId: true, role: true, createdAt: true, user: { select: { email: true, name: true } } },
    }),
    prisma.invite.findMany({
      where: { businessId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
    seatLimit(companyId),
  ]);
  const now = Date.now();
  return {
    limit,
    members: members.map((m) => ({ userId: m.userId, role: m.role, email: m.user.email, name: m.user.name, joinedAt: m.createdAt, isCompanyAccount: m.userId === companyId })),
    invites: invites.map((i) => ({ ...i, expired: i.expiresAt.getTime() <= now })),
  };
}

// ---- invites --------------------------------------------------------------------------------------------------

function roleOf(value: unknown): Role {
  if (!isRole(value) || value === "OWNER") throw new TeamError("invalid", "Choose Admin or Member.");
  return value;
}

async function sendInviteEmail(args: { to: string; token: string; businessName: string; inviterName: string; role: Role }): Promise<boolean> {
  const url = `${siteUrl()}/invite/${args.token}`;
  const { html, text } = renderEmail({
    heading: `Join ${args.businessName} on BuPulse`,
    intro: `${args.inviterName} invited you to work with ${args.businessName} on BuPulse as ${args.role === "ADMIN" ? "an Admin" : "a Member"}. You will share the company's content, designs and leads.`,
    button: { label: "Accept invitation", url },
    footer: "This link works once and expires in 7 days. If you were not expecting it, you can ignore this email.",
  });
  return sendEmail({ to: args.to, subject: `${args.inviterName} invited you to ${args.businessName} on BuPulse`, html, text });
}

async function inviterName(actor: TeamActor) {
  const u = await prisma.user.findUnique({ where: { id: actor.actorId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || "A teammate";
}

/** An address that already has a BuPulse sign-in (a company, or a sign-up still unconfirmed) cannot join a second company in this version. */
async function addressTaken(email: string): Promise<boolean> {
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return true;
  const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM auth.users WHERE lower(email) = ${email} LIMIT 1`;
  return rows.length > 0;
}

export const ADDRESS_TAKEN =
  "That email already has a BuPulse account, and in this version a person can belong to one company only. Invite a different address.";

/** Creates an invitation (replacing an open one for the same address) and emails it. `sent` is false when the mail did not go out. */
export async function createInvite(actor: TeamActor, input: { email: string; role: string }) {
  if (!atLeast(actor.role, "ADMIN")) throw new TeamError("forbidden", "Ask your company owner or an admin to do this.");
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email) || email.length > 254) throw new TeamError("invalid", "Enter a valid email address.");
  const role = roleOf(input.role);
  if (!assignableRoles(actor.role).includes(role)) throw new TeamError("forbidden", "You cannot invite that role.");

  const already = await prisma.membership.findFirst({ where: { businessId: actor.businessId, user: { email } }, select: { userId: true } });
  if (already) throw new TeamError("conflict", "That person is already in your company.");
  if (await addressTaken(email)) throw new TeamError("other_company", ADDRESS_TAKEN);

  const limit = await seatLimit(actor.id);
  const token = newInviteToken();
  const data = { role, tokenHash: await hashToken(token), invitedBy: actor.actorId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
  const invite = await prisma.$transaction(async (tx) => {
    await lockSeats(tx, actor.businessId);
    const open = await tx.invite.findFirst({ where: { businessId: actor.businessId, email, acceptedAt: null }, select: { id: true, expiresAt: true } });
    await assertSeatFree(tx, actor.businessId, limit, open && open.expiresAt > new Date() ? 1 : 0);
    const row = open
      ? await tx.invite.update({ where: { id: open.id }, data })
      : await tx.invite.create({ data: { businessId: actor.businessId, email, ...data } });
    await audit(tx, actor, "team_invite", null, { invited: mask(email), role });
    return row;
  });

  const business = await prisma.business.findUnique({ where: { id: actor.businessId }, select: { name: true } });
  const sent = await sendInviteEmail({ to: email, token, businessName: business?.name ?? "a company", inviterName: await inviterName(actor), role });
  return { id: invite.id, email, role, sent, expiresAt: invite.expiresAt };
}

/** A fresh link for a pending invitation (the old link stops working). */
export async function resendInvite(actor: TeamActor, inviteId: string) {
  if (!atLeast(actor.role, "ADMIN")) throw new TeamError("forbidden", "Ask your company owner or an admin to do this.");
  const limit = await seatLimit(actor.id);
  const token = newInviteToken();
  const hash = await hashToken(token);
  const invite = await prisma.$transaction(async (tx) => {
    await lockSeats(tx, actor.businessId);
    const row = await tx.invite.findFirst({ where: { id: inviteId, businessId: actor.businessId, acceptedAt: null } });
    if (!row) throw new TeamError("not_found", "That invitation no longer exists.");
    // An expired invitation no longer holds a seat, so it needs a free one again.
    if (row.expiresAt <= new Date()) await assertSeatFree(tx, actor.businessId, limit);
    await tx.invite.update({ where: { id: row.id }, data: { tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedBy: actor.actorId } });
    return row;
  });
  const business = await prisma.business.findUnique({ where: { id: actor.businessId }, select: { name: true } });
  const sent = await sendInviteEmail({ to: invite.email, token, businessName: business?.name ?? "a company", inviterName: await inviterName(actor), role: invite.role });
  return { sent };
}

export async function cancelInvite(actor: TeamActor, inviteId: string) {
  if (!atLeast(actor.role, "ADMIN")) throw new TeamError("forbidden", "Ask your company owner or an admin to do this.");
  await prisma.$transaction(async (tx) => {
    const row = await tx.invite.findFirst({ where: { id: inviteId, businessId: actor.businessId, acceptedAt: null }, select: { email: true, role: true } });
    if (!row) throw new TeamError("not_found", "That invitation no longer exists.");
    await tx.invite.delete({ where: { id: inviteId } });
    await audit(tx, actor, "team_cancel_invite", { invited: mask(row.email), role: row.role }, null);
  });
}

// ---- accepting ------------------------------------------------------------------------------------------------

export type InvitePreview =
  | { status: "valid"; email: string; role: Role; businessName: string; inviterName: string | null }
  | { status: "expired" | "used" | "unknown" };

/** An invitation dies with its inviter's rights: removed, or no longer an Owner or Admin. (Open invites are also deleted at that moment.) */
async function inviterStillAllowed(businessId: string, inviterId: string | null): Promise<boolean> {
  if (!inviterId) return true;
  const m = await prisma.membership.findFirst({ where: { businessId, userId: inviterId }, select: { role: true } });
  return Boolean(m && atLeast(m.role, "ADMIN"));
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { status: "unknown" };
  const invite = await prisma.invite.findUnique({ where: { tokenHash: await hashToken(token) }, include: { business: { select: { name: true } } } });
  if (!invite) return { status: "unknown" };
  if (invite.acceptedAt) return { status: "used" };
  if (invite.expiresAt <= new Date()) return { status: "expired" };
  if (!(await inviterStillAllowed(invite.businessId, invite.invitedBy))) return { status: "unknown" };
  const inviter = invite.invitedBy ? await prisma.user.findUnique({ where: { id: invite.invitedBy }, select: { name: true, email: true } }) : null;
  return { status: "valid", email: invite.email, role: invite.role, businessName: invite.business.name, inviterName: inviter?.name?.trim() || inviter?.email || null };
}

/**
 * Accepts an invitation as a NEW person: creates their sign-in (already confirmed, because the link proves they own the
 * address), their profile and their membership in one go, and marks the invitation used. The caller signs them in with the
 * password afterwards. Someone who already has a BuPulse sign-in belongs to another company and cannot join (Stage 1).
 */
export async function acceptInvite(token: string, input: { name: string; password: string }): Promise<{ email: string }> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new TeamError("invalid", "Enter your name.");
  if (input.password.length < 8 || input.password.length > 128) throw new TeamError("invalid", "Use a password with at least 8 characters.");
  if (!/^[0-9a-f]{64}$/.test(token)) throw new TeamError("not_found", "This invitation link is not valid.");

  const invite = await prisma.invite.findUnique({ where: { tokenHash: await hashToken(token) }, include: { business: { select: { id: true, userId: true } } } });
  if (!invite) throw new TeamError("not_found", "This invitation link is not valid.");
  if (invite.acceptedAt) throw new TeamError("used", "This invitation was already used.");
  if (invite.expiresAt <= new Date()) throw new TeamError("expired", "This invitation has expired. Ask your company for a new one.");

  if (!(await inviterStillAllowed(invite.businessId, invite.invitedBy))) throw new TeamError("not_found", "This invitation is no longer valid. Ask your company for a new one.");
  // Two people opening the same link at once: the loser finds the address taken by the winner. That is "used", not "other
  // company". The winner's sign-in is recognisable (made for this company a moment ago), so wait briefly for its claim to land.
  const taken = async () => {
    const claimed = async () => Boolean((await prisma.invite.findUnique({ where: { id: invite.id }, select: { acceptedAt: true } }))?.acceptedAt);
    const rows = await prisma.$queryRaw<{ fresh: boolean }[]>`
      SELECT (raw_user_meta_data->>'invited_to' = ${invite.businessId} AND created_at > now() - interval '60 seconds') AS fresh
      FROM auth.users WHERE lower(email) = ${invite.email} LIMIT 1`;
    if (rows[0]?.fresh) {
      for (let i = 0; i < 12 && !(await claimed()); i++) await new Promise((r) => setTimeout(r, 500));
    }
    return (await claimed()) ? new TeamError("used", "This invitation was already used.") : new TeamError("other_company", OTHER_COMPANY);
  };
  if (await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } })) throw await taken();
  const limit = await seatLimit(invite.business.userId);

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email: invite.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: name, invited_to: invite.businessId },
  });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists") throw await taken();
    if (created.error?.code === "weak_password") throw new TeamError("invalid", "That password is too easy to guess. Try a longer one.");
    await logError(created.error ?? new Error("createUser returned no user"), { source: "team.accept" });
    throw new TeamError("invalid", "We could not create your account. Please try again.");
  }
  const authId = created.data.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      await lockSeats(tx, invite.businessId);
      // The invitation held a seat already, so only members count here (a plan change since may have shrunk the limit).
      if ((await tx.membership.count({ where: { businessId: invite.businessId } })) >= limit) throw new TeamError("seats", "This company has no free seats right now. Ask the company owner.");
      // The claim comes first: only one request can flip acceptedAt, so a link is single use even when opened twice at once.
      const claimed = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new TeamError("used", "This invitation was already used.");
      await tx.user.create({ data: { id: authId, email: invite.email, name, signUpMethod: "PASSWORD" } });
      await tx.membership.create({ data: { businessId: invite.businessId, userId: authId, role: invite.role, invitedBy: invite.invitedBy } });
    });
  } catch (error) {
    await admin.auth.admin.deleteUser(authId).catch(() => {});
    if (error instanceof TeamError) throw error;
    await logError(error, { source: "team.accept" });
    throw new TeamError("invalid", "We could not finish joining. Please try again.");
  }
  return { email: invite.email };
}

export const OTHER_COMPANY =
  "This email already has a BuPulse account that belongs to another company. In this version a person can belong to one company only. Ask your company to invite a different email address.";

// ---- roles, removal, ownership --------------------------------------------------------------------------------

async function targetOf(actor: TeamActor, userId: string) {
  const target = await prisma.membership.findFirst({ where: { businessId: actor.businessId, userId }, select: { userId: true, role: true } });
  if (!target) throw new TeamError("not_found", "That person is not in your company.");
  return target;
}

export async function changeRole(actor: TeamActor, userId: string, role: string) {
  if (!atLeast(actor.role, "ADMIN")) throw new TeamError("forbidden", "Ask your company owner or an admin to do this.");
  const next = roleOf(role);
  const target = await targetOf(actor, userId);
  if (target.role === "OWNER") throw new TeamError("forbidden", "The owner's role changes only by transferring ownership.");
  if (userId === actor.actorId) throw new TeamError("forbidden", "You cannot change your own role.");
  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { userId }, data: { role: next as MemberRole } });
    // Someone who can no longer invite loses the invitations they sent that are still open.
    if (next === "MEMBER") await tx.invite.deleteMany({ where: { businessId: actor.businessId, invitedBy: userId, acceptedAt: null } });
    await audit(tx, actor, "team_change_role", { user: userId, role: target.role }, { user: userId, role: next });
  });
}

/** Removes a teammate: their membership and their sign-in. The company and everything it holds stay. */
export async function removeMember(actor: TeamActor, userId: string) {
  if (!atLeast(actor.role, "ADMIN")) throw new TeamError("forbidden", "Ask your company owner or an admin to do this.");
  const target = await targetOf(actor, userId);
  if (target.role === "OWNER") throw new TeamError("forbidden", "The owner cannot be removed. Transfer ownership first.");
  if (userId === actor.id) throw new TeamError("forbidden", "This sign-in holds the company account and cannot be removed.");
  if (userId === actor.actorId) throw new TeamError("forbidden", "To leave the company, delete your account in Settings.");
  const email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? "";
  await prisma.$transaction(async (tx) => {
    // Written first and aimed at the company, not the person, so erasing their records does not redact it.
    await audit(tx, actor, "team_remove_member", { removed: mask(email), role: target.role }, null);
    await eraseTeammateLogin(userId, tx);
  });
}

/** The Owner hands the Owner role to a teammate and becomes an Admin. Billing follows the role (the company account stays). */
export async function transferOwnership(actor: TeamActor, toUserId: string) {
  if (actor.role !== "OWNER") throw new TeamError("forbidden", "Ask your company owner to do this.");
  if (toUserId === actor.actorId) throw new TeamError("invalid", "You are already the owner.");
  await targetOf(actor, toUserId);
  await prisma.$transaction(async (tx) => {
    const demoted = await tx.membership.updateMany({ where: { businessId: actor.businessId, userId: actor.actorId, role: "OWNER" }, data: { role: "ADMIN" } });
    if (demoted.count !== 1) throw new TeamError("conflict", "Ownership already changed. Reload the page.");
    await tx.membership.update({ where: { userId: toUserId }, data: { role: "OWNER" } });
    await audit(tx, actor, "team_transfer_ownership", { owner: actor.actorId }, { owner: toUserId });
  });
}

/** An Admin chooses whether the Owner's lead, digest and post alerts also come to them. */
export async function setMyAlerts(actor: TeamActor, on: boolean) {
  if (actor.role !== "ADMIN") throw new TeamError("forbidden", "Alerts always go to the owner; only admins can opt in.");
  await prisma.membership.update({ where: { userId: actor.actorId }, data: { notifyEmail: Boolean(on) } });
}
