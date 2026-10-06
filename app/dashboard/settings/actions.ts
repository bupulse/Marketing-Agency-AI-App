"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fieldErrors, organisationSchema, type FieldErrors } from "@/lib/auth/schemas";
import { requireActiveUser } from "@/lib/auth/require-user";
import { billingAdapter } from "@/lib/billing";
import { applyProviderSubscription } from "@/lib/billing/apply";
import { logError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type SettingsState = { error?: string; saved?: boolean; fieldErrors?: FieldErrors };

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETION_GRACE_DAYS = 30;

const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100, "Use 100 characters or fewer."),
});

export async function saveProfile(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireActiveUser();

  const parsed = profileSchema.safeParse({ name: formData.get("name") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name } });
  revalidatePath("/dashboard", "layout");
  return { saved: true };
}

export async function saveBusiness(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireActiveUser();

  const parsed = organisationSchema.safeParse({
    organisationName: formData.get("organisationName") ?? "",
    ceoName: formData.get("ceoName") ?? "",
    industry: formData.get("industry") ?? "",
    country: formData.get("country") ?? "",
    phone: formData.get("phone") ?? "",
    website: formData.get("website") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { organisationName, ceoName, industry, country, phone, website } = parsed.data;
  await prisma.business.update({
    where: { userId: user.id },
    data: { name: organisationName, ceoName, industry, country, phone: phone ?? null, website: website ?? null },
  });
  revalidatePath("/dashboard", "layout");
  return { saved: true };
}

// Locks the account for 30 days, then signs out. The purge job (lib/account-deletion.ts) erases it after that.
// A paid plan is cancelled at the end of its period first, so nobody is charged after asking to leave.
export async function scheduleAccountDeletion(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireActiveUser();

  const typed = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase()) {
    return { fieldErrors: { confirmEmail: "Type your email address exactly as shown." } };
  }

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (sub?.provider && sub.providerSubscriptionId && !sub.cancelAtPeriodEnd && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) {
    try {
      const updated = await billingAdapter(sub.provider).cancelAtPeriodEnd(sub.providerSubscriptionId);
      await applyProviderSubscription(sub.provider, updated);
    } catch (error) {
      await logError(error, { source: "settings.delete.cancel-billing", userId: user.id });
      return { error: "We could not cancel your plan's billing just now, so nothing was changed. Please try again in a few minutes." };
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { deletionScheduledFor: new Date(Date.now() + DELETION_GRACE_DAYS * DAY_MS) },
  });
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?notice=deletion-scheduled");
}
