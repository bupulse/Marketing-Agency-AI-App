import "server-only";
import { publishTimingNote } from "@/lib/platform/limits";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getProvider, isNetwork } from "@/lib/social/registry";
import { NETWORKS, type Network } from "@/lib/social/types";
import { createClient } from "@/lib/supabase/server";
import { signPaths } from "./media";
import { accountUsable } from "./service";
import { cleanSlotTimes } from "./slots";
import type { PostStatusName } from "./status";
import type { CalendarPost, ComposerAccount, ComposerContext } from "./types";
import type { PostFormatName, RuleSummary } from "./validate";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The calendar loads this much history and future at once. */
export const CALENDAR_PAST_DAYS = 60;
export const CALENDAR_FUTURE_DAYS = 240;

const postInclude = { connection: { select: { displayName: true, avatarUrl: true, postingMode: true } } } satisfies Prisma.PostInclude;
type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

const FALLBACK_PROBLEM: Record<string, string> = {
  EXPIRED: "Needs to be reconnected",
  REVOKED: "Access was removed. Reconnect it",
  ERROR: "Needs attention",
};

function ruleSummary(network: Network): RuleSummary {
  const r = getProvider(network).rules;
  return { network: r.network, label: r.label, maxText: r.maxText, maxHashtags: r.maxHashtags, requiresMedia: r.requiresMedia, maxImages: r.maxImages, formats: r.formats, videoOnly: r.videoOnly };
}

/** Everything the composer needs: accounts to pick, each network's rules, the time zone and queue times. */
export async function loadComposerContext(businessId: string): Promise<ComposerContext> {
  const [connections, business, autopilot] = await Promise.all([
    prisma.connection.findMany({ where: { businessId, kind: "SOCIAL" }, orderBy: { createdAt: "asc" } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
    prisma.autopilotSettings.findUnique({ where: { businessId }, select: { postingTimes: true } }),
  ]);
  const accounts: ComposerAccount[] = connections.flatMap((c) => {
    if (!isNetwork(c.provider)) return [];
    const usable = accountUsable(c);
    return [
      {
        id: c.id,
        network: c.provider,
        label: getProvider(c.provider).rules.label,
        displayName: c.displayName ?? getProvider(c.provider).rules.label,
        avatarUrl: c.avatarUrl,
        accountType: c.accountType,
        notify: c.postingMode === "NOTIFY",
        usable,
        problem: usable ? undefined : (FALLBACK_PROBLEM[c.status] ?? "Needs to be reconnected"),
      },
    ];
  });
  const present = new Set(accounts.map((a) => a.network));
  const rules: ComposerContext["rules"] = {};
  for (const network of NETWORKS) if (present.has(network)) rules[network] = ruleSummary(network);
  return { accounts, rules, timezone: business?.timezone || "UTC", slotTimes: cleanSlotTimes(autopilot?.postingTimes), timingNote: publishTimingNote() };
}

/** Post rows as the calendar shows them, with signed links for their photos. */
export async function toCalendarPosts(rows: PostRow[]): Promise<CalendarPost[]> {
  const paths = [...new Set(rows.flatMap((r) => r.mediaPaths))];
  let signed = new Map<string, string>();
  if (paths.length > 0) {
    try {
      signed = await signPaths(await createClient(), paths, 2 * 60 * 60);
    } catch {
      // Cards without thumbnails are better than no calendar.
    }
  }
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    network: r.network as Network,
    connectionId: r.connectionId,
    accountName: r.connection?.displayName ?? (isNetwork(r.network) ? getProvider(r.network).rules.label : r.network),
    accountAvatar: r.connection?.avatarUrl ?? null,
    notify: r.connection?.postingMode === "NOTIFY",
    status: r.status as PostStatusName,
    format: r.format as PostFormatName | "ARTICLE" | "THREAD",
    source: r.source,
    title: r.title,
    text: r.text,
    hashtags: r.hashtags,
    link: r.link,
    mediaPaths: r.mediaPaths,
    media: r.mediaPaths.flatMap((path) => (signed.has(path) ? [{ path, url: signed.get(path) as string }] : [])),
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    permalink: r.permalink,
    lastError: r.lastError,
    subjectId: r.productId ?? r.campaignId ?? r.projectId,
    contentId: r.contentId,
    reviewNote: r.reviewNote,
    autoScheduledAt: r.autoScheduledAt?.toISOString() ?? null,
  }));
}

/** Posts around today (and every draft without a date) for the calendar and the queue list. */
export async function loadCalendarPosts(businessId: string, now = new Date()): Promise<CalendarPost[]> {
  const rows = await prisma.post.findMany({
    where: {
      businessId,
      OR: [
        { scheduledAt: { gte: new Date(now.getTime() - CALENDAR_PAST_DAYS * DAY_MS), lte: new Date(now.getTime() + CALENDAR_FUTURE_DAYS * DAY_MS) } },
        { scheduledAt: null, status: { in: ["DRAFT", "FAILED", "NEEDS_ACTION"] } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: 1500,
    include: postInclude,
  });
  return toCalendarPosts(rows);
}
