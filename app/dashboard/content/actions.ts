"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";
import { ContentSettingsError, saveContentSettings } from "@/lib/content-board/settings-service";
import type { ContentSettingsInput } from "@/lib/content-board/settings";
import { draftPostsFromContent } from "@/lib/content-board/drafts";
import { parseContentFilters, type ContentScope } from "@/lib/content-board/filters";
import { scheduleAll, schedulablePosts, type ScheduleAllResult, type SchedulablePost } from "@/lib/content-board/schedule-all";
import { parseLocalInput } from "@/lib/publishing/time";
import { prisma } from "@/lib/db";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError } from "@/lib/team/roles";
import { voicePreviewUrl } from "@/lib/ai/tts";
import { isVoiceId } from "@/lib/voice/voices";

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
    const { created, existing } = await draftPostsFromContent({ businessId: user.businessId }, content.id);
    revalidatePath("/dashboard/content", "layout");
    if (created > 0) return { ok: true, created };
    return { ok: false, error: existing > 0 ? "The posts for this content are already made: they are on this page." : "There was nothing to make posts from. Write the content again and try once more." };
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source: "content.drafts.manual" });
    return { ok: false, error: "We could not create the posts. Please try again." };
  }
}

type ScheduleUser = { id: string; businessId: string; zone: string };

/** "Schedule all my posts" runs for anyone who may schedule posts (`content`) on a plan with scheduling. */
async function scheduler(): Promise<ScheduleUser | { error: string }> {
  try {
    const user = await requireActiveUser("content", "throw");
    await assertFeature(user.businessId, "calendar");
    await rateLimit(`content:schedule-all:${user.id}`, { limit: 60, windowSeconds: 60 * 60 });
    const business = await prisma.business.findUnique({ where: { id: user.businessId }, select: { timezone: true } });
    if (!business) return { error: "We could not find your business." };
    return { id: user.id, businessId: user.businessId, zone: business.timezone || "UTC" };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError) return { error: error.message };
    if (error instanceof RateLimitError) return { error: rateLimitMessage(error) };
    throw error;
  }
}

function readScope(value: unknown): ContentScope | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { kind?: unknown; id?: unknown };
  if (v.kind === "general") return { kind: "general" };
  if ((v.kind === "product" || v.kind === "campaign") && typeof v.id === "string" && v.id.length <= 64) return { kind: v.kind, id: v.id };
  return null;
}

/** The view's posts not posted yet, with suggested best times (nothing is written). `query` is the page's filters. */
export async function previewScheduleAction(query: string, scope?: unknown): Promise<{ ok: true; posts: SchedulablePost[]; zone: string } | { ok: false; error: string }> {
  const user = await scheduler();
  if ("error" in user) return { ok: false, error: user.error };
  const filters = parseContentFilters(new URLSearchParams(String(query ?? "").replace(/^\?/, "").slice(0, 2000)));
  return { ok: true, zone: user.zone, posts: await schedulablePosts(user.businessId, filters, { zone: user.zone, now: new Date(), scope: readScope(scope) }) };
}

/** Schedules the chosen posts: `local` ("YYYY-MM-DDTHH:mm" in the business's zone) per post, or the best time. */
export async function scheduleAllAction(items: { id: string; local?: string | null }[]): Promise<({ ok: true } & ScheduleAllResult) | { ok: false; error: string }> {
  const user = await scheduler();
  if ("error" in user) return { ok: false, error: user.error };
  const list = (Array.isArray(items) ? items : []).slice(0, 100).flatMap((i) => {
    if (!i || typeof i.id !== "string" || i.id.length > 64) return [];
    if (!i.local) return [{ id: i.id }];
    const at = parseLocalInput(String(i.local), user.zone);
    return [{ id: i.id, at: at ?? new Date(0) }];
  });
  try {
    const result = await scheduleAll(user.businessId, list);
    revalidatePath("/dashboard/content", "layout");
    revalidatePath("/dashboard/calendar");
    return { ok: true, ...result };
  } catch (error) {
    await logError(error, { source: "content.schedule-all" });
    return { ok: false, error: "We could not schedule the posts. Please try again." };
  }
}

/** A voice's public sample from the voice service (costs no characters), for Content -> Settings. */
export async function previewVoiceAction(voiceId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const user = await requireActiveUser("content", "throw");
    await rateLimit(`content:voice-preview:${user.id}`, { limit: 60, windowSeconds: 60 * 60 });
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
  if (!isVoiceId(voiceId)) return { ok: false, error: "Pick one of the voices." };
  const url = await voicePreviewUrl(voiceId);
  return url ? { ok: true, url } : { ok: false, error: "This voice's sample is not available right now." };
}
