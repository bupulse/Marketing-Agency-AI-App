import { currentPlatform, type Platform } from "./detect";

// Time limits of the host, for work that must finish inside one request (cron runs, publishing).
// Cloudflare: no wall-clock limit for a request once the CPU limit is raised (wrangler.jsonc), so the code's own
// budgets apply. Netlify: a function stops after 60 s, whatever the plan, so budgets are cut to leave room for the
// work already in flight when the budget runs out.

/** Netlify's synchronous function limit (all plans, not configurable). */
export const NETLIFY_FUNCTION_LIMIT_MS = 60_000;

/**
 * `defaultMs` on hosts without a request time limit, else the smaller of it and `netlifyMs`.
 * Example: the publisher claims posts for 45 s on Cloudflare, but only for 15 s on Netlify.
 */
export function timeBudget(defaultMs: number, netlifyMs: number, platform: Platform = currentPlatform()): number {
  return platform === "netlify" ? Math.min(defaultMs, netlifyMs) : defaultMs;
}

/** True when the host stops a request after a fixed time (Netlify), so long jobs must do less per call. */
export function hasShortRequestLimit(platform: Platform = currentPlatform()): boolean {
  return platform === "netlify";
}
