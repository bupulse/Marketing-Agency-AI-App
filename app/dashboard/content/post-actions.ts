"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/require-user";
import { postWritingView, PostWriteError, restorePostVersion, rewritePost, type Actor, type PostWritingView } from "@/lib/content-flow/post-writing";
import { isRewritePart } from "@/lib/content-flow/versions";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError } from "@/lib/team/roles";
import type { UsageBlockReason } from "@/lib/usage";

// One post's caption, video script and ad headlines (docs/CONTENT.md): what the post's panel shows, "Generate again"
// and restoring a version. The `content` permission (Members included) and the `content` feature; scoped to the
// company's own posts by the service.

export type PostWritingResult = { ok: true; view: PostWritingView; message?: string } | { ok: false; error: string; blocked?: UsageBlockReason; quiet?: boolean };

const id = z.string().min(1).max(64);
const FAILED = "That did not work. Please try again.";

async function actor(): Promise<Actor | { error: string }> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("content", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!business) return { error: "Set up your business first." };
  const missing = await featureBlocked(business.id, "content");
  if (missing) return { error: missing };
  return { userId: user.id, businessId: business.id, actorId: user.actorId };
}

async function limited(key: string, rule: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS]): Promise<string | null> {
  try {
    await rateLimit(key, rule);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitMessage(error);
    throw error;
  }
}

function failure(error: unknown, source: string, a: Actor): PostWritingResult {
  if (error instanceof PostWriteError) return { ok: false, error: error.message, ...(error.blocked ? { blocked: error.blocked } : {}) };
  void logError(error, { source, userId: a.userId, businessId: a.businessId });
  return { ok: false, error: FAILED };
}

function refresh() {
  revalidatePath("/dashboard/content", "layout");
  revalidatePath("/dashboard/calendar");
}

/** The post's video script, ad headlines, versions and what can be written again. */
export async function loadPostWritingAction(postId: string): Promise<PostWritingResult> {
  if (!id.safeParse(postId).success) return { ok: false, error: "We could not find that post." };
  const a = await actor();
  // Not part of the plan (or the role): the post's detail simply has no panel.
  if ("error" in a) return { ok: false, error: a.error, quiet: true };
  try {
    return { ok: true, view: await postWritingView(a, postId) };
  } catch (error) {
    return failure(error, "content.post-writing.load", a);
  }
}

/** "Generate again": the whole post, its caption, its video script or its ad headlines. One text generation. */
export async function regeneratePostAction(postId: string, part: string): Promise<PostWritingResult> {
  if (!id.safeParse(postId).success || !isRewritePart(part)) return { ok: false, error: "We could not find that post." };
  const a = await actor();
  if ("error" in a) return { ok: false, error: a.error };
  const blocked = await limited(`content:regenerate:${a.businessId}`, RATE_LIMITS.contentRegenerate);
  if (blocked) return { ok: false, error: blocked };
  try {
    await rewritePost(a, postId, part);
    refresh();
    return { ok: true, view: await postWritingView(a, postId) };
  } catch (error) {
    return failure(error, "content.post-writing.regenerate", a);
  }
}

/** Brings an earlier version back as the newest one. Costs nothing. */
export async function restorePostVersionAction(postId: string, versionId: string): Promise<PostWritingResult> {
  if (!id.safeParse(postId).success || !id.safeParse(versionId).success) return { ok: false, error: "We could not find that version." };
  const a = await actor();
  if ("error" in a) return { ok: false, error: a.error };
  const blocked = await limited(`edit:${a.userId}`, RATE_LIMITS.contentEdit);
  if (blocked) return { ok: false, error: blocked };
  try {
    const { changed } = await restorePostVersion(a, postId, versionId);
    if (changed) refresh();
    return { ok: true, view: await postWritingView(a, postId), message: changed ? "Restored. It is the current version now." : "That version is already the current one." };
  } catch (error) {
    return failure(error, "content.post-writing.restore", a);
  }
}
