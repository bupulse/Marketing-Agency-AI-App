"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { fieldErrors, industrySchema, type FieldErrors } from "@/lib/auth/schemas";
import { requireActiveUser } from "@/lib/auth/require-user";
import { resolveIndustryChoice } from "@/lib/industries/server";
import { ForbiddenError } from "@/lib/team/roles";

export type IndustryState = { error?: string; saved?: boolean; fieldErrors?: FieldErrors };

/**
 * Brand -> Industry: the owner may change the sector, the "Other" text and the description at any time. The country
 * and the region are not here on purpose: they are set once at sign-up and changed only by an admin (docs/REGIONS.md).
 */
export async function saveIndustry(_prev: IndustryState, formData: FormData): Promise<IndustryState> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("settings", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const parsed = industrySchema.safeParse({
    industry: formData.get("industry") ?? "",
    industryOther: formData.get("industryOther") ?? "",
    industryDescription: formData.get("industryDescription") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const current = await prisma.business.findUnique({ where: { userId: user.id }, select: { industryId: true } });
  const sector = await resolveIndustryChoice(parsed.data, { currentIndustryId: current?.industryId });
  if (!sector) return { fieldErrors: { industry: "Choose your business sector from the list." } };

  // Writes industryId / industryOther / industryDescription and the legacy label (Business.industry) together.
  await prisma.business.update({ where: { userId: user.id }, data: sector });
  revalidatePath("/dashboard", "layout");
  return { saved: true };
}
