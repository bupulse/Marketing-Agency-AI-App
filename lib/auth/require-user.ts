import "server-only";
import { redirect } from "next/navigation";
import { ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveCompany } from "@/lib/team/company";
import { can, ForbiddenError, type Permission, type Role } from "@/lib/team/roles";

type AuthUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * The signed-in person seen as a member of their company. `id` is the COMPANY ACCOUNT's id (Business.userId), not the
 * person's: it is the subject every service call, Storage path, rate limit and usage count is keyed on, so a teammate
 * works on the company's data and spends the company's credits without any service knowing about teams.
 * The person themselves is `actorId` (their login, email and personal settings such as Canva).
 */
export type SessionUser = Omit<AuthUser, "id"> & { id: string; actorId: string; role: Role; businessId: string };

export type ActiveUserCheck = { status: "ok"; user: SessionUser } | { status: "signed_out" } | { status: "unconfirmed" } | { status: "locked" } | { status: "suspended" };

/** The same checks as requireActiveUser, for route handlers that answer with a status instead of redirecting. */
export async function checkActiveUser(): Promise<ActiveUserCheck> {
  const user = await getCurrentUser();
  if (!user) return { status: "signed_out" };
  if (!(await ensureAccount(user))) return { status: "unconfirmed" };
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true, suspendedAt: true } });
  if (account?.suspendedAt) return { status: "suspended" };
  if (account?.deletionScheduledFor) return { status: "locked" };
  const company = await resolveCompany(user.id);
  if (company?.ownerSuspended) return { status: "suspended" };
  if (company?.ownerDeleting) return { status: "locked" };
  return {
    status: "ok",
    user: { ...user, id: company?.ownerId ?? user.id, actorId: user.id, role: company?.role ?? "OWNER", businessId: company?.businessId ?? "" },
  };
}

/**
 * For server actions and pages outside the dashboard: the signed-in, confirmed user whose
 * account is not waiting to be deleted. Accounts with a scheduled deletion are locked, so
 * every write path goes through this check, not only page navigation.
 * The returned `id` is the company account (see SessionUser); use `requirePersonalUser` for things that belong to the person.
 */
export async function requireActiveUser(permission?: Permission, onDenied: "redirect" | "throw" = "redirect") {
  const check = await checkActiveUser();
  if (check.status === "signed_out") redirect("/login");
  if (check.status === "unconfirmed") redirect("/login?error=confirm");
  if (check.status === "suspended") redirect("/suspended");
  if (check.status === "locked") redirect("/account/deletion");
  // Role check on the server: a hidden button is not protection. Throws ForbiddenError with a friendly message.
  // By default the person lands on a friendly "Ask your company owner" page, whatever shape the action returns;
  // callers that show the message inline (routes, guarded wrappers) pass "throw" and catch ForbiddenError.
  if (permission && !can(check.user.role, permission)) {
    if (onDenied === "throw") throw new ForbiddenError(permission);
    redirect(`/dashboard/no-access?need=${permission}`);
  }
  return check.user;
}

/** Same checks, but `id` stays the person's own id: for their login, name, password, Canva and account deletion. */
export async function requirePersonalUser() {
  const user = await requireActiveUser();
  return { ...user, id: user.actorId };
}

/** Server-side role gate. True when the signed-in role may do `permission`; actions answer with `askMessage` otherwise. */
export function allowed(user: Pick<SessionUser, "role">, permission: Permission): boolean {
  return can(user.role, permission);
}
