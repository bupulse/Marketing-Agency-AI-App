import "server-only";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { eraseTeammateLogin } from "@/lib/account-deletion";
import { siteUrl } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRole, ROLE_LABEL, type Role } from "@/lib/team/roles";
import { lockSeats, normalizeEmail, seatLimit, seatsUsed } from "@/lib/team/service";
import { writeAudit } from "../audit";
import { AdminError, type AdminContext, type Page } from "../types";

// Actions on companies and their users. The super admin never sets or sees a password: people get links and choose their own.
// Each action is one database transaction with its audit row (before and after), refuses a missing target, is rate limited,
// and over the API (Jarvis) needs `confirm: true`; the console's confirm dialog is the confirm there.
// Callers check the admin first (`adminAction()` in the console, the API key for Jarvis).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireConfirm(ctx: AdminContext, confirm: boolean | undefined, what: string) {
  if (ctx.viaApi && confirm !== true) throw new AdminError("confirm_required", `${what} is sensitive. Send confirm: true to proceed.`);
}

async function limit(ctx: AdminContext, key: string, rule: { limit: number; windowSeconds: number }) {
  try {
    await rateLimit(`admin-co:${key}`, rule);
  } catch (e) {
    if (e instanceof RateLimitError) throw new AdminError("conflict", rateLimitMessage(e));
    throw e;
  }
}

/** Hides most of an address for notices: "n***@example.com". */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** A client that talks to Supabase Auth as the public app (anon key), for flows that email the user, without a session. */
function publicAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AdminError("unavailable", "Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
}

const RECOVERY_REDIRECT = () => `${siteUrl()}/auth/confirm?type=recovery&next=/reset-password`;

// ---- reads ----------------------------------------------------------------------------------------------------------

export type CompanySummary = {
  id: string;
  name: string;
  plan: string | null;
  status: string | null;
  seatsUsed: number;
  ownerEmail: string | null;
  lastActiveAt: string | null;
  suspended: boolean;
  createdAt: string;
};

export async function listCompanies(opts: { q?: string; plan?: string; status?: string; cursor?: string; limit?: number } = {}): Promise<Page<CompanySummary>> {
  const take = Math.min(Math.max(Math.trunc(opts.limit ?? 25) || 25, 1), 100);
  const q = opts.q?.trim().slice(0, 100);
  const plan = opts.plan?.trim().slice(0, 64) || undefined;
  const status = opts.status?.trim().slice(0, 20) || undefined;
  const rows = await prisma.business.findMany({
    where: {
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { memberships: { some: { user: { email: { contains: q, mode: "insensitive" } } } } }] } : {}),
      ...(plan || status ? { user: { subscription: { ...(plan ? { plan } : {}), ...(status ? { status: status as never } : {}) } } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, name: true, createdAt: true,
      user: { select: { suspendedAt: true, subscription: { select: { plan: true, status: true } } } },
      memberships: { select: { role: true, user: { select: { email: true } } } },
    },
  });
  const more = rows.length > take;
  const items = more ? rows.slice(0, take) : rows;
  const last = items.length
    ? await prisma.$queryRaw<{ id: string; at: Date | null }[]>`
        SELECT m."businessId" AS id, max(a.last_sign_in_at) AS at
        FROM "Membership" m JOIN auth.users a ON a.id = m."userId"
        WHERE m."businessId" = ANY(${items.map((i) => i.id)}::text[]) GROUP BY m."businessId"`
    : [];
  const lastBy = new Map(last.map((l) => [l.id, l.at]));
  return {
    items: items.map((b) => ({
      id: b.id,
      name: b.name,
      plan: b.user.subscription?.plan ?? null,
      status: b.user.subscription?.status ?? null,
      seatsUsed: b.memberships.length,
      ownerEmail: b.memberships.find((m) => m.role === "OWNER")?.user.email ?? null,
      lastActiveAt: lastBy.get(b.id)?.toISOString() ?? null,
      suspended: Boolean(b.user.suspendedAt),
      createdAt: b.createdAt.toISOString(),
    })),
    nextCursor: more ? items[items.length - 1].id : null,
  };
}

export async function getCompany(businessId: string) {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, industry: true, country: true, createdAt: true, onboardedAt: true, userId: true,
      user: { select: { email: true, suspendedAt: true, deletionScheduledFor: true, subscription: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } } } },
      memberships: { orderBy: { createdAt: "asc" }, select: { userId: true, role: true, createdAt: true, user: { select: { email: true, name: true, suspendedAt: true } } } },
      invites: { where: { acceptedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, role: true, expiresAt: true } },
    },
  });
  if (!b) throw new AdminError("not_found", "No company with that id.");
  const ids = b.memberships.map((m) => m.userId);
  const signIns = ids.length
    ? await prisma.$queryRaw<{ id: string; at: Date | null }[]>`SELECT id::text AS id, last_sign_in_at AS at FROM auth.users WHERE id = ANY(${ids}::uuid[])`
    : [];
  const at = new Map(signIns.map((s) => [s.id, s.at]));
  return {
    id: b.id,
    name: b.name,
    industry: b.industry,
    country: b.country,
    createdAt: b.createdAt.toISOString(),
    onboarded: Boolean(b.onboardedAt),
    accountUserId: b.userId,
    accountEmail: b.user.email,
    suspended: Boolean(b.user.suspendedAt),
    deletionScheduledFor: b.user.deletionScheduledFor?.toISOString() ?? null,
    subscription: b.user.subscription ? { plan: b.user.subscription.plan, status: b.user.subscription.status, trialEndsAt: b.user.subscription.trialEndsAt?.toISOString() ?? null, currentPeriodEnd: b.user.subscription.currentPeriodEnd?.toISOString() ?? null } : null,
    seatLimit: await seatLimit(b.userId),
    users: b.memberships.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role as Role, suspended: Boolean(m.user.suspendedAt), joinedAt: m.createdAt.toISOString(), lastSignInAt: at.get(m.userId)?.toISOString() ?? null, isCompanyAccount: m.userId === b.userId })),
    invites: b.invites.map((i) => ({ id: i.id, email: i.email, role: i.role as Role, expiresAt: i.expiresAt.toISOString() })),
  };
}

// ---- helpers ----------------------------------------------------------------------------------------------------------

async function membershipOf(userId: string) {
  if (!UUID.test(userId)) throw new AdminError("invalid", "That is not a valid user id.");
  const m = await prisma.membership.findUnique({
    where: { userId },
    select: { businessId: true, role: true, user: { select: { email: true, name: true } }, business: { select: { name: true, userId: true } } },
  });
  if (!m) throw new AdminError("not_found", "That user does not belong to a company.");
  return m;
}

async function authEmailTaken(email: string) {
  return Boolean(await prisma.user.findUnique({ where: { email }, select: { id: true } }))
    || Boolean((await prisma.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM auth.users WHERE lower(email) = ${email} LIMIT 1`).length);
}

// ---- create_company_user -------------------------------------------------------------------------------------------

/**
 * Adds a person to a company: creates their sign-in with no password, the profile and the membership in one transaction
 * with the audit row, then emails a link where they confirm the address and choose their own password.
 */
export async function createCompanyUser(ctx: AdminContext, input: { businessId: string; email: string; role: string; name?: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Creating a user");
  const email = normalizeEmail(input.email ?? "");
  if (!EMAIL.test(email) || email.length > 254) throw new AdminError("invalid", "Enter a valid email address.");
  if (!isRole(input.role) || input.role === "OWNER") throw new AdminError("invalid", "Role must be ADMIN or MEMBER. To change who owns a company, change an existing user's role to OWNER.");
  const role = input.role;
  const name = input.name?.trim().slice(0, 100) || null;
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true, name: true, userId: true } });
  if (!business) throw new AdminError("not_found", "No company with that id.");
  await limit(ctx, `create:${ctx.actor}`, { limit: 20, windowSeconds: 3600 });

  const [cap, used] = await Promise.all([seatLimit(business.userId), seatsUsed(business.id)]);
  if (used.members + used.pending >= cap) throw new AdminError("conflict", `The plan includes ${cap} ${cap === 1 ? "user" : "users"} and all are taken (members plus open invitations).`);
  if (await authEmailTaken(email)) throw new AdminError("conflict", "That email already has a BuPulse sign-in. In this version a person belongs to one company.");

  // No password at all: the link below is the only way in, and the person chooses their own.
  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name ?? undefined, invited_to: business.id } });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists") throw new AdminError("conflict", "That email already has a BuPulse sign-in.");
    await logError(created.error ?? new Error("createUser returned no user"), { source: "admin.create_company_user" });
    throw new AdminError("unavailable", "The sign-in could not be created. Nothing was changed.");
  }
  const userId = created.data.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      // The count above and this insert must not interleave with another seat being taken: same lock as invitations.
      await lockSeats(tx, business.id);
      const now = await seatsUsed(business.id, new Date(), tx);
      if (now.members + now.pending >= cap) throw new AdminError("conflict", `The plan includes ${cap} ${cap === 1 ? "user" : "users"} and all are taken (members plus open invitations).`);
      await tx.user.create({ data: { id: userId, email, name, signUpMethod: "PASSWORD" } });
      await tx.membership.create({ data: { businessId: business.id, userId, role } });
      await writeAudit(tx, ctx, "create_company_user", `user:${userId}`, null, { businessId: business.id, company: business.name, email, role, name });
    });
  } catch (error) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw error;
  }

  const emailSent = await sendSetPasswordEmail({ userId, email, name, company: business.name, role });
  return { userId, email, role, emailSent };
}

/** Link to choose a password, mailed through our own mailer so the text says what is happening (a new account, not a "reset"). */
async function sendSetPasswordEmail(args: { userId: string; email: string; name: string | null; company: string; role: Role }): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email: args.email });
    const hash = data?.properties?.hashed_token;
    if (error || !hash) throw error ?? new Error("generateLink returned no token");
    const url = `${siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=recovery&next=/reset-password`;
    const { html, text } = renderEmail({
      heading: `You were added to ${args.company} on BuPulse`,
      intro: `${args.name ? `Hi ${args.name}, ` : ""}BuPulse support added you to ${args.company} as ${args.role === "ADMIN" ? "an Admin" : "a Member"}. Choose your password to sign in. We never set or see passwords for you.`,
      button: { label: "Choose my password", url },
      footer: "The link works once and expires soon. If it has expired, use Forgot password on the sign-in page. If you were not expecting this email, you can ignore it.",
    });
    return await sendEmail({ to: args.email, subject: `You were added to ${args.company} on BuPulse`, html, text });
  } catch (error) {
    await logError(error, { source: "admin.create_company_user.email", userId: args.userId });
    return false;
  }
}

// ---- send_password_reset -------------------------------------------------------------------------------------------

/** Sends the standard reset link to the person's current address. The audit row records that it was sent, never the link. */
export async function sendPasswordReset(ctx: AdminContext, input: { userId: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Sending a reset link");
  const m = await membershipOf(input.userId);
  await limit(ctx, `reset:${input.userId}`, { limit: 5, windowSeconds: 3600 });
  await limit(ctx, `reset-all:${ctx.actor}`, { limit: 60, windowSeconds: 3600 });
  const { error } = await publicAuth().resetPasswordForEmail(m.user.email, { redirectTo: RECOVERY_REDIRECT() });
  if (error) {
    await logError(error, { source: "admin.send_password_reset", userId: input.userId });
    // Supabase allows one recovery email per person a minute (also after the "choose a password" mail of a new user).
    if (error.status === 429 || /after \d+ seconds|rate limit/i.test(error.message)) throw new AdminError("conflict", "A link was sent to this person a moment ago. Wait a minute, then send another.");
    throw new AdminError("unavailable", "The reset email could not be sent. Try again in a minute.");
  }
  await writeAudit(prisma, ctx, "send_password_reset", `user:${input.userId}`, null, { businessId: m.businessId, sentTo: maskEmail(m.user.email) });
  return { sentTo: maskEmail(m.user.email) };
}

// ---- change_user_email ---------------------------------------------------------------------------------------------

/**
 * Changes a person's sign-in email. The admin vouches for the new address, so it is confirmed at once (no confirmation
 * mail). The OLD address gets a notice naming the masked new one. Optionally the new address gets a reset link.
 */
async function checkEmailChange(userId: string, rawEmail: string) {
  const newEmail = normalizeEmail(rawEmail ?? "");
  if (!EMAIL.test(newEmail) || newEmail.length > 254) throw new AdminError("invalid", "Enter a valid email address.");
  const m = await membershipOf(userId);
  if (newEmail === m.user.email.toLowerCase()) throw new AdminError("invalid", "That is already their email address.");
  if (await authEmailTaken(newEmail)) throw new AdminError("conflict", "That email already belongs to another BuPulse sign-in.");
  return { newEmail, m };
}

/**
 * What an approval for an email change shows the owner, checked now: who, from which address, to which, in which company.
 * Over the API an email change never runs by itself (a leaked key would be an account takeover); it becomes an approval.
 */
export async function prepareEmailChange(input: { userId: string; newEmail: string }) {
  const { newEmail, m } = await checkEmailChange(input.userId, input.newEmail);
  return { userId: input.userId, currentEmail: m.user.email, newEmail, company: m.business.name, businessId: m.businessId };
}

/** Same for handing ownership of a company to someone else. */
export async function prepareMakeOwner(input: { userId: string }) {
  const m = await membershipOf(input.userId);
  if (m.role === "OWNER") throw new AdminError("invalid", "They are already the owner.");
  const current = await prisma.membership.findFirst({ where: { businessId: m.businessId, role: "OWNER" }, select: { user: { select: { email: true } } } });
  return { userId: input.userId, email: m.user.email, company: m.business.name, businessId: m.businessId, currentOwner: current?.user.email ?? null };
}

export async function changeUserEmail(ctx: AdminContext, input: { userId: string; newEmail: string; sendReset?: boolean; confirm?: boolean }) {
  if (ctx.viaApi) throw new AdminError("forbidden", "Over the API an email change needs the owner's approval in the console. Ask for it with request_change_user_email.");
  const { newEmail, m } = await checkEmailChange(input.userId, input.newEmail);
  const oldEmail = m.user.email;
  await limit(ctx, `email:${ctx.actor}`, { limit: 15, windowSeconds: 3600 });

  const admin = createAdminClient();
  const updated = await admin.auth.admin.updateUserById(input.userId, { email: newEmail, email_confirm: true });
  if (updated.error) {
    if (updated.error.code === "email_exists") throw new AdminError("conflict", "That email already belongs to another BuPulse sign-in.");
    await logError(updated.error, { source: "admin.change_user_email", userId: input.userId });
    throw new AdminError("unavailable", "The email could not be changed. Nothing was changed.");
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: input.userId }, data: { email: newEmail } });
      // Whoever held the old address (or a stolen session) is signed out everywhere; the person signs in again with the new one.
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${input.userId}::uuid`;
      await writeAudit(tx, ctx, "change_user_email", `user:${input.userId}`, { email: oldEmail, businessId: m.businessId }, { email: newEmail, resetLinkSent: Boolean(input.sendReset) });
    });
  } catch (error) {
    await admin.auth.admin.updateUserById(input.userId, { email: oldEmail, email_confirm: true }).catch(() => {});
    throw error;
  }

  // Notices are best effort: the change itself is done and audited.
  const { html, text } = renderEmail({
    heading: "Your BuPulse sign-in email was changed",
    intro: `Your BuPulse sign-in email was changed by BuPulse support to ${maskEmail(newEmail)}. If this wasn't you, contact us right away at support@bupulse.com.`,
  });
  const noticeSent = await sendEmail({ to: oldEmail, subject: "Your BuPulse sign-in email was changed", html, text });
  let resetSent = false;
  if (input.sendReset) {
    const { error } = await publicAuth().resetPasswordForEmail(newEmail, { redirectTo: RECOVERY_REDIRECT() });
    resetSent = !error;
    if (error) await logError(error, { source: "admin.change_user_email.reset", userId: input.userId });
  }
  return { userId: input.userId, newEmail, noticeSent, resetSent };
}

// ---- remove_company_user / change_company_user_role --------------------------------------------------------------

/** Removes a person's membership and sign-in. A company always keeps its Owner, and the company account cannot be removed. */
export async function removeCompanyUser(ctx: AdminContext, input: { userId: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Removing a user");
  const m = await membershipOf(input.userId);
  if (m.role === "OWNER") throw new AdminError("conflict", "A company needs an owner. Make someone else the owner first, then remove this user.");
  if (input.userId === m.business.userId) throw new AdminError("conflict", "This sign-in holds the company account (billing and files). Make them the owner again or delete the company instead.");
  await limit(ctx, `remove:${ctx.actor}`, { limit: 30, windowSeconds: 3600 });
  await prisma.$transaction(async (tx) => {
    await eraseTeammateLogin(input.userId, tx);
    // After the erase, and aimed at the company: erasing a person's records redacts every row about them, which would blank
    // an audit row written before it. This one holds no personal detail (the company and the role only).
    await writeAudit(tx, ctx, "remove_company_user", `company:${m.businessId}`, { company: m.business.name, role: m.role }, { removed: true });
  });
  return { userId: input.userId, removed: true };
}

/** Changes a role. Making someone OWNER hands ownership over (the previous owner becomes ADMIN), so there is always one Owner. */
export async function changeCompanyUserRole(ctx: AdminContext, input: { userId: string; role: string; confirm?: boolean }) {
  requireConfirm(ctx, input.confirm, "Changing a role");
  if (!isRole(input.role)) throw new AdminError("invalid", `Role must be one of: ${["OWNER", "ADMIN", "MEMBER"].join(", ")}.`);
  // Ownership is billing and deleting the company: over the API it is an approval in the console, like an email change.
  if (ctx.viaApi && input.role === "OWNER") throw new AdminError("forbidden", "Over the API, making someone the owner needs the owner's approval in the console. Ask for it with request_make_company_owner.");
  const role = input.role;
  const m = await membershipOf(input.userId);
  if (m.role === role) throw new AdminError("invalid", `They are already ${ROLE_LABEL[role]}.`);
  if (m.role === "OWNER") throw new AdminError("conflict", "A company needs an owner. Make someone else the owner instead; this user then becomes an Admin.");
  await limit(ctx, `role:${ctx.actor}`, { limit: 30, windowSeconds: 3600 });
  return prisma.$transaction(async (tx) => {
    let previousOwner: string | null = null;
    if (role === "OWNER") {
      const current = await tx.membership.findFirst({ where: { businessId: m.businessId, role: "OWNER" }, select: { userId: true } });
      if (current) {
        await tx.membership.update({ where: { userId: current.userId }, data: { role: "ADMIN" } });
        previousOwner = current.userId;
      }
    }
    await tx.membership.update({ where: { userId: input.userId }, data: { role } });
    // Someone who can no longer invite loses the invitations they sent that are still open.
    if (role === "MEMBER") await tx.invite.deleteMany({ where: { businessId: m.businessId, invitedBy: input.userId, acceptedAt: null } });
    const owners = await tx.membership.count({ where: { businessId: m.businessId, role: "OWNER" } });
    if (owners !== 1) throw new AdminError("conflict", "A company must have exactly one owner. Nothing was changed.");
    await writeAudit(tx, ctx, "change_company_user_role", `user:${input.userId}`, { email: m.user.email, role: m.role, businessId: m.businessId }, { role, previousOwnerNowAdmin: previousOwner });
    return { userId: input.userId, role, previousOwner };
  });
}

