"use server";

import { publicSiteUrl } from "@/lib/auth/site-url";
import { dispatchOutsideCheck, type ManualCheckResult } from "@/lib/monitor/manual-check";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";
import { requireSupportAgentPage } from "@/lib/support/app-auth";
import { canSeeMonitoring } from "@/lib/support/roles";
import { checkOnce } from "@/scripts/monitor/uptime-check.mjs";

export type ManualCheckState = { error?: string; result?: ManualCheckResult };

/**
 * "Run a check now" on the Server page (technical staff and supervisors): times the same things as the outside check
 * (scripts/monitor/uptime-check.mjs: /api/status, then the home, pricing and sign-in pages) through the site's public
 * address, and starts GitHub's outside check too when GITHUB_REPO and GITHUB_TOKEN are set. The result is shown, not
 * stored: an uptime check row has no column to mark it as started by hand, and the 5-minute record stays the schedule's.
 * Once every 30 seconds per person.
 */
export async function runCheckNow(): Promise<ManualCheckState> {
  const me = await requireSupportAgentPage();
  if (!canSeeMonitoring(me.role)) return { error: "Only technical staff and supervisors can run a check." };
  try {
    await rateLimit(`support:server-check:${me.id}`, { limit: 1, windowSeconds: 30 });
  } catch (error) {
    if (error instanceof RateLimitError) return { error: `A check just ran. Try again in ${error.retryAfterSeconds} seconds.` };
    throw error;
  }
  const site = publicSiteUrl();
  const [result, outside] = await Promise.all([checkOnce(site), dispatchOutsideCheck(process.env)]);
  return { result: { ...result, checkedAt: new Date().toISOString(), site: site.replace(/^https?:\/\//, ""), outside } };
}
