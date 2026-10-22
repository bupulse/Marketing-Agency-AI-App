"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { knowledgeAction, type Result } from "@/lib/knowledge/guard";
import { can } from "@/lib/team/roles";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { createReview as create, deleteReview as remove, setReviewPermission, updateReview as update } from "@/lib/knowledge/records";
import { reviewInputSchema, type ReviewInput } from "@/lib/knowledge/reviews";

/**
 * Knowledge base -> Reviews & testimonials. Adding and editing follow the `content` permission and plan feature
 * (Members too); the customer's permission to be quoted is consent for public posts, so only `settings` (Owner,
 * Admin) may grant or withdraw it.
 */
const id = z.string().min(1).max(60);

function refresh() {
  revalidatePath("/dashboard/knowledge/reviews");
  revalidatePath("/dashboard/knowledge");
}

/**
 * "Not in the future" against the latest day anywhere (UTC+14), so a review given today counts in every time zone.
 * The form checks the owner's own day first.
 */
const latestDay = () => new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);

function check(input: unknown) {
  const parsed = reviewInputSchema(latestDay()).safeParse(input);
  return parsed.success ? { data: parsed.data } : { failure: { ok: false as const, error: "Check the highlighted fields.", fieldErrors: fieldErrorMap(parsed.error) } };
}

/** `quiet` (the Business info quiz): no revalidation, so the page on screen is not rendered again inside the response. */
export async function createReview(input: ReviewInput, opts: { quiet?: boolean } = {}): Promise<Result<{ reviewId: string }>> {
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeCreate", source: "knowledge.review.create" }, async ({ businessId, role }) => ({
    // Consent decides what the AI may quote in public posts: only Owners and Admins can grant it.
    reviewId: await create(businessId, { ...checked.data, canPublish: can(role, "settings") && checked.data.canPublish }),
  }));
  if (result.ok && !opts?.quiet) refresh();
  return result;
}

export async function updateReview(reviewId: string, input: ReviewInput): Promise<Result> {
  if (!id.safeParse(reviewId).success) return { ok: false, error: "We could not find that review." };
  const checked = check(input);
  if (checked.failure) return checked.failure;
  const result = await knowledgeAction({ permission: "content", feature: "content", limit: "knowledgeEdit", source: "knowledge.review.update" }, async ({ businessId, role }) => {
    // A Member's edit keeps the stored permission (only Owners and Admins grant or withdraw it).
    await update(businessId, reviewId, can(role, "settings") ? checked.data : { ...checked.data, canPublish: undefined });
    return {};
  });
  if (result.ok) refresh();
  return result;
}

/** The "customer agreed to be quoted" switch on its own, from the list. */
export async function setReviewPublishable(reviewId: string, canPublish: boolean): Promise<Result> {
  const parsed = z.object({ id, canPublish: z.boolean() }).safeParse({ id: reviewId, canPublish });
  if (!parsed.success) return { ok: false, error: "We could not change that." };
  const result = await knowledgeAction({ permission: "settings", limit: "knowledgeEdit", source: "knowledge.review.permission" }, async ({ businessId }) => {
    await setReviewPermission(businessId, parsed.data.id, parsed.data.canPublish);
    return {};
  });
  if (result.ok) refresh();
  return result;
}

export async function deleteReview(reviewId: string): Promise<Result> {
  if (!id.safeParse(reviewId).success) return { ok: false, error: "We could not find that review." };
  const result = await knowledgeAction({ permission: "content", limit: "knowledgeEdit", source: "knowledge.review.delete" }, async ({ businessId }) => {
    await remove(businessId, reviewId);
    return {};
  });
  if (result.ok) refresh();
  return result;
}
