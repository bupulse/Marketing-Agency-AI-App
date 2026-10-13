"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { ContentSettingsError, saveContentSettings } from "@/lib/content-board/settings-service";
import type { ContentSettingsInput } from "@/lib/content-board/settings";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError } from "@/lib/team/roles";

export type SettingsResult = { ok: true } | { ok: false; error: string };

/** Content -> Settings: which apps need approval. Owners and Admins only (checked again in the service), audited. */
export async function saveContentSettingsAction(input: ContentSettingsInput): Promise<SettingsResult> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("contentSettings", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    await rateLimit(`content:settings:${user.actorId}`, { limit: 30, windowSeconds: 60 * 60 });
    await saveContentSettings({ actorId: user.actorId, role: user.role, businessId: user.businessId }, input);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    if (error instanceof ForbiddenError || error instanceof ContentSettingsError) return { ok: false, error: error.message };
    await logError(error, { source: "content.settings" });
    return { ok: false, error: "We could not save that. Please try again." };
  }
  revalidatePath("/dashboard/content", "layout");
  return { ok: true };
}
