"use server";

import { revalidatePath } from "next/cache";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { writeAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import { requestIp } from "@/lib/request-limits";
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

/**
 * admin@bupulse.com removes an outage that was not real (for example the "down for 4 hours 57 minutes" of 10 November
 * 2026, when GitHub's checks ran only every few hours). The uptime percentages are worked out from the stored outages,
 * so they correct themselves. Written to the audit log with what was removed.
 */
export async function removeOutageAction(formData: FormData): Promise<void> {
  const me = await requireSupportAgentPage();
  if (!me.owner) return;
  const id = String(formData.get("id") ?? "");
  if (!/^[a-z0-9]{10,40}$/.test(id)) return;
  const row = await prisma.uptimeIncident.findUnique({ where: { id } });
  if (!row) return;
  await prisma.$transaction(async (tx) => {
    await tx.uptimeIncident.delete({ where: { id } });
    await writeAudit(tx, { actor: `support:${me.email}`, ip: await requestIp(), viaApi: false }, "uptime_incident_remove", `uptime_incident:${id}`, {
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      minutes: row.minutes,
      reason: row.reason,
    }, null);
  });
  revalidatePath("/support/server");
}
