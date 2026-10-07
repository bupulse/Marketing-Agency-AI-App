import "server-only";
import { redirect } from "next/navigation";
import { ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
export type ActiveUserCheck = { status: "ok"; user: SessionUser } | { status: "signed_out" } | { status: "unconfirmed" } | { status: "locked" };

/** The same checks as requireActiveUser, for route handlers that answer with a status instead of redirecting. */
export async function checkActiveUser(): Promise<ActiveUserCheck> {
  const user = await getCurrentUser();
  if (!user) return { status: "signed_out" };
  if (!(await ensureAccount(user))) return { status: "unconfirmed" };
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true } });
  if (account?.deletionScheduledFor) return { status: "locked" };
  return { status: "ok", user };
}

/**
 * For server actions and pages outside the dashboard: the signed-in, confirmed user whose
 * account is not waiting to be deleted. Accounts with a scheduled deletion are locked, so
 * every write path goes through this check, not only page navigation.
 */
export async function requireActiveUser() {
  const check = await checkActiveUser();
  if (check.status === "signed_out") redirect("/login");
  if (check.status === "unconfirmed") redirect("/login?error=confirm");
  if (check.status === "locked") redirect("/account/deletion");
  return check.user;
}
