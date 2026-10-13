// The daily auto-approval summary (docs/CONTENT.md): once a day, from 08:00 in the business's time zone, the Owner
// (and Admins who chose alerts) get an email listing what was scheduled on its own since the last one, when each goes
// out, and a link to change or cancel it. The cron (/api/cron/content-summary) runs hourly; this file decides.
import "server-only";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { renderEmail, sendEmail } from "@/lib/publishing/email";
import { dayKey, zonedParts } from "@/lib/publishing/time";
import { alertRecipients } from "@/lib/team/recipients";
import { subjectHref } from "./grouping";
import { networkLabel } from "./labels";

/** Local hour from which the day's email may go. */
export const SUMMARY_HOUR = 8;
/** First email of a business: look back this far. */
export const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** Posts listed in one email; the rest are counted. */
export const MAX_LISTED = 20;
const BUSINESSES_PER_RUN = 100;

/** Is it time for this business's email? Not before 08:00 local, and once per local day. Pure. */
export function summaryDue(args: { zone: string; now: Date; lastSentAt: Date | null }): boolean {
  if (zonedParts(args.now, args.zone).hour < SUMMARY_HOUR) return false;
  return !args.lastSentAt || dayKey(args.lastSentAt, args.zone) !== dayKey(args.now, args.zone);
}

export interface SummaryPost {
  id: string;
  network: string;
  status: string;
  text: string;
  title: string | null;
  scheduledAt: Date | null;
  autoScheduledAt: Date | null;
  productId: string | null;
  campaignId: string | null;
}

/**
 * The posts one email lists: auto-scheduled after the last email (or in the last day for the first one) and not
 * auto-scheduled in the future of `now`, still going out or already out (a post the owner cancelled or took back
 * to review is left out). Soonest first. Pure.
 */
export function selectSummaryPosts(posts: readonly SummaryPost[], args: { now: Date; lastSentAt: Date | null }): SummaryPost[] {
  const since = args.lastSentAt ?? new Date(args.now.getTime() - FIRST_LOOKBACK_MS);
  return posts
    .filter((p) => p.autoScheduledAt && p.autoScheduledAt > since && p.autoScheduledAt <= args.now)
    .filter((p) => ["SCHEDULED", "PUBLISHING", "PUBLISHED", "NEEDS_ACTION"].includes(p.status))
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
}

const excerpt = (p: SummaryPost) => {
  const text = (p.title ?? p.text).replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 89)}…` : text || "(no text)";
};

/** The email for one business. Pure apart from the site URL. */
export function summaryEmail(args: { businessName: string; zone: string; posts: readonly SummaryPost[] }) {
  const when = new Intl.DateTimeFormat("en-US", { timeZone: args.zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const base = siteUrl();
  const listed = args.posts.slice(0, MAX_LISTED);
  const more = args.posts.length - listed.length;
  const count = args.posts.length === 1 ? "1 post was" : `${args.posts.length} posts were`;
  const lines = listed.map((p) => `${networkLabel(p.network)}, ${p.scheduledAt ? when.format(p.scheduledAt) : "soon"}: ${excerpt(p)}`);
  const links = listed.map((p) => ({
    label: `${networkLabel(p.network)} ${p.scheduledAt ? when.format(p.scheduledAt) : ""}`.trim(),
    url: `${base}${subjectHref(p.productId ? "product" : p.campaignId ? "campaign" : "general", p.productId ?? p.campaignId)}?post=${encodeURIComponent(p.id)}`,
  }));
  return {
    subject: `${count} scheduled for you`,
    ...renderEmail({
      heading: `${count} scheduled for you`,
      intro: `Your settings let these go out without waiting for your approval, so BuPulse scheduled ${args.posts.length === 1 ? "it" : "them"} for ${args.businessName} at the best time. You can still change or cancel any of them until it goes out.`,
      blocks: [{ label: "Scheduled", value: [...lines, ...(more > 0 ? [`and ${more} more`] : [])].join("\n") }],
      links,
      linksLabel: "Open a post",
      button: { label: "Review scheduled posts", url: `${base}/dashboard/content?auto=1&status=scheduled` },
      footer: `Choose which apps need your approval in Content, Settings: ${base}/dashboard/content/settings`,
    }),
  };
}

/**
 * Sends the emails that are due. Idempotent: a business is claimed by moving contentSummarySentAt from the value it
 * was read with (compare-and-set), so two runs never send twice; a failed send is not retried until the next day.
 */
export async function sendContentSummaries(now = new Date()): Promise<{ checked: number; sent: number }> {
  const recent = await prisma.post.groupBy({
    by: ["businessId"],
    where: { autoScheduledAt: { gte: new Date(now.getTime() - 3 * FIRST_LOOKBACK_MS), lte: now } },
    orderBy: { businessId: "asc" },
    take: BUSINESSES_PER_RUN,
  });
  let sent = 0;
  for (const { businessId } of recent) {
    try {
      const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, timezone: true, contentSummarySentAt: true, user: { select: { email: true } } } });
      if (!business) continue;
      const zone = business.timezone || "UTC";
      const lastSentAt = business.contentSummarySentAt;
      if (!summaryDue({ zone, now, lastSentAt })) continue;
      const rows = await prisma.post.findMany({
        where: { businessId, autoScheduledAt: { gt: lastSentAt ?? new Date(now.getTime() - FIRST_LOOKBACK_MS), lte: now } },
        select: { id: true, network: true, status: true, text: true, title: true, scheduledAt: true, autoScheduledAt: true, productId: true, campaignId: true },
        orderBy: { scheduledAt: "asc" },
        take: 200,
      });
      const posts = selectSummaryPosts(rows, { now, lastSentAt });
      if (posts.length === 0) continue;
      const { count } = await prisma.business.updateMany({ where: { id: businessId, contentSummarySentAt: lastSentAt }, data: { contentSummarySentAt: now } });
      if (count === 0) continue;
      const email = summaryEmail({ businessName: business.name, zone, posts });
      for (const to of await alertRecipients(businessId, business.user.email)) {
        if (await sendEmail({ to, subject: email.subject, html: email.html, text: email.text })) sent += 1;
      }
    } catch (error) {
      await logError(error, { source: "content.summary", businessId });
    }
  }
  return { checked: recent.length, sent };
}
