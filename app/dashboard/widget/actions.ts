"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { validateWidgetSettings } from "@/lib/widget/settings";

export type SaveWidgetResult = { ok: true } | { ok: false; errors: Record<string, string> };

export async function saveWidgetSettings(input: unknown): Promise<SaveWidgetResult> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("widget", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, errors: { form: error.message } };
    throw error;
  }
  const missing = await featureBlocked(user, "websiteChat");
  if (missing) return { ok: false, errors: { form: missing } };
  const result = validateWidgetSettings(input);
  if (!result.ok) return result;
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return { ok: false, errors: { form: "We could not find your business." } };
  // Support can switch the chat off; the owner cannot turn it back on until support does.
  const locked = await prisma.chatWidget.findUnique({ where: { businessId: business.id }, select: { enabled: true, disabledByAdminAt: true } });
  const data = locked?.disabledByAdminAt ? { ...result.data, enabled: locked.enabled } : result.data;
  await prisma.chatWidget.upsert({
    where: { businessId: business.id },
    create: { businessId: business.id, ...data },
    update: data,
  });
  revalidatePath("/dashboard/widget");
  return { ok: true };
}
