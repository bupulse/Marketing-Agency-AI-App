"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { ContentSettingsError, saveContentSettings } from "@/lib/content-board/settings-service";
import type { ContentSettingsInput } from "@/lib/content-board/settings";
import { draftPostsFromContent } from "@/lib/content-board/drafts";
import { prisma } from "@/lib/db";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
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

/** "Create posts from this content": drafts a post per app for a content version that has none (docs/CONTENT.md). */
export async function createPostsFromContentAction(contentId: string): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("content", "throw");
    await assertFeature(user.businessId, "calendar");
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    await rateLimit(`content:drafts:${user.id}`, { limit: 60, windowSeconds: 60 * 60 });
    const content = await prisma.generatedContent.findFirst({ where: { id: String(contentId), businessId: user.businessId }, select: { id: true } });
    if (!content) return { ok: false, error: "We could not find that content." };
    const { created } = await draftPostsFromContent({ businessId: user.businessId }, content.id);
    revalidatePath("/dashboard/content", "layout");
    return created > 0 ? { ok: true, created } : { ok: false, error: "There was nothing to make posts from. Write the content again and try once more." };
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source: "content.drafts.manual" });
    return { ok: false, error: "We could not create the posts. Please try again." };
  }
}
