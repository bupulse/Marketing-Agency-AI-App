"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { BioError, saveBioPage } from "@/lib/bio/service";
import { prisma } from "@/lib/db";
import { validateBioSettings } from "@/lib/bio/view";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError } from "@/lib/team/roles";

export type SaveBioResult = { ok: true; missingPhotos: string[] } | { ok: false; errors: Record<string, string> };

/** Link in bio settings. Needs the `settings` permission, like the rest of the company's public details. */
export async function saveBioSettings(input: unknown): Promise<SaveBioResult> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("settings", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, errors: { form: error.message } };
    throw error;
  }
  const result = validateBioSettings(input);
  if (!result.ok) return result;
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return { ok: false, errors: { form: "Set up your business first." } };
  try {
    await rateLimit(`bioSave:${user.id}`, RATE_LIMITS.bioSave);
    const { missingPhotos } = await saveBioPage({ userId: user.id, businessId: business.id }, result.data);
    revalidatePath("/dashboard/bio");
    return { ok: true, missingPhotos };
  } catch (error) {
    if (error instanceof BioError) return { ok: false, errors: { [error.field]: error.message } };
    if (error instanceof RateLimitError) return { ok: false, errors: { form: rateLimitMessage(error) } };
    await logError(error, { source: "bio.save", userId: user.id });
    return { ok: false, errors: { form: "We could not save your page. Please try again." } };
  }
}
