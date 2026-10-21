import { beforeEach, describe, expect, it, vi } from "vitest";

// Companies finding creators (lib/creators/finder.ts): the filters read from the page's query, the campaign record
// (counts across every company), verified handles, and contact details shown only to a company the creator applied
// to or joined. The SQL filters run against the TEST database in finder.db.test.ts.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      $queryRaw: fn(),
      creatorProfile: { findMany: fn(), findUnique: fn() },
      campaignCreator: { findMany: fn(), count: fn() },
      creatorPost: { groupBy: fn() },
    },
    createReport: vi.fn(async () => ({ id: "r1" })),
  };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/creators/reports", () => ({ createReport: h.createReport }));

import { findCreators, readFinderFilters, reportCreator, summariseRecord, withVerified } from "@/lib/creators/finder";
import type { CampaignActor } from "@/lib/creators/campaigns";

const OWNER: CampaignActor = { actorId: "u1", businessId: "b1", role: "OWNER" };

describe("filters", () => {
  it("read the query, leaving out anything unreadable", () => {
    expect(readFinderFilters({ platform: "tiktok", min: "10000", max: "5000", location: "  Kigali ", verified: "1", page: "3" })).toEqual({ platform: "tiktok", minFollowers: 5000, maxFollowers: 10000, location: "Kigali", verified: true, page: 3 });
    expect(readFinderFilters({ platform: "myspace", min: "-4", max: "lots", verified: "yes", page: "0" })).toEqual({ platform: null, minFollowers: null, maxFollowers: null, location: "", verified: false, page: 1 });
    expect(readFinderFilters({ platform: ["instagram", "tiktok"], location: "x".repeat(100) })).toMatchObject({ platform: "instagram", location: "x".repeat(60) });
  });
});

describe("the campaign record", () => {
  it("counts campaigns joined and ended, posts that counted with their views, and removed or rejected posts", () => {
    const record = summariseRecord(
      [{ id: "m1", campaignStatus: "ENDED" }, { id: "m2", campaignStatus: "LIVE" }],
      [
        { campaignCreatorId: "m1", status: "FINAL", count: 4, views: 40_000 },
        { campaignCreatorId: "m2", status: "TRACKING", count: 2, views: 5_000 },
        { campaignCreatorId: "m2", status: "REJECTED", count: 1, views: 900 },
        { campaignCreatorId: "m1", status: "REMOVED", count: 2, views: 100 },
        { campaignCreatorId: "m2", status: "INVALID", count: 7, views: 0 },
        // Someone else's posts never count.
        { campaignCreatorId: "other", status: "FINAL", count: 9, views: 1 },
      ],
    );
    expect(record).toEqual({ joined: 2, ended: 1, countedPosts: 6, views: 45_000, removedPosts: 3 });
  });
});

describe("verified handles", () => {
  it("mark typed handles of connected accounts, and add a connected account that was not typed", () => {
    const shown = withVerified(
      [{ network: "instagram", handle: "@Aline", followers: 1200 }, { network: "tiktok", handle: "aline.tt", followers: 800 }],
      [{ network: "instagram", username: "aline", status: "ACTIVE" }, { network: "tiktok", username: "aline.tt", status: "EXPIRED" }, { network: "facebook", username: "Aline Page", status: "ACTIVE" }],
    );
    expect(shown).toEqual([
      { network: "instagram", handle: "@Aline", followers: 1200, verified: true },
      { network: "tiktok", handle: "aline.tt", followers: 800, verified: false },
      { network: "facebook", handle: "Aline Page", followers: null, verified: true },
    ]);
  });
});

describe("finding creators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.$queryRaw.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    h.prisma.creatorProfile.findMany.mockResolvedValue([
      { id: "p2", name: "Bea", phone: "+250780000002", location: null, bio: null, handles: [], samples: [], user: { email: "bea@example.com" }, connections: [] },
      { id: "p1", name: "Aline", phone: "+250780000001", location: "Kigali", bio: "Food", handles: [{ network: "instagram", handle: "@aline", followers: 1200 }], samples: ["https://x/1"], user: { email: "Aline@example.com" }, connections: [] },
    ]);
    h.prisma.campaignCreator.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      // The record: memberships across all companies.
      if ("joinedAt" in args.where) return [{ id: "m1", profileId: "p1", campaign: { status: "ENDED" } }];
      // Contact: only rows of this company that applied or joined. Aline applied here once by link, before her account.
      if ("AND" in args.where) return [{ profileId: null, email: "aline@example.com" }];
      return [{ campaignId: "c1", status: "OFFERED", profileId: "p2", email: "bea@example.com", offeredAt: new Date(Date.now() - 20 * 864e5) }];
    });
    h.prisma.creatorPost.groupBy.mockResolvedValue([{ campaignCreatorId: "m1", status: "FINAL", _count: { _all: 3 }, _sum: { views: 9000 } }]);
  });

  it("keep the SQL's order, add the record, and show contact details only to a company they applied to or joined", async () => {
    const { creators, hasMore } = await findCreators(OWNER, readFinderFilters({}));
    expect(hasMore).toBe(false);
    expect(creators.map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(creators[0]).toMatchObject({ name: "Aline", contact: { phone: "+250780000001", email: "aline@example.com" }, record: { joined: 1, ended: 1, countedPosts: 3, views: 9000, removedPosts: 0 } });
    expect(creators[1]).toMatchObject({ name: "Bea", contact: null, record: { joined: 0 }, campaigns: [{ campaignId: "c1", status: "OFFERED", expired: true }] });
    const contactQuery = h.prisma.campaignCreator.findMany.mock.calls.map((c) => c[0]).find((a) => "AND" in a.where);
    expect(contactQuery.where).toMatchObject({ campaign: { businessId: "b1" }, AND: [{ OR: [{ source: { in: ["LINK", "MARKETPLACE"] } }, { joinedAt: { not: null } }] }] });
  });

  it("are for owners and admins", async () => {
    await expect(findCreators({ ...OWNER, role: "MEMBER" }, readFinderFilters({}))).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("reporting a creator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("files a CREATOR report from the company's person", async () => {
    h.prisma.creatorProfile.findUnique.mockResolvedValue({ id: "p1", discoverable: true, blockedAt: null });
    await reportCreator(OWNER, { profileId: "p1", reason: "FAKE_VIEWS", details: "Views jump overnight" });
    expect(h.createReport).toHaveBeenCalledWith({ kind: "CREATOR", profileId: "p1", reporterUserId: "u1", businessId: "b1", reason: "FAKE_VIEWS", details: "Views jump overnight" });
  });

  it("only about a creator the company can see", async () => {
    h.prisma.creatorProfile.findUnique.mockResolvedValue({ id: "p1", discoverable: false, blockedAt: null });
    h.prisma.campaignCreator.count.mockResolvedValue(0);
    await expect(reportCreator(OWNER, { profileId: "p1", reason: "SPAM" })).rejects.toMatchObject({ code: "not_found" });
    h.prisma.campaignCreator.count.mockResolvedValue(1);
    await reportCreator(OWNER, { profileId: "p1", reason: "SPAM" });
    expect(h.prisma.campaignCreator.count).toHaveBeenCalledWith({ where: { profileId: "p1", campaign: { businessId: "b1" } } });
    expect(h.createReport).toHaveBeenCalledTimes(1);
  });
});
