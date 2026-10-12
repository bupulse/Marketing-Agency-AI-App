import "server-only";
import { rateLimit, rateLimitMessage, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";

// Server actions are public POST endpoints: a few tries an hour per company is plenty for a person and stops a loop
// from spamming the owner with invites (each booking emails every admin address). Kept out of the "use server" files:
// everything exported from those becomes a callable endpoint, and only async actions belong there.
export const DEMO_LIMITS = {
  choose: { limit: 10, windowSeconds: 60 * 60 },
  book: { limit: 5, windowSeconds: 60 * 60 },
  cancel: { limit: 5, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/** The rate limit for a demo action, as the message to answer with, or null to go on. */
export async function demoLimited(businessId: string, kind: keyof typeof DEMO_LIMITS): Promise<string | null> {
  try {
    await rateLimit(`demo:${kind}:${businessId}`, DEMO_LIMITS[kind]);
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitMessage(error);
    throw error;
  }
}
