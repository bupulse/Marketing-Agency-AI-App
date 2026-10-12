// The checks every Knowledge base action starts with: the signed-in, active person, their role, the company, the plan
// feature and the rate limit; expected failures become a message the owner can read.
import "server-only";
import { prisma } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth/require-user";
import { featureBlocked } from "@/lib/entitlements";
import { logError } from "@/lib/errors";
import type { FeatureKey } from "@/lib/features";
import { MediaError } from "@/lib/media/service";
import { RATE_LIMITS, rateLimit, rateLimitMessage, RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError, type Permission } from "@/lib/team/roles";
import { KnowledgeError } from "./service";

export type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type Result<T = object> = ({ ok: true } & T) | Failure;
export type Ctx = { userId: string; businessId: string };

export const SAVE_FAILED = "We could not save that. Please try again.";

/**
 * Runs `fn` for the signed-in person's company. Products, campaigns and their albums follow the `content` permission
 * (Members may create and edit them, like projects before); the company profile needs `settings`.
 */
export async function knowledgeAction<T extends object>(
  opts: { permission: Permission; feature?: FeatureKey; limit?: keyof typeof RATE_LIMITS; source: string },
  fn: (ctx: Ctx) => Promise<T>,
): Promise<Result<T>> {
  let user: Awaited<ReturnType<typeof requireActiveUser>>;
  try {
    user = await requireActiveUser(opts.permission, "throw");
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
  try {
    const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!business) return { ok: false, error: "Set up your business first." };
    if (opts.feature) {
      const missing = await featureBlocked(business.id, opts.feature);
      if (missing) return { ok: false, error: missing };
    }
    if (opts.limit) await rateLimit(`${opts.limit}:${user.id}`, RATE_LIMITS[opts.limit]);
    return { ok: true, ...(await fn({ userId: user.id, businessId: business.id })) };
  } catch (error) {
    if (error instanceof KnowledgeError || error instanceof MediaError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: rateLimitMessage(error) };
    await logError(error, { source: opts.source, userId: user.id });
    return { ok: false, error: SAVE_FAILED };
  }
}
