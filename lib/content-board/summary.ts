// The daily auto-approval summary (docs/CONTENT.md): once a day, from 08:00 in the business's time zone, the Owner
// (and Admins who chose alerts) get an email listing what was scheduled on its own since the last one, when each goes
// out, and a link to change or cancel it. The cron (/api/cron/content-summary) runs hourly; this file decides.
import "server-only";
import { siteUrl } from "@/lib/auth/site-url";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
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

/** A business sent at local 08:00 or later and seen again within 8 hours is either on the same local day or before
 * 08:00 the next day: never due. So "not sent in the last 8 hours" is a safe database pre-filter for summaryDue. */
const RECENT_SEND_MS = 8 * 60 * 60 * 1000;
const PAGE = 50;
/** One call stops starting new pages after this long and hands back a cursor (the cron calls again). */
const CALL_BUDGET_MS = 40_000;

/** Keyset cursor over (contentSummarySentAt asc nulls first, id): "<iso or null>|<id>". */
export function encodeCursor(row: { contentSummarySentAt: Date | null; id: string }): string {
  return `${row.contentSummarySentAt ? row.contentSummarySentAt.toISOString() : "null"}|${row.id}`;
}

export function decodeCursor(cursor: string | null | undefined): { sentAt: Date | null; id: string } | null {
  if (!cursor) return null;
  const at = cursor.indexOf("|");
  if (at < 0) return null;
  const [stamp, id] = [cursor.slice(0, at), cursor.slice(at + 1)];
  if (!id || id.length > 64) return null;
  if (stamp === "null") return { sentAt: null, id };
  const sentAt = new Date(stamp);
  return Number.isNaN(sentAt.getTime()) ? null : { sentAt, id };
}

/** Rows after the cursor in (sentAt asc nulls first, id asc) order. */
export function afterCursor(c: { sentAt: Date | null; id: string } | null): Prisma.BusinessWhereInput {
  if (!c) return {};
  if (!c.sentAt) return { OR: [{ contentSummarySentAt: null, id: { gt: c.id } }, { contentSummarySentAt: { not: null } }] };
  return { OR: [{ contentSummarySentAt: { gt: c.sentAt } }, { contentSummarySentAt: c.sentAt, id: { gt: c.id } }] };
}

/**
 * Sends the emails that are due. Reads only businesses that may be due (auto-scheduled posts in the last 3 days, no
 * email in the last 8 hours), the longest-waiting first, page by page through all of them; hands back `nextCursor` when
 * the call's time is up. Idempotent: a business is claimed by moving contentSummarySentAt from the value it was read
 * with (compare-and-set), so two runs never send twice; a failed send is not retried until the next day.
 */
export async function sendContentSummaries(now = new Date(), options: { cursor?: string | null; budgetMs?: number } = {}): Promise<{ checked: number; sent: number; nextCursor: string | null }> {
  const started = Date.now();
  const budget = options.budgetMs ?? CALL_BUDGET_MS;
  let cursor = decodeCursor(options.cursor);
  let checked = 0;
  let sent = 0;
  for (;;) {
    if (Date.now() - started > budget) return { checked, sent, nextCursor: cursor ? encodeCursor({ contentSummarySentAt: cursor.sentAt, id: cursor.id }) : null };
    const page = await prisma.business.findMany({
      where: {
        AND: [
          { OR: [{ contentSummarySentAt: null }, { contentSummarySentAt: { lt: new Date(now.getTime() - RECENT_SEND_MS) } }] },
          { posts: { some: { autoScheduledAt: { gte: new Date(now.getTime() - 3 * FIRST_LOOKBACK_MS), lte: now } } } },
          afterCursor(cursor),
        ],
      },
      orderBy: [{ contentSummarySentAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: PAGE,
      select: { id: true, name: true, timezone: true, contentSummarySentAt: true, user: { select: { email: true } } },
    });
    for (const business of page) {
      checked += 1;
      if (await sendOne(business, now)) sent += 1;
    }
    if (page.length < PAGE) return { checked, sent, nextCursor: null };
    const last = page[page.length - 1];
    cursor = { sentAt: last.contentSummarySentAt, id: last.id };
  }
}

async function sendOne(business: { id: string; name: string; timezone: string; contentSummarySentAt: Date | null; user: { email: string | null } }, now: Date): Promise<boolean> {
  const businessId = business.id;
  try {
    const zone = business.timezone || "UTC";
    const lastSentAt = business.contentSummarySentAt;
    if (!summaryDue({ zone, now, lastSentAt })) return false;
    const rows = await prisma.post.findMany({
      where: { businessId, autoScheduledAt: { gt: lastSentAt ?? new Date(now.getTime() - FIRST_LOOKBACK_MS), lte: now } },
      select: { id: true, network: true, status: true, text: true, title: true, scheduledAt: true, autoScheduledAt: true, productId: true, campaignId: true },
      orderBy: { scheduledAt: "asc" },
      take: 200,
    });
    const posts = selectSummaryPosts(rows, { now, lastSentAt });
    if (posts.length === 0) return false;
    const { count } = await prisma.business.updateMany({ where: { id: businessId, contentSummarySentAt: lastSentAt }, data: { contentSummarySentAt: now } });
    if (count === 0) return false;
    const email = summaryEmail({ businessName: business.name, zone, posts });
    let any = false;
    for (const to of await alertRecipients(businessId, business.user.email)) {
      if (await sendEmail({ to, subject: email.subject, html: email.html, text: email.text })) any = true;
    }
    return any;
  } catch (error) {
    await logError(error, { source: "content.summary", businessId });
    return false;
  }
}
