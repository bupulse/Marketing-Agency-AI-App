import "server-only";
import { prisma } from "@/lib/db";

export type RateLimitRule = { limit: number; windowSeconds: number };

/** Limits for actions that are free to the user but cost storage or compute. Per user. */
export const RATE_LIMITS = {
  templateDesign: { limit: 60, windowSeconds: 60 * 60 }, // 60 template designs an hour
  designPreview: { limit: 120, windowSeconds: 60 * 60 },
  photoUpload: { limit: 60, windowSeconds: 60 * 60 },
  projectCreate: { limit: 30, windowSeconds: 60 * 60 },
  contentEdit: { limit: 120, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests");
  }
}

/**
 * Counts one hit for `key` in the current fixed window and throws RateLimitError when the limit is
 * exceeded. One atomic upsert-increment, so parallel requests can't slip past the limit.
 */
export async function rateLimit(key: string, rule: RateLimitRule, now = new Date()): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > rule.limit) {
    throw new RateLimitError(Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  }
}

/** Friendly text for a RateLimitError. */
export function rateLimitMessage(error: RateLimitError) {
  const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
  return `You're doing that a lot. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Old windows are useless after they end; the daily purge job may call this. */
export async function pruneRateLimits(olderThan = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)) {
  await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: olderThan } } });
}
