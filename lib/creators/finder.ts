import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { askMessage, can } from "@/lib/team/roles";
import { CreatorCampaignError, readHandles, type CampaignActor } from "./campaigns";
import { offerExpired, PLATFORMS, type Platform } from "./company-forms";
import { createReport } from "./reports";

// Companies finding creators (docs/CREATOR_MARKETPLACE.md, "Companies finding creators"): creator profiles that chose
// "Let companies find me" (`discoverable`) and are not blocked, with filters, each with their campaign record across
// all companies (counts only: never another company's name or pay). Contact details show only to a company the
// creator applied to or joined. Pages: /dashboard/creators/find.

export const PAGE_SIZE = 20;

/** The follower steps the filters offer (any platform, or the one picked). */
export const FOLLOWER_STEPS = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000] as const;

export type FinderFilters = { platform: Platform | null; minFollowers: number | null; maxFollowers: number | null; location: string; verified: boolean; page: number };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const followers = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1_000_000_000 ? n : null;
};

/** The filters from the page's query (shareable links): anything unreadable is left out. */
export function readFinderFilters(sp: Record<string, string | string[] | undefined>): FinderFilters {
  const platform = one(sp.platform);
  const page = Number(one(sp.page));
  let minFollowers = followers(one(sp.min));
  let maxFollowers = followers(one(sp.max));
  if (minFollowers && maxFollowers && minFollowers > maxFollowers) [minFollowers, maxFollowers] = [maxFollowers, minFollowers];
  return {
    platform: (PLATFORMS as readonly string[]).includes(platform) ? (platform as Platform) : null,
    minFollowers,
    maxFollowers,
    location: one(sp.location).trim().slice(0, 60),
    verified: one(sp.verified) === "1",
    page: Number.isInteger(page) && page > 1 && page <= 500 ? page : 1,
  };
}

/** `%` and `_` typed in the location box are letters, not wildcards. */
const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * One page of matching profile ids, most followers first (on the platform picked, else any). The follower range uses
 * the creator's biggest typed count on that platform; "verified" means a connected account that works (ACTIVE), on the
 * platform picked when there is one.
 */
async function matchingIds(f: FinderFilters): Promise<string[]> {
  const platform = f.platform;
  const handleOn = platform ? Prisma.sql`AND h->>'network' = ${platform}` : Prisma.empty;
  const connectedOn = platform ? Prisma.sql`AND c."network" = ${platform}` : Prisma.empty;
  const where = [
    Prisma.sql`p."discoverable" = true`,
    Prisma.sql`p."blockedAt" IS NULL`,
    f.location ? Prisma.sql`p."location" ILIKE ${likeOf(f.location)}` : null,
    f.verified ? Prisma.sql`EXISTS (SELECT 1 FROM "CreatorConnection" c WHERE c."profileId" = p."id" AND c."status" = 'ACTIVE' ${connectedOn})` : null,
    platform
      ? Prisma.sql`(EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p."handles") = 'array' THEN p."handles" ELSE '[]'::jsonb END) h WHERE h->>'network' = ${platform})
          OR EXISTS (SELECT 1 FROM "CreatorConnection" c WHERE c."profileId" = p."id" AND c."status" = 'ACTIVE' ${connectedOn}))`
      : null,
  ].filter((x): x is Prisma.Sql => x !== null);
  const having = [f.minFollowers ? Prisma.sql`MAX(x.f) >= ${f.minFollowers}` : null, f.maxFollowers ? Prisma.sql`MAX(x.f) <= ${f.maxFollowers}` : null].filter((x): x is Prisma.Sql => x !== null);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p."id" FROM "CreatorProfile" p
    LEFT JOIN LATERAL (
      SELECT (h->>'followers')::numeric AS f
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p."handles") = 'array' THEN p."handles" ELSE '[]'::jsonb END) h
      WHERE jsonb_typeof(h->'followers') = 'number' ${handleOn}
    ) x ON true
    WHERE ${Prisma.join(where, " AND ")}
    GROUP BY p."id", p."createdAt"
    ${having.length ? Prisma.sql`HAVING ${Prisma.join(having, " AND ")}` : Prisma.empty}
    ORDER BY MAX(x.f) DESC NULLS LAST, p."createdAt" DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${(f.page - 1) * PAGE_SIZE}`;
  return rows.map((r) => r.id);
}

export type CampaignRecord = { joined: number; ended: number; countedPosts: number; views: number; removedPosts: number };

/**
 * A creator's record in BuPulse campaigns, every company together: campaigns joined and ended, posts that counted
 * (TRACKING or FINAL) with their views, and posts removed (gone from the network) or rejected by a company.
 */
export function summariseRecord(memberships: { id: string; campaignStatus: string }[], posts: { campaignCreatorId: string; status: string; count: number; views: number }[]): CampaignRecord {
  const mine = new Set(memberships.map((m) => m.id));
  const record: CampaignRecord = { joined: memberships.length, ended: memberships.filter((m) => m.campaignStatus === "ENDED").length, countedPosts: 0, views: 0, removedPosts: 0 };
  for (const p of posts) {
    if (!mine.has(p.campaignCreatorId)) continue;
    if (p.status === "TRACKING" || p.status === "FINAL") {
      record.countedPosts += p.count;
      record.views += p.views;
    } else if (p.status === "REMOVED" || p.status === "REJECTED") record.removedPosts += p.count;
  }
  return record;
}

/** The records of several creators at once (campaigns they joined, in any company). */
export async function campaignRecords(profileIds: string[]): Promise<Map<string, CampaignRecord>> {
  const out = new Map<string, CampaignRecord>();
  if (!profileIds.length) return out;
  const memberships = await prisma.campaignCreator.findMany({ where: { profileId: { in: profileIds }, joinedAt: { not: null } }, select: { id: true, profileId: true, campaign: { select: { status: true } } } });
  const posts = memberships.length
    ? await prisma.creatorPost.groupBy({ by: ["campaignCreatorId", "status"], where: { campaignCreatorId: { in: memberships.map((m) => m.id) } }, _count: { _all: true }, _sum: { views: true } })
    : [];
  const flat = posts.map((p) => ({ campaignCreatorId: p.campaignCreatorId, status: p.status, count: p._count._all, views: p._sum.views ?? 0 }));
  for (const id of profileIds) out.set(id, summariseRecord(memberships.filter((m) => m.profileId === id).map((m) => ({ id: m.id, campaignStatus: m.campaign.status })), flat));
  return out;
}

export type ShownHandle = { network: string; handle: string; followers: number | null; verified: boolean };

const bare = (handle: string) => handle.trim().replace(/^@/, "").toLowerCase();

/**
 * The typed handles, each marked verified when the creator connected that account (an ACTIVE connection on the same
 * network with the same username). A connected account the creator did not type is added, verified, without a count.
 */
export function withVerified(handles: { network: string; handle: string; followers: number | null }[], connections: { network: string; username: string | null; status: string }[]): ShownHandle[] {
  const active = connections.filter((c) => c.status === "ACTIVE" && c.username);
  const out: ShownHandle[] = handles.map((h) => ({ ...h, verified: active.some((c) => c.network === h.network && bare(c.username!) === bare(h.handle)) }));
  for (const c of active) if (!out.some((h) => h.network === c.network && bare(h.handle) === bare(c.username!))) out.push({ network: c.network, handle: c.username!, followers: null, verified: true });
  return out;
}

/** Which creators may be contacted by this company: they applied to one of its campaigns or joined one. */
async function contactable(businessId: string, profiles: { id: string; email: string }[]): Promise<Set<string>> {
  if (!profiles.length) return new Set();
  const rows = await prisma.campaignCreator.findMany({
    where: {
      campaign: { businessId },
      OR: [{ profileId: { in: profiles.map((p) => p.id) } }, { email: { in: profiles.map((p) => p.email) } }],
      AND: [{ OR: [{ source: { in: ["LINK", "MARKETPLACE"] } }, { joinedAt: { not: null } }] }],
    },
    select: { profileId: true, email: true },
  });
  const out = new Set<string>();
  for (const p of profiles) if (rows.some((r) => r.profileId === p.id || r.email === p.email)) out.add(p.id);
  return out;
}

/** Where each creator stands in this company's campaigns: so Invite skips the campaigns they are already in. */
async function standings(businessId: string, profiles: { id: string; email: string }[], now: Date) {
  if (!profiles.length) return new Map<string, { campaignId: string; status: string; expired: boolean }[]>();
  const rows = await prisma.campaignCreator.findMany({
    where: { campaign: { businessId }, OR: [{ profileId: { in: profiles.map((p) => p.id) } }, { email: { in: profiles.map((p) => p.email) } }] },
    select: { campaignId: true, status: true, profileId: true, email: true, offeredAt: true },
  });
  return new Map(profiles.map((p) => [p.id, rows.filter((r) => r.profileId === p.id || r.email === p.email).map((r) => ({ campaignId: r.campaignId, status: r.status, expired: r.status === "OFFERED" && offerExpired(r.offeredAt, now) }))]));
}

/** One page of creators for /dashboard/creators/find. */
export async function findCreators(actor: CampaignActor, filters: FinderFilters, now = new Date()) {
  if (!can(actor.role, "creators")) throw new CreatorCampaignError("forbidden", askMessage("creators"));
  const ids = await matchingIds(filters);
  const pageIds = ids.slice(0, PAGE_SIZE);
  const rows = pageIds.length
    ? await prisma.creatorProfile.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, name: true, phone: true, location: true, bio: true, handles: true, samples: true, user: { select: { email: true } }, connections: { select: { network: true, username: true, status: true } } },
      })
    : [];
  const people = rows.map((r) => ({ id: r.id, email: r.user.email.toLowerCase() }));
  const [records, contacts, inCampaigns] = await Promise.all([campaignRecords(pageIds), contactable(actor.businessId, people), standings(actor.businessId, people, now)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const creators = pageIds.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const contact = contacts.has(id);
    return [
      {
        id,
        name: r.name,
        location: r.location,
        bio: r.bio,
        handles: withVerified(readHandles(r.handles), r.connections),
        samples: r.samples.slice(0, 3),
        record: records.get(id) ?? { joined: 0, ended: 0, countedPosts: 0, views: 0, removedPosts: 0 },
        /** Only once they applied to or joined one of this company's campaigns. */
        contact: contact ? { phone: r.phone, email: r.user.email.toLowerCase() } : null,
        campaigns: inCampaigns.get(id) ?? [],
      },
    ];
  });
  return { creators, hasMore: ids.length > PAGE_SIZE };
}
export type FoundCreator = Awaited<ReturnType<typeof findCreators>>["creators"][number];

/**
 * A company reports a creator to BuPulse (fake views, spam...). Only a creator the company can see: one it can find,
 * or one who applied to, was invited to or joined one of its campaigns.
 */
export async function reportCreator(actor: CampaignActor, input: { profileId: string; reason: string; details?: string | null }) {
  if (!can(actor.role, "creators")) throw new CreatorCampaignError("forbidden", askMessage("creators"));
  const profile = await prisma.creatorProfile.findUnique({ where: { id: input.profileId }, select: { id: true, discoverable: true, blockedAt: true } });
  const known = profile && (profile.discoverable && !profile.blockedAt ? true : (await prisma.campaignCreator.count({ where: { profileId: profile.id, campaign: { businessId: actor.businessId } } })) > 0);
  if (!profile || !known) throw new CreatorCampaignError("not_found", "That creator no longer exists.");
  return createReport({ kind: "CREATOR", profileId: profile.id, reporterUserId: actor.actorId, businessId: actor.businessId, reason: input.reason, details: input.details });
}
