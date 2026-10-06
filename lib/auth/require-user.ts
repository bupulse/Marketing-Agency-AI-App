import "server-only";
import { redirect } from "next/navigation";
import { ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * For server actions and pages outside the dashboard: the signed-in, confirmed user whose
 * account is not waiting to be deleted. Accounts with a scheduled deletion are locked, so
 * every write path goes through this check, not only page navigation.
 */
export async function requireActiveUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionScheduledFor: true } });
  if (account?.deletionScheduledFor) redirect("/account/deletion");
  return user;
}
