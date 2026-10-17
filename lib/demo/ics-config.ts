// The demo calendar invite route's settings (app/api/demo/ics/[token]/route.ts). Kept out of the route file: a Next
// route file may export only its handlers and route options, so plain values live here.
import type { RateLimitRule } from "@/lib/rate-limit";

/** How long after the call the invite can still be fetched. */
export const SERVE_AFTER_END_MS = 24 * 60 * 60 * 1000;
/** Invites one address may fetch an hour. */
export const ICS_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 } satisfies RateLimitRule;
