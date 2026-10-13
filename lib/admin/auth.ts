import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS, OWNER_ROLE, builtInRole, isSalesRole, permissionsOf, type Permission } from "@/lib/staff/permissions";

/** Six-digit code attempts: 8 per 10 minutes per admin. */
export const ADMIN_VERIFY_RULE: RateLimitRule = { limit: 8, windowSeconds: 10 * 60 };

/** Addresses allowed into the console: ADMIN_EMAILS, comma-separated, case-insensitive. */
export function adminEmails(env: string | undefined = process.env.ADMIN_EMAILS): string[] {
  return (env ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.trim().toLowerCase());
}

/**
 * Who is signed in to the console. The owner (ADMIN_EMAILS) has every permission; a staff member (StaffMember, not
 * disabled) has their role's (lib/staff/permissions.ts).
 */
export type AdminIdentity = {
  id: string;
  email: string;
  /** StaffMember.id, or null for the owner from ADMIN_EMAILS. */
  staffId: string | null;
  role: string;
  roleName: string;
  permissions: Permission[];
  isOwner: boolean;
  /** Sales staff: a referral link, own clients, a place on the leaderboard. */
  isSales: boolean;
};

type StaffRow = { id: string; roleKey: string; status: string; userId: string | null; lastSignInAt: Date | null };

/** The console identity of an email: owner, an enabled staff member, or null (not allowed in). */
export async function identityFor(user: { id: string; email: string }): Promise<(AdminIdentity & { staff: StaffRow | null }) | null> {
  const email = user.email.trim().toLowerCase();
  if (isAdminEmail(email)) return { id: user.id, email, staffId: null, role: OWNER_ROLE, roleName: "Owner", permissions: [...ALL_PERMISSIONS], isOwner: true, isSales: false, staff: null };
  // Deny by default: a database error lets nobody but the owner in.
  try {
    const staff = await prisma.staffMember.findUnique({ where: { email }, select: { id: true, roleKey: true, status: true, userId: true, lastSignInAt: true } });
    // A disabled member, or a link to another account (someone else re-created the address), is not let in.
    if (!staff || staff.status === "disabled" || (staff.userId && staff.userId !== user.id)) return null;
    const role = builtInRole(staff.roleKey) ? null : await prisma.staffRole.findUnique({ where: { key: staff.roleKey }, select: { key: true, name: true, permissions: true } });
    const permissions = permissionsOf(staff.roleKey, role ? [role] : []);
    const roleName = builtInRole(staff.roleKey)?.name ?? role?.name ?? staff.roleKey;
    return { id: user.id, email, staffId: staff.id, role: staff.roleKey, roleName, permissions, isOwner: staff.roleKey === OWNER_ROLE, isSales: isSalesRole(staff.roleKey, permissions), staff };
  } catch {
    return null;
  }
}

/**
 * The signed-in owner or staff member before the second step. Anyone else gets a 404 so the console's existence is
 * not revealed. Used only by /admin/verify and /admin/setup-2fa; everything else uses requireAdmin / requirePermission.
 */
export async function requireAdminIdentity(): Promise<AdminIdentity & { supabase: Awaited<ReturnType<typeof createClient>>; staff: StaffRow | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user || !user.email_confirmed_at || !user.email) notFound();
  const identity = await identityFor({ id: user.id, email: user.email });
  if (!identity) notFound();
  return { ...identity, supabase };
}

/**
 * Gate for every admin page and every admin server action (call it again inside each action, not just
 * the layout). Needs an allow-listed, verified email and an AAL2 session (authenticator code entered).
 * Non-admins get a 404; an admin below AAL2 is sent to enter a code, or to enrol an app first.
 */
export const requireAdmin = cache(async (): Promise<AdminIdentity> => {
  const { supabase, staff, ...identity } = await requireAdminIdentity();
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !aal) redirect("/admin/verify");
  if (aal.currentLevel !== "aal2") {
    redirect(aal.nextLevel === "aal2" ? "/admin/verify" : "/admin/setup-2fa");
  }
  // AAL2 can only come from a verified factor; check it is a TOTP one rather than assuming.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.totp?.some((f) => f.status === "verified")) redirect("/admin/setup-2fa");
  // First full sign-in of an invited member: link the account and mark them active. Later, note the sign-in hourly.
  if (staff && (staff.status === "invited" || !staff.userId || !staff.lastSignInAt || Date.now() - staff.lastSignInAt.getTime() > 3_600_000)) {
    await prisma.staffMember
      .updateMany({ where: { id: staff.id, status: { not: "disabled" } }, data: { userId: identity.id, status: "active", lastSignInAt: new Date() } })
      .catch(() => undefined);
  }
  return identity;
});

/** True when the identity has the permission (or, for a list, any of them). */
export function can(identity: Pick<AdminIdentity, "permissions">, permission: Permission | readonly Permission[]): boolean {
  const list = typeof permission === "string" ? [permission] : permission;
  return list.some((p) => identity.permissions.includes(p));
}

/**
 * Gate for a page or server action: a signed-in, AAL2 owner or staff member WITH the permission (or one of a list).
 * Anyone else gets the same 404 as a stranger, so the page's existence is not revealed.
 */
export async function requirePermission(permission: Permission | readonly Permission[]): Promise<AdminIdentity> {
  const identity = await requireAdmin();
  if (!can(identity, permission)) notFound();
  return identity;
}

/** Counts one code attempt; throws RateLimitError when the admin tries too often. */
export async function limitVerifyAttempts(adminId: string) {
  await rateLimit(`admin-verify:${adminId}`, ADMIN_VERIFY_RULE);
}

/** Emailed-code attempts while enrolling: 3 sends and 8 tries per 10 minutes. */
export const ADMIN_ENROLL_SEND_RULE: RateLimitRule = { limit: 3, windowSeconds: 10 * 60 };
export const ADMIN_ENROLL_TRY_RULE: RateLimitRule = { limit: 8, windowSeconds: 10 * 60 };
export async function limitEnrollSends(adminId: string) {
  await rateLimit(`admin-enroll-send:${adminId}`, ADMIN_ENROLL_SEND_RULE);
}
export async function limitEnrollTries(adminId: string) {
  await rateLimit(`admin-enroll-try:${adminId}`, ADMIN_ENROLL_TRY_RULE);
}

export const ENROLL_PROOF_MS = 10 * 60 * 1000;
/** A setup that another session started less than this long ago is not replaced. */
export const ENROLL_GRACE_MS = 15 * 60 * 1000;

/**
 * True when this session signed in with an emailed one-time code in the last 10 minutes
 * (Supabase records it in the session's authentication methods). Enrolling an authenticator needs it,
 * so a password alone cannot add one.
 */
export function hasRecentEmailProof(methods: unknown, now = Date.now()): boolean {
  if (!Array.isArray(methods)) return false;
  return methods.some((m) => {
    if (typeof m !== "object" || m === null) return false;
    const { method, timestamp } = m as { method?: string; timestamp?: number };
    return (method === "otp" || method === "email" || method === "magiclink") && typeof timestamp === "number" && now - timestamp * 1000 < ENROLL_PROOF_MS;
  });
}

/** The id inside the access token, to tell this browser session from another one. Not used for trust. */
export async function currentSessionId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.auth.getSession();
  try {
    const payload = JSON.parse(Buffer.from(data.session?.access_token.split(".")[1] ?? "", "base64url").toString());
    return String(payload.session_id ?? "");
  } catch {
    return "";
  }
}

/**
 * True for a signed-in, verified, AAL2 owner or staff member with the permission. For route handlers, which answer
 * 404 instead of redirecting. The permission is required: there is no "any admin" route.
 */
export async function isAdminSession(permission: Permission | readonly Permission[]): Promise<boolean> {
  try {
    const identity = await requireAdmin();
    return can(identity, permission);
  } catch {
    return false;
  }
}
