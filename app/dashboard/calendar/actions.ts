"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { ForbiddenError, type Permission } from "@/lib/team/roles";
import { assertFeature, FeatureRequiredError } from "@/lib/entitlements";
import type { FeatureKey } from "@/lib/features";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";
import { publishPostsNow } from "@/lib/publishing/engine";
import { PUBLISHING_LIMITS } from "@/lib/publishing/limits";
import { loadComposerContext } from "@/lib/publishing/queries";
import { timezoneSchema } from "@/lib/publishing/schemas";
import {
  approvePosts,
  createPosts,
  deletePost,
  duplicatePost,
  markPosted,
  PublishingError,
  reschedulePost,
  retryPost,
  unschedulePost,
  setBusinessTimezone,
  updatePost,
  type Owner,
} from "@/lib/publishing/service";
import type { PostStatusName } from "@/lib/publishing/status";
import type { ActionFailure, ActionResult, ComposeInput, ComposerContext, EditInput, PostOutcome } from "@/lib/publishing/types";
import { createClient } from "@/lib/supabase/server";
import { signPaths } from "@/lib/publishing/media";
import type { Network } from "@/lib/social/types";

const SAVE_FAILED = "We could not save that. Please try again.";

/** Every action re-checks the signed-in user and only touches their own business. */
async function owner(permission?: Permission, feature: FeatureKey | null = "calendar"): Promise<Owner | null> {
  const user = await requireActiveUser(permission, "throw");
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (business && feature) await assertFeature(business.id, feature);
  return business ? { businessId: business.id, userId: user.id } : null;
}

async function limited(userId: string, name: keyof typeof PUBLISHING_LIMITS, rule: RateLimitRule = PUBLISHING_LIMITS[name]): Promise<ActionFailure | null> {
  try {
    await rateLimit(`publishing:${name}:${userId}`, rule);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    throw error;
  }
}

function failure(error: unknown, source: string): ActionFailure {
  if (error instanceof PublishingError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
  void logError(error, { source: `publishing.${source}` });
  return { ok: false, error: SAVE_FAILED };
}

function refresh() {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/content");
  revalidatePath("/dashboard/knowledge/products/[id]", "page");
  revalidatePath("/dashboard/knowledge/campaigns/[id]", "page");
}

/** Wraps an action: sign-in check, business lookup, plan feature (the calendar unless told otherwise), rate limit, error mapping, revalidation. */
async function run<T extends object>(
  name: string,
  limit: keyof typeof PUBLISHING_LIMITS,
  body: (o: Owner) => Promise<T>,
  permission?: Permission,
  feature: FeatureKey | null = "calendar",
): Promise<ActionResult<T>> {
  let o: Owner | null;
  try {
    o = await owner(permission, feature);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof FeatureRequiredError) return { ok: false, error: error.message };
    throw error;
  }
  if (!o) return { ok: false, error: "Set up your business first." };
  const blocked = await limited(o.userId, limit);
  if (blocked) return blocked;
  try {
    const result = await body(o);
    refresh();
    return { ok: true, ...result };
  } catch (error) {
    return failure(error, name);
  }
}

async function outcomes(businessId: string, ids: string[]): Promise<PostOutcome[]> {
  const rows = await prisma.post.findMany({ where: { id: { in: ids }, businessId }, select: { id: true, network: true, status: true, lastError: true } });
  return rows.map((r) => ({ id: r.id, network: r.network as Network, status: r.status as PostStatusName, error: r.lastError }));
}

/** Creates posts for the chosen accounts. "Post now" also sends them right away and reports how each ended. */
export async function createPostsAction(input: ComposeInput): Promise<ActionResult<{ groupId: string; postIds: string[]; scheduledAt: string | null; status: PostStatusName; outcomes: PostOutcome[] }>> {
  return run("create", input.when?.mode === "now" ? "publishNow" : "compose", async (o) => {
    const created = await createPosts(o, input);
    let result: PostOutcome[] = [];
    if (input.when.mode === "now") {
      await publishPostsNow(o.businessId, created.postIds);
      result = await outcomes(o.businessId, created.postIds);
    }
    return { groupId: created.groupId, postIds: created.postIds, scheduledAt: created.scheduledAt?.toISOString() ?? null, status: created.status, outcomes: result };
  });
}

export async function updatePostAction(postId: string, input: EditInput): Promise<ActionResult<{ status: PostStatusName; scheduledAt: string | null; outcomes: PostOutcome[] }>> {
  return run("update", input.when?.mode === "now" ? "publishNow" : "compose", async (o) => {
    const updated = await updatePost(o, postId, input);
    let result: PostOutcome[] = [];
    if (input.when.mode === "now") {
      await publishPostsNow(o.businessId, [postId]);
      result = await outcomes(o.businessId, [postId]);
    }
    return { status: updated.status, scheduledAt: updated.scheduledAt?.toISOString() ?? null, outcomes: result };
  });
}

export async function reschedulePostAction(postId: string, scheduledAtIso: string): Promise<ActionResult> {
  return run("reschedule", "compose", async (o) => {
    await reschedulePost(o, String(postId), new Date(scheduledAtIso));
    return {};
  });
}

export async function duplicatePostAction(postId: string): Promise<ActionResult<{ id: string }>> {
  return run("duplicate", "compose", (o) => duplicatePost(o, String(postId)));
}

export async function deletePostAction(postId: string): Promise<ActionResult<{ note?: string }>> {
  return run("delete", "compose", (o) => deletePost(o, String(postId)));
}

export async function approvePostsAction(postIds: string[]): Promise<ActionResult<{ approved: number }>> {
  return run("approve", "compose", (o) => approvePosts(o.businessId, Array.isArray(postIds) ? postIds.map(String) : []));
}

/** Takes a scheduled post back to "Needs review" (auto-approval's safety window). */
export async function unschedulePostAction(postId: string): Promise<ActionResult> {
  return run("unschedule", "compose", async (o) => {
    await unschedulePost(o, String(postId));
    return {};
  });
}

/** Puts a failed post back in line and tries to publish it straight away. */
export async function retryPostAction(postId: string): Promise<ActionResult<{ outcomes: PostOutcome[] }>> {
  return run("retry", "publishNow", async (o) => {
    await retryPost(o, String(postId));
    await publishPostsNow(o.businessId, [String(postId)]);
    return { outcomes: await outcomes(o.businessId, [String(postId)]) };
  });
}

export async function markPostedAction(postId: string): Promise<ActionResult> {
  return run("mark-posted", "compose", async (o) => {
    await markPosted(o.businessId, String(postId));
    return {};
  });
}

export async function setTimezoneAction(timezone: string): Promise<ActionResult> {
  const parsed = timezoneSchema.safeParse(timezone);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick a time zone." };
  // The company's time zone is a setting, not a calendar feature: every plan may set it.
  return run("timezone", "compose", async (o) => {
    await setBusinessTimezone(o.businessId, parsed.data);
    revalidatePath("/dashboard", "layout");
    return {};
  }, "settings", null);
}

/** For the "Schedule" buttons on content: loads what the composer needs when it is opened. */
export async function loadComposerContextAction(): Promise<ActionResult<{ context: ComposerContext }>> {
  return run("context", "mediaList", async (o) => ({ context: await loadComposerContext(o.businessId) }));
}

export type DesignChoice = { id: string; path: string; url: string; width: number; height: number; aspectRatio: string };

/** The business's own designs (the "designs" bucket) to attach to a post, with signed preview links. */
export async function listDesignsAction(): Promise<ActionResult<{ designs: DesignChoice[] }>> {
  return run("designs", "mediaList", async (o) => {
    const rows = await prisma.design.findMany({ where: { businessId: o.businessId }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, path: true, width: true, height: true, aspectRatio: true } });
    const signed = rows.length ? await signPaths(await createClient(), rows.map((r) => r.path), 60 * 60) : new Map<string, string>();
    return { designs: rows.flatMap((r) => (signed.has(r.path) ? [{ ...r, url: signed.get(r.path) as string }] : [])) };
  });
}

/**
 * First visit: a business still on "UTC" takes the browser's time zone. Does nothing if the zone was already set
 * (only a business on UTC is touched), so it never overrides a choice made in the calendar.
 */
export async function autoSetTimezoneAction(timezone: string): Promise<ActionResult<{ changed: boolean }>> {
  const parsed = timezoneSchema.safeParse(timezone);
  if (!parsed.success) return { ok: false, error: "Unknown time zone." };
  return run("auto-timezone", "compose", async (o) => {
    // No revalidation: it would refresh whatever page the user has moved on to (see AutoTimezone).
    const { count } = await prisma.business.updateMany({ where: { id: o.businessId, timezone: "UTC" }, data: { timezone: parsed.data } });
    return { changed: count > 0 };
  }, "settings", null);
}
