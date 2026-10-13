"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CompanyBudgetExceededError } from "@/lib/ai/budget";
import { requireActiveUser } from "@/lib/auth/require-user";
import { confirmContest, DayRunError, MAX_BRIEF, MAX_OWN_CAPTION, MAX_OWN_MEDIA, runDayContent, type DayRunResult } from "@/lib/content-flow/service";
import { contestConfirmSchema } from "@/lib/content-flow/contest";
import { prisma } from "@/lib/db";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import { rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { NETWORKS } from "@/lib/social/types";
import { ForbiddenError } from "@/lib/team/roles";

const id = z.string().min(1).max(64);
const inputSchema = z.object({
  scope: z.discriminatedUnion("kind", [z.object({ kind: z.literal("product"), id }), z.object({ kind: z.literal("campaign"), id }), z.object({ kind: z.literal("general") })]),
  mode: z.enum(["ai", "describe", "own"]),
  design: z.enum(["ai", "free"]),
  networks: z.array(z.enum(NETWORKS as unknown as [string, ...string[]])).min(1, "Choose at least one app.").max(NETWORKS.length),
  brief: z.string().max(MAX_BRIEF, `Use ${MAX_BRIEF} characters or fewer.`).optional(),
  caption: z.string().max(MAX_OWN_CAPTION, `Use ${MAX_OWN_CAPTION} characters or fewer.`).optional(),
  mediaPaths: z.array(z.string().min(1).max(300)).max(MAX_OWN_MEDIA, `Choose up to ${MAX_OWN_MEDIA} photos or videos.`).optional(),
  overlays: z.boolean().optional(),
  perApp: z.number().int().min(1).max(10).optional(),
  price: z.enum(["auto", "with", "none"]).optional(),
  /** One per dialog opening: the same request is never run twice (double click, retry). */
  requestKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

export type DayRunInputForm = z.input<typeof inputSchema>;

/** "Create today's content" (docs/CONTENT.md): the day's posts for a product, campaign or General, as drafts. */
export async function createDayContentAction(input: DayRunInputForm): Promise<({ ok: true } & DayRunResult) | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("content", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return { ok: false, error: "Set up your business first." };
    const missing = (await featureBlocked(business.id, "content")) ?? (await featureBlocked(business.id, "calendar"));
    if (missing) return { ok: false, error: missing };
    await rateLimit(`content:day-run:${user.id}`, { limit: 30, windowSeconds: 60 * 60 });
    const result = await runDayContent({ userId: user.id, businessId: business.id }, { ...parsed.data, networks: parsed.data.networks as DayRunResult["failed"] });
    revalidatePath("/dashboard/content", "layout");
    revalidatePath("/dashboard", "layout");
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof DayRunError || error instanceof CompanyBudgetExceededError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source: "content-flow.run", userId: user.id });
    return { ok: false, error: "We could not make today's content just now. You were not charged for what was not made; please try again." };
  }
}

/**
 * The owner confirms a suggested contest's prize, end date and winner rule (docs/CONTENT.md). Promising a prize commits
 * the company, so it needs an Owner or Admin (the approval level of Content -> Settings), not a Member.
 */
export async function confirmContestAction(postId: string, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = contestConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the prize, end date and rules." };
  if (typeof postId !== "string" || postId.length > 64) return { ok: false, error: "We could not find that contest post." };
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser("contentSettings", "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return { ok: false, error: "Set up your business first." };
    await rateLimit(`content:contest:${user.id}`, { limit: 60, windowSeconds: 60 * 60 });
    await confirmContest({ userId: user.id, businessId: business.id }, postId, parsed.data);
    revalidatePath("/dashboard/content", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof DayRunError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source: "content-flow.contest", userId: user.id });
    return { ok: false, error: "We could not save that. Please try again." };
  }
}
