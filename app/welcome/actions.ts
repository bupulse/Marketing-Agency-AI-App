"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureAccount } from "@/lib/account";
import { fieldErrors, welcomeSchema, type FieldErrors } from "@/lib/auth/schemas";
import { getCurrentUser } from "@/lib/supabase/server";

export type WelcomeState = { error?: string; fieldErrors?: FieldErrors };

// Google sign-ups: save the organisation details, then open the dashboard.
export async function saveOrganisation(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await ensureAccount(user))) redirect("/login?error=confirm");

  const parsed = welcomeSchema.safeParse({
    organisationName: formData.get("organisationName") ?? "",
    ceoName: formData.get("ceoName") ?? "",
    industry: formData.get("industry") ?? "",
    country: formData.get("country") ?? "",
    phone: formData.get("phone") ?? "",
    website: formData.get("website") ?? "",
    terms: formData.get("terms") === "true",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { organisationName, ceoName, industry, country, phone, website } = parsed.data;
  await prisma.business.update({
    where: { userId: user.id },
    data: {
      name: organisationName,
      ceoName,
      industry,
      country,
      phone: phone ?? null,
      website: website ?? null,
      detailsCompletedAt: new Date(),
    },
  });
  redirect("/onboarding");
}
