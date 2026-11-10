import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { PAGE_VIEW_DAYS } from "@/lib/analytics/rollup";
import { SUPPORT_OWNER_EMAIL, isSupportOwnerEmail } from "@/lib/support/owner";
import { CODE_RULE, COMPANY_NAME, LINK_COOKIE, channelLabel, cleanDestination, codeFromLabel, isChannel, leadOwnerOf, normalizeCode, type LeadChatAgent, type LeadOwner } from "./rules";

// Tracked links (docs/SUPPORT_DASHBOARD.md "Tracked links"). admin@bupulse.com (the support app's owner) sees and
// manages every link; any other staff member only their own (the owner, 10 November 2026).

export type LinkOwner = { id: string; owner?: boolean };

export class LinkError extends Error {}

const OWNER_EMAIL = SUPPORT_OWNER_EMAIL;

const isUniqueError = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** A new link. A typed code that is taken is refused; a made-up one is retried. */
export async function createTrackedLink(me: LinkOwner, input: { label: unknown; channel: unknown; destination: unknown; code?: unknown }) {
  const label = String(input.label ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  if (!label) throw new LinkError("Give the link a name, for example “Instagram bio”.");
  if (!isChannel(input.channel)) throw new LinkError("Choose where you will share the link.");
  const destination = cleanDestination(input.destination);
  if (!destination) throw new LinkError("Choose the page the link opens, or type a page of bupulse.com that starts with /.");
  const typed = String(input.code ?? "").trim();
  if (typed) {
    const code = normalizeCode(typed);
    if (!code) throw new LinkError("The link name after /go/ needs 3 to 40 letters, numbers or dashes.");
    try {
      return await prisma.trackedLink.create({ data: { code, label, channel: input.channel, destination, createdById: me.id } });
    } catch (e) {
      if (isUniqueError(e)) throw new LinkError(`bupulse.com/go/${code} is already taken. Try another name.`);
      throw e;
    }
  }
  for (let i = 0; i < 6; i++) {
    try {
      return await prisma.trackedLink.create({ data: { code: codeFromLabel(label), label, channel: input.channel, destination, createdById: me.id } });
    } catch (e) {
      if (!isUniqueError(e)) throw e;
    }
  }
  throw new LinkError("Could not make a free link name. Type one yourself.");
}

/** Archive (the short link still opens its page but counts nothing more) or bring back. Staff only their own links. */
export async function setTrackedLinkArchived(me: LinkOwner, id: string, archived: boolean): Promise<void> {
  const { count } = await prisma.trackedLink.updateMany({
    where: { id, ...(me.owner ? {} : { createdById: me.id }) },
    data: { archivedAt: archived ? new Date() : null },
  });
  if (!count) throw new LinkError("That link was not found.");
}

/**
 * The tracked link this visitor came through in the last 30 days (the cookie the /go route sets), or null. Read when a
 * quote request, a chat or a sign-up is saved; anything that goes wrong answers null and never blocks that.
 */
export async function currentTrackedLinkId(): Promise<string | null> {
  try {
    const id = (await cookies()).get(LINK_COOKIE)?.value;
    if (!id || !/^[a-z0-9]{10,40}$/.test(id)) return null;
    const link = await prisma.trackedLink.findUnique({ where: { id }, select: { id: true } });
    return link?.id ?? null;
  } catch {
    return null;
  }
}

/** byId/byName: who made the link; byOwner: admin@bupulse.com made it (a company link). */
export type LinkTag = { code: string; label: string; channel: string; byId: string | null; byName: string | null; byOwner: boolean };

/** "via ig-bio (Instagram, by Jean)" for leads: the links behind these ids. */
export async function linkTags(ids: (string | null | undefined)[]): Promise<Map<string, LinkTag>> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return new Map();
  const rows = await prisma.trackedLink.findMany({ where: { id: { in: wanted } }, select: { id: true, code: true, label: true, channel: true, createdBy: { select: { id: true, name: true, email: true } } } });
  return new Map(
    rows.map((r) => [r.id, { code: r.code, label: r.label, channel: r.channel, byId: r.createdBy?.id ?? null, byName: r.createdBy?.name ?? null, byOwner: !r.createdBy || isSupportOwnerEmail(r.createdBy.email) }]),
  );
}

/** One line for an alert or a lead: "Instagram bio (bupulse.com/go/ig-bio, Instagram, by Jean)". */
export function linkTagText(tag: LinkTag): string {
  const by = tag.byOwner ? "company link" : `${tag.byName ?? "staff"}'s link`;
  return `${tag.label} (bupulse.com/go/${tag.code}, ${channelLabel(tag.channel)}, ${by})`;
}

export async function linkTagFor(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const tag = (await linkTags([id])).get(id);
  return tag ? linkTagText(tag) : null;
}

export type LinkStats = { clicks: number; visitors: number; quotes: number; chats: number; signups: number; paid: number; countries: { country: string; clicks: number }[] };

export type LinkRow = {
  id: string;
  code: string;
  label: string;
  channel: string;
  destination: string;
  createdAt: string;
  archived: boolean;
  /** owner: made by admin@bupulse.com (or by someone since removed): a company link. */
  by: { id: string | null; name: string | null; owner: boolean };
  stats: LinkStats;
};

/** chatLeads: visitors who came from elsewhere (not another staff member's link) and this person talked to first in the chat. */
export type StaffLinkTotals = { id: string | null; name: string; company: boolean; links: number; chatLeads: number } & Omit<LinkStats, "countries">;

/** staff: the owner's leaderboard (company first-class row included); myChatLeads: a staff member's own chat leads. */
export type LinksReport = { links: LinkRow[]; staff: StaffLinkTotals[] | null; myChatLeads: number; visitorsFrom: string | null };

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const empty = (): LinkStats => ({ clicks: 0, visitors: 0, quotes: 0, chats: 0, signups: 0, paid: 0, countries: [] });

/**
 * The links this person may see with their results in the period (UTC days, from..to inclusive). Unique visitors come
 * from page views, which are kept 90 days: an older start is cut there (visitorsFrom says from when).
 */
export async function trackedLinksReport(me: LinkOwner, period: { from: string; to: string }, now = new Date()): Promise<LinksReport> {
  const start = new Date(`${period.from}T00:00:00Z`);
  const end = new Date(new Date(`${period.to}T00:00:00Z`).getTime() + 86_400_000);
  const keptFrom = new Date(now.getTime() - PAGE_VIEW_DAYS * 86_400_000);
  const viewsStart = start < keptFrom ? keptFrom : start;
  const range = { gte: start, lt: end };

  const links = await prisma.trackedLink.findMany({
    where: me.owner ? {} : { createdById: me.id },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: { id: true, code: true, label: true, channel: true, destination: true, createdAt: true, archivedAt: true, createdBy: { select: { id: true, name: true, email: true } } },
  });
  const ids = links.map((l) => l.id);
  const codes = links.map((l) => l.code).filter((c) => CODE_RULE.test(c));
  const stats = new Map<string, LinkStats>(ids.map((id) => [id, empty()]));
  if (ids.length) {
    const byCode = new Map(links.map((l) => [l.code, l.id]));
    const [clicks, countries, visitors, quotes, chats, signups, paid] = await Promise.all([
      prisma.trackedLinkClick.groupBy({ by: ["linkId"], where: { linkId: { in: ids }, createdAt: range }, _count: { _all: true } }),
      prisma.trackedLinkClick.groupBy({ by: ["linkId", "country"], where: { linkId: { in: ids }, createdAt: range, country: { not: null } }, _count: { _all: true } }),
      codes.length
        ? prisma.$queryRaw<{ code: string; visitors: bigint }[]>`
            SELECT "utmCampaign" AS code, COUNT(DISTINCT "visitorHash")::bigint AS visitors FROM "PageView"
            WHERE "utmMedium" = 'link' AND "utmCampaign" = ANY(${codes}) AND "createdAt" >= ${viewsStart} AND "createdAt" < ${end}
            GROUP BY 1`
        : Promise.resolve([]),
      prisma.contactRequest.groupBy({ by: ["trackedLinkId"], where: { kind: "quote", trackedLinkId: { in: ids }, createdAt: range }, _count: { _all: true } }),
      prisma.supportConversation.groupBy({ by: ["trackedLinkId"], where: { trackedLinkId: { in: ids }, createdAt: range }, _count: { _all: true } }),
      prisma.user.groupBy({ by: ["trackedLinkId"], where: { trackedLinkId: { in: ids }, createdAt: range }, _count: { _all: true } }),
      // Paid starts: the "upgrade" event (Paddle or a confirmed Mobile Money payment), once per company, as in Analytics.
      prisma.$queryRaw<{ id: string; c: bigint }[]>`
        SELECT u."trackedLinkId" AS id, COUNT(DISTINCT e."userId")::bigint AS c
        FROM "AnalyticsEvent" e JOIN "User" u ON u."id" = e."userId"
        WHERE e."name" = 'upgrade' AND e."createdAt" >= ${start} AND e."createdAt" < ${end} AND u."trackedLinkId" = ANY(${ids})
        GROUP BY 1`,
    ]);
    for (const r of clicks) stats.get(r.linkId)!.clicks = r._count._all;
    for (const r of countries) if (r.country) stats.get(r.linkId)!.countries.push({ country: r.country, clicks: r._count._all });
    for (const s of stats.values()) s.countries = s.countries.sort((a, b) => b.clicks - a.clicks).slice(0, 3);
    for (const r of visitors) {
      const id = byCode.get(r.code);
      if (id) stats.get(id)!.visitors = n(r.visitors);
    }
    for (const r of quotes) if (r.trackedLinkId) stats.get(r.trackedLinkId)!.quotes = r._count._all;
    for (const r of chats) if (r.trackedLinkId) stats.get(r.trackedLinkId)!.chats = r._count._all;
    for (const r of signups) if (r.trackedLinkId) stats.get(r.trackedLinkId)!.signups = r._count._all;
    for (const r of paid) if (stats.has(r.id)) stats.get(r.id)!.paid = n(r.c);
  }

  const rows: LinkRow[] = links.map((l) => ({
    id: l.id,
    code: l.code,
    label: l.label,
    channel: l.channel,
    destination: l.destination,
    createdAt: l.createdAt.toISOString(),
    archived: !!l.archivedAt,
    by: { id: l.createdBy?.id ?? null, name: l.createdBy?.name ?? null, owner: !l.createdBy || isSupportOwnerEmail(l.createdBy.email) },
    stats: stats.get(l.id) ?? empty(),
  }));
  const chatLeads = await chatLeadsByAgent(range, me.owner ? null : me.id);
  return {
    links: rows,
    staff: me.owner ? staffTotals(rows, chatLeads) : null,
    myChatLeads: me.owner ? 0 : (chatLeads.get(me.id)?.count ?? 0),
    visitorsFrom: viewsStart > start ? viewsStart.toISOString().slice(0, 10) : null,
  };
}

/**
 * Chats on the website in the period that became a staff member's lead because that person talked to the visitor
 * first: not counted when the visitor came through another staff member's link (that link's maker owns them). The
 * owner's own replies are the company's. One agent (onlyAgent) or everyone.
 */
async function chatLeadsByAgent(range: { gte: Date; lt: Date }, onlyAgent: string | null): Promise<Map<string, { name: string; count: number }>> {
  const rows = await prisma.$queryRaw<{ agentId: string; name: string; email: string; c: bigint }[]>`
    WITH firsts AS (
      SELECT DISTINCT ON (m."conversationId") m."conversationId", m."agentId"
      FROM "SupportMessage" m JOIN "SupportConversation" c ON c."id" = m."conversationId"
      WHERE m."author" = 'AGENT' AND m."agentId" IS NOT NULL AND c."surface" = 'public' AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      ORDER BY m."conversationId", m."createdAt" ASC
    )
    SELECT f."agentId", a."name", a."email", COUNT(*)::bigint AS c
    FROM firsts f
    JOIN "SupportConversation" c ON c."id" = f."conversationId"
    JOIN "SupportAgent" a ON a."id" = f."agentId"
    LEFT JOIN "TrackedLink" l ON l."id" = c."trackedLinkId"
    LEFT JOIN "SupportAgent" la ON la."id" = l."createdById"
    WHERE (l."id" IS NULL OR la."id" IS NULL OR la."email" = ${OWNER_EMAIL} OR la."id" = f."agentId")
      AND (${onlyAgent}::text IS NULL OR f."agentId" = ${onlyAgent})
    GROUP BY 1, 2, 3`;
  return new Map(rows.filter((r) => !isSupportOwnerEmail(r.email)).map((r) => [r.agentId, { name: r.name, count: n(r.c) }]));
}

/**
 * The owner's leaderboard: the company's links in one row, each staff member's links added up with the chats they
 * turned into leads, most paid first, then quotes, sign-ups and clicks.
 */
export function staffTotals(rows: LinkRow[], chatLeads: Map<string, { name: string; count: number }> = new Map()): StaffLinkTotals[] {
  const by = new Map<string, StaffLinkTotals>();
  const blank = (id: string | null, name: string, company: boolean): StaffLinkTotals => ({ id, name, company, links: 0, chatLeads: 0, clicks: 0, visitors: 0, quotes: 0, chats: 0, signups: 0, paid: 0 });
  for (const r of rows) {
    const key = r.by.owner ? "company" : (r.by.id as string);
    const t = by.get(key) ?? (r.by.owner ? blank(null, COMPANY_NAME, true) : blank(r.by.id, r.by.name ?? "Staff", false));
    t.links += 1;
    t.clicks += r.stats.clicks;
    t.visitors += r.stats.visitors;
    t.quotes += r.stats.quotes;
    t.chats += r.stats.chats;
    t.signups += r.stats.signups;
    t.paid += r.stats.paid;
    by.set(key, t);
  }
  for (const [id, { name, count }] of chatLeads) {
    const t = by.get(id) ?? blank(id, name, false);
    t.chatLeads = count;
    by.set(id, t);
  }
  return [...by.values()].sort((a, b) => Number(b.company) - Number(a.company) || b.paid - a.paid || b.quotes - a.quotes || b.chatLeads - a.chatLeads || b.signups - a.signups || b.clicks - a.clicks);
}

export type LeadInfo = { owner: LeadOwner; link: LinkTag | null };

const CHAT_LOOKBACK_MS = 30 * 86_400_000;

/** The first staff member who replied in each chat ("talked to them"), with whether it was admin@bupulse.com. */
async function firstAgents(conversationIds: string[]): Promise<Map<string, LeadChatAgent>> {
  if (!conversationIds.length) return new Map();
  const rows = await prisma.supportMessage.findMany({
    where: { conversationId: { in: conversationIds }, author: "AGENT", agentId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { conversationId: true, agent: { select: { id: true, name: true, email: true } } },
  });
  const out = new Map<string, LeadChatAgent>();
  for (const r of rows) if (r.agent && !out.has(r.conversationId)) out.set(r.conversationId, { id: r.agent.id, name: r.agent.name, owner: isSupportOwnerEmail(r.agent.email) });
  return out;
}

/** Whose lead a chat is, and the link it came through (lib/links/rules.ts leadOwnerOf). */
export async function conversationLeadInfo(conversationId: string): Promise<LeadInfo> {
  const c = await prisma.supportConversation.findUnique({ where: { id: conversationId }, select: { trackedLinkId: true } });
  const [tags, agents] = await Promise.all([linkTags([c?.trackedLinkId]), firstAgents([conversationId])]);
  const link = c?.trackedLinkId ? (tags.get(c.trackedLinkId) ?? null) : null;
  return { owner: leadOwnerOf(link, agents.get(conversationId) ?? null), link };
}

/**
 * Whose lead each quote request is: the link it came through, or the staff member who talked first with the same email
 * address in a website chat from 30 days before the request onwards.
 */
export async function quoteLeadInfo(quotes: { id: string; email: string; trackedLinkId: string | null; createdAt: Date }[]): Promise<Map<string, LeadInfo>> {
  if (!quotes.length) return new Map();
  const emails = [...new Set(quotes.map((q) => q.email.trim().toLowerCase()))];
  const oldest = new Date(Math.min(...quotes.map((q) => q.createdAt.getTime())) - CHAT_LOOKBACK_MS);
  const [tags, chats] = await Promise.all([
    linkTags(quotes.map((q) => q.trackedLinkId)),
    prisma.supportConversation.findMany({
      where: { surface: "public", agentReplyCount: { gt: 0 }, createdAt: { gte: oldest }, visitor: { email: { in: emails, mode: "insensitive" } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, visitor: { select: { email: true } } },
    }),
  ]);
  const agents = await firstAgents(chats.map((c) => c.id));
  const out = new Map<string, LeadInfo>();
  for (const q of quotes) {
    const link = q.trackedLinkId ? (tags.get(q.trackedLinkId) ?? null) : null;
    const email = q.email.trim().toLowerCase();
    const chat = chats.find((c) => c.visitor.email?.trim().toLowerCase() === email && c.createdAt.getTime() >= q.createdAt.getTime() - CHAT_LOOKBACK_MS && agents.has(c.id));
    out.set(q.id, { owner: leadOwnerOf(link, chat ? (agents.get(chat.id) ?? null) : null), link });
  }
  return out;
}
