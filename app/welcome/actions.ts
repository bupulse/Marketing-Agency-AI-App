"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { fieldErrors, welcomeSchema, type FieldErrors } from "@/lib/auth/schemas";
import { regionFromCountryName } from "@/lib/region";
import { timezoneForCountryName } from "@/lib/region-format";
import { resolveIndustryChoice } from "@/lib/industries/server";

export type WelcomeState = { error?: string; fieldErrors?: FieldErrors };

// Google sign-ups: save the organisation details, then open the dashboard.
export async function saveOrganisation(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const user = await requireActiveUser("settings");

  // Once the details are saved the country is fixed, so a later save checks the phone against the STORED country,
  // not whatever was posted.
  const saved = await prisma.business.findUnique({ where: { userId: user.id }, select: { country: true, detailsCompletedAt: true } });
  const lockedCountry = saved?.detailsCompletedAt ? saved.country : null;

  const parsed = welcomeSchema.safeParse({
    organisationName: formData.get("organisationName") ?? "",
    ceoName: formData.get("ceoName") ?? "",
    industry: formData.get("industry") ?? "",
    industryOther: formData.get("industryOther") ?? "",
    industryDescription: formData.get("industryDescription") ?? "",
    country: lockedCountry ?? formData.get("country") ?? "",
    phone: formData.get("phone") ?? "",
    website: formData.get("website") ?? "",
    terms: formData.get("terms") === "true",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { organisationName, ceoName, country, phone, website } = parsed.data;
  const sector = await resolveIndustryChoice(parsed.data);
  if (!sector) return { fieldErrors: { industry: "Choose your business sector from the list." } };
  // The phone is stored as E.164 ("+250791954277"); the sector writes industryId / industryOther and the legacy label.
  const details = { name: organisationName, ceoName, ...sector, phone: phone ?? null, website: website ?? null };
  // The country, and with it the pricing region (and the time zone where the country has one), are set once: on the
  // first save, while the details are still missing. A server action is a public POST, so a later call must not let
  // the owner move the company to another region's prices; from then on only an admin changes the region (audited).
  const timezone = timezoneForCountryName(country);
  const first = await prisma.business.updateMany({
    where: { userId: user.id, detailsCompletedAt: null },
    data: { ...details, country, pricingRegion: await regionFromCountryName(country), ...(timezone ? { timezone } : {}), detailsCompletedAt: new Date() },
  });
  if (first.count === 0) await prisma.business.update({ where: { userId: user.id }, data: details });
  redirect("/onboarding");
}
