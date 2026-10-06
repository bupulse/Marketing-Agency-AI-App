"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/supabase/server";

// Cancels a scheduled deletion; the account opens again right away.
export async function keepAccount() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await prisma.user.update({ where: { id: user.id }, data: { deletionScheduledFor: null } });
  redirect("/dashboard");
}
