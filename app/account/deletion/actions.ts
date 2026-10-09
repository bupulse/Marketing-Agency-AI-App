"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveCompany } from "@/lib/team/company";
import { getCurrentUser } from "@/lib/supabase/server";

// Cancels a scheduled deletion; the account opens again right away.
export async function keepAccount() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // An Owner who asked to delete the company brings the company account back too.
  const company = await resolveCompany(user.id);
  // Only the Owner can cancel a company deletion. Everyone else (including the login that holds the company account after
  // an ownership transfer) stays locked, otherwise the purge would erase the owner and leave the company without one.
  if (company?.ownerDeleting && company.role !== "OWNER") redirect("/account/deletion");
  const ids = company?.role === "OWNER" ? [user.id, company.ownerId] : [user.id];
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { deletionScheduledFor: null } });
  redirect("/dashboard");
}
