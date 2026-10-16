"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { resolveIndustryChoice } from "@/lib/industries/server";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { profileInputSchema, profileJson, type ProfileInput } from "@/lib/knowledge/profile";

/**
 * Knowledge base -> Company profile. Writes the name, website and sector columns (the same ones Settings and Brand ->
 * Your industry write), the profile JSON, and the service area into Business.knowledge.area (one value with the
 * business info card). Needs the `settings` permission, like the rest of the company's details.
 */
export async function saveProfile(input: ProfileInput): Promise<Result> {
  const parsed = profileInputSchema().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) };
  const data = parsed.data;
  const result = await knowledgeAction({ permission: "settings", limit: "profileSave", source: "knowledge.profile" }, async ({ businessId }) => {
    const current = await prisma.business.findUnique({ where: { id: businessId }, select: { industryId: true, knowledge: true } });
    const sector = await resolveIndustryChoice(data, { currentIndustryId: current?.industryId });
    if (!sector) return { unknownSector: true };
    const knowledge = current?.knowledge && typeof current.knowledge === "object" && !Array.isArray(current.knowledge) ? { ...(current.knowledge as Record<string, unknown>) } : {};
    if (data.serviceArea) knowledge.area = data.serviceArea;
    else delete knowledge.area;
    await prisma.business.update({
      where: { id: businessId },
      data: { name: data.name, website: data.website, ...sector, profile: profileJson(data) as Prisma.InputJsonValue, knowledge: knowledge as Prisma.InputJsonValue },
    });
    return { unknownSector: false };
  });
  if (!result.ok) return result;
  if (result.unknownSector) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { industry: "Choose your business sector from the list." } };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
