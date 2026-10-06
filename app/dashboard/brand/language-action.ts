"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { isContentLanguage } from "@/lib/brand/languages";

export async function saveContentLanguage(language: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireActiveUser();
  if (!isContentLanguage(language)) return { ok: false, error: "Choose one of the languages in the list." };

  const updated = await prisma.business.updateMany({ where: { userId: user.id }, data: { contentLanguage: language } });
  if (updated.count === 0) return { ok: false, error: "We could not find your business." };

  revalidatePath("/dashboard/brand");
  return { ok: true };
}
