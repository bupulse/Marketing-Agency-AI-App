"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fieldErrors, organisationSchema, type FieldErrors } from "@/lib/auth/schemas";
import { ForbiddenError } from "@/lib/team/roles";
import { requireActiveUser, requirePersonalUser } from "@/lib/auth/require-user";
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
  const user = await requirePersonalUser();

  const parsed = profileSchema.safeParse({ name: formData.get("name") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name } });
  revalidatePath("/dashboard", "layout");
  return { saved: true };
}

export async function saveBusiness(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("settings", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

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
// What "the account" is depends on the role:
//  - a teammate (Admin or Member): only their own login and membership; the company carries on;
//  - the Owner: the whole company. With teammates this needs an explicit tick (or transfer ownership first), and the
//    paid plan is cancelled at the end of its period first, so nobody is charged after asking to leave;
//  - the person whose login is the company account but who handed ownership on: must hand it back or ask support,
//    because deleting that login would erase the company.
export async function scheduleAccountDeletion(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const company = await requireActiveUser();
  const actorId = company.actorId;
  const companyId = company.id;

  const typed = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (!company.email || typed !== company.email.toLowerCase()) {
    return { fieldErrors: { confirmEmail: "Type your email address exactly as shown." } };
  }

  const wholeCompany = company.role === "OWNER";
  if (!wholeCompany && actorId === companyId) {
    return { error: "This sign-in holds the company account. Ask the current owner to transfer ownership back to you, or contact support." };
  }
  if (wholeCompany) {
    const others = await prisma.membership.count({ where: { businessId: company.businessId, userId: { not: actorId } } });
    if (others > 0 && formData.get("deleteCompany") !== "on") {
      return { error: `Your company has ${others} other ${others === 1 ? "user" : "users"}. Transfer ownership first (Settings → Team), or tick the box to delete the company for everyone.` };
    }
    const sub = await prisma.subscription.findUnique({ where: { userId: companyId } });
    if (sub?.provider && sub.providerSubscriptionId && !sub.cancelAtPeriodEnd && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) {
      try {
        const updated = await billingAdapter(sub.provider).cancelAtPeriodEnd(sub.providerSubscriptionId);
        await applyProviderSubscription(sub.provider, updated);
      } catch (error) {
        await logError(error, { source: "settings.delete.cancel-billing", userId: companyId });
        return { error: "We could not cancel your plan's billing just now, so nothing was changed. Please try again in a few minutes." };
      }
    }
  }

  const when = new Date(Date.now() + DELETION_GRACE_DAYS * DAY_MS);
  // The company account's flag locks the whole company (getAppContext and checkActiveUser read it); the person's own flag locks their login.
  await prisma.user.updateMany({ where: { id: { in: wholeCompany ? [...new Set([actorId, companyId])] : [actorId] } }, data: { deletionScheduledFor: when } });
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?notice=deletion-scheduled");
}
