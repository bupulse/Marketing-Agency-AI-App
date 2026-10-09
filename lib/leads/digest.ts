import "server-only";
import { prisma } from "@/lib/db";
import { isServiceEnabled } from "@/lib/admin/switch";
import { hasFeature } from "@/lib/entitlements";
import { alertRecipients } from "@/lib/team/recipients";
import { sendEmail } from "@/lib/publishing/email";
import { dayKey, isValidTimeZone, zonedParts } from "@/lib/publishing/time";
import { renderDigestEmail } from "./email";

export const DIGEST_HOUR = 8;
const DIGEST_PAGE_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the daily summary is due: it is 8 o'clock for the business and no summary went out today (local date). */
export function isDigestDue(timeZone: string, lastDigestAt: Date | null, now: Date): boolean {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  if (zonedParts(now, zone).hour !== DIGEST_HOUR) return false;
  return !lastDigestAt || dayKey(lastDigestAt, zone) !== dayKey(now, zone);
}

type DigestWidget = { businessId: string; lastDigestAt: Date | null; business: { id: string; name: string; timezone: string; user: { email: string } } };

export type DigestResult = { checked: number; due: number; sent: number; skipped: number; failed: number };

/**
 * Sends the daily summary to every business for which it is 08:00 local time. Run hourly. Each business
 * claims lastDigestAt first (an atomic update), so overlapping runs from Cloudflare and GitHub send once;
 * a failed send gives the claim back so the next run in that hour can try again.
 */
export async function runLeadsDigest(now = new Date()): Promise<DigestResult> {
  const result: DigestResult = { checked: 0, due: 0, sent: 0, skipped: 0, failed: 0 };
  // Resend switched off in the admin console: do not start (no claims, nothing counted as failed). Leads stay in the dashboard.
  if (!(await isServiceEnabled("resend"))) return result;
  const since = new Date(now.getTime() - DAY_MS);
  // Only the time zones where it is 08:00 right now, so the query never reads the other businesses.
  const zones = (await prisma.business.groupBy({ by: ["timezone"] })).map((g) => g.timezone).filter((zone) => zonedParts(now, isValidTimeZone(zone) ? zone : "UTC").hour === DIGEST_HOUR);
  if (zones.length === 0) return result;
  const where = {
    notifyDaily: true,
    // A summary already sent in the last 20 hours cannot be due again, whatever the time zone.
    OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: new Date(now.getTime() - 20 * 60 * 60 * 1000) } }],
    business: { timezone: { in: zones }, user: { deletionScheduledFor: null, suspendedAt: null }, leads: { some: { OR: [{ createdAt: { gte: since } }, { status: "NEW" as const }] } } },
  };

  // Pages ordered by businessId, so every business is reached however many there are.
  let cursor: string | undefined;
  for (;;) {
    const widgets = await prisma.chatWidget.findMany({
      where,
      orderBy: { businessId: "asc" },
      take: DIGEST_PAGE_SIZE,
      ...(cursor ? { cursor: { businessId: cursor }, skip: 1 } : {}),
      select: { businessId: true, lastDigestAt: true, business: { select: { id: true, name: true, timezone: true, user: { select: { email: true } } } } },
    });
    cursor = widgets.at(-1)?.businessId;
    await processPage(widgets);
    if (widgets.length < DIGEST_PAGE_SIZE) return result;
  }

  async function processPage(widgets: DigestWidget[]) {
  for (const widget of widgets) {
    result.checked++;
    const { business } = widget;
    if (!isDigestDue(business.timezone, widget.lastDigestAt, now)) continue;
    // Website chat is a plan feature: a company without it gets no digest (its inbox is closed too).
    if (!(await hasFeature(business.id, "websiteChat"))) {
      result.skipped++;
      continue;
    }
    result.due++;
    try {
      const claimed = await prisma.chatWidget.updateMany({
        where: { businessId: business.id, lastDigestAt: widget.lastDigestAt },
        data: { lastDigestAt: now },
      });
      if (claimed.count !== 1) {
        result.skipped++;
        continue;
      }
      const [leads, openCount] = await Promise.all([
        prisma.lead.findMany({ where: { businessId: business.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50 }),
        prisma.lead.count({ where: { businessId: business.id, status: "NEW" } }),
      ]);
      if ((leads.length === 0 && openCount === 0) || !business.user.email) {
        result.skipped++;
        continue;
      }
      const mail = renderDigestEmail({ leads, openCount, businessName: business.name, timeZone: isValidTimeZone(business.timezone) ? business.timezone : "UTC" });
      const recipients = await alertRecipients(business.id, business.user.email);
      const results = await Promise.all(recipients.map((to) => sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text })));
      const sent = results[0] ?? false; // the owner's copy decides whether the digest counts as sent
      if (sent) {
        result.sent++;
      } else {
        result.failed++;
        await prisma.chatWidget.updateMany({ where: { businessId: business.id, lastDigestAt: now }, data: { lastDigestAt: widget.lastDigestAt } });
      }
    } catch (error) {
      result.failed++;
      console.error("[leads.digest] failed for business", business.id, error instanceof Error ? error.message : error);
    }
  }
  }
}
