"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { validateWidgetSettings } from "@/lib/widget/settings";

export type SaveWidgetResult = { ok: true } | { ok: false; errors: Record<string, string> };

export async function saveWidgetSettings(input: unknown): Promise<SaveWidgetResult> {
  const user = await requireActiveUser();
  const result = validateWidgetSettings(input);
  if (!result.ok) return result;
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return { ok: false, errors: { form: "We could not find your business." } };
  await prisma.chatWidget.upsert({
    where: { businessId: business.id },
    create: { businessId: business.id, ...result.data },
    update: result.data,
  });
  revalidatePath("/dashboard/widget");
  return { ok: true };
}
