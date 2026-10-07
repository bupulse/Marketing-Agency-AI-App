import type { RateLimitRule } from "@/lib/rate-limit";

/** Composer and calendar actions are free to the user but cost database writes and provider calls. Per user. */
export const PUBLISHING_LIMITS = {
  compose: { limit: 120, windowSeconds: 60 * 60 }, // create, edit, duplicate, delete, move, approve
  publishNow: { limit: 40, windowSeconds: 60 * 60 }, // "Post now" and "Retry" call the network straight away
  mediaList: { limit: 120, windowSeconds: 60 * 60 },
  upload: { limit: 60, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;
