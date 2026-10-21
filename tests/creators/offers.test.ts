import { beforeEach, describe, expect, it, vi } from "vitest";

// Companies inviting marketplace creators (lib/creators/offers.ts) against a mocked database: who can be invited, to
// which campaigns, one open offer per creator and campaign, the plan's places (open offers count), 14 days to answer,
// withdrawing, and what the offer copies from the profile.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const prisma = {
    business: { findUnique: fn() },
    creatorCampaign: { findFirst: fn(), findMany: fn() },
    creatorProfile: { findUnique: fn() },
    campaignCreator: { findFirst: fn(), count: fn(), create: fn(), updateMany: fn() },
    $executeRaw: fn(),
    $transaction: vi.fn(),
  };
  return { prisma, limits: { creatorsPerCampaign: 20 } as Record<string, number>, sendEmail: vi.fn(async () => true) };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/plan-catalog", () => ({ getPlanLimits: vi.fn(async () => ({ text: 0, image: 0, videos: 0, voiceCharacters: 0, chat: 0, videoCredits: 0, seats: 1, liveCampaigns: 2, ...h.limits })) }));
vi.mock("@/lib/auth/request-site", () => ({ linkSiteUrl: async () => "https://bupulse.com" }));
vi.mock("@/lib/publishing/email", () => ({ renderEmail: (x: { heading: string }) => ({ html: x.heading, text: x.heading }), sendEmail: h.sendEmail }));
vi.mock("@/lib/region", () => ({ companyRegion: async () => ({ currency: "RWF" }) }));
vi.mock("@/lib/team/service", () => ({ newInviteToken: () => "t".repeat(64), hashToken: async (t: string) => t }));

import { offerCreator, withdrawAllOffers, withdrawOffer } from "@/lib/creators/offers";
import { offerExpired } from "@/lib/creators/company-forms";
import type { CampaignActor } from "@/lib/creators/campaigns";

const OWNER: CampaignActor = { actorId: "u1", businessId: "b1", role: "OWNER" };
const MEMBER: CampaignActor = { actorId: "u2", businessId: "b1", role: "MEMBER" };
const NOW = new Date("2026-10-21T08:00:00Z");
const DAY = 864e5;
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message: string }) => `${e.code}: ${e.message}`);

const campaign = { id: "c1", name: "Summer", status: "LIVE", business: { name: "LEAF" } };
const profile = { id: "p1", name: "Aline Uwase", phone: "+250780000001", handles: [{ network: "instagram", handle: "@aline", followers: 12000 }, { bad: true }], samples: ["https://a/1", "https://a/2", "https://a/3", "https://a/4"], discoverable: true, blockedAt: null, user: { email: "Aline@Example.com" } };

beforeEach(() => {
  vi.clearAllMocks();
  h.limits = { creatorsPerCampaign: 20 };
  h.prisma.$transaction.mockImplementation(async (run: (tx: typeof h.prisma) => unknown) => run(h.prisma));
  h.prisma.business.findUnique.mockResolvedValue({ user: { subscription: { plan: "BUSINESS" } } });
  h.prisma.creatorCampaign.findFirst.mockResolvedValue(campaign);
  h.prisma.creatorProfile.findUnique.mockResolvedValue(profile);
  h.prisma.campaignCreator.findFirst.mockResolvedValue(null);
  h.prisma.campaignCreator.count.mockResolvedValue(3);
  h.prisma.campaignCreator.create.mockResolvedValue({ id: "cc9" });
  h.prisma.campaignCreator.updateMany.mockResolvedValue({ count: 1 });
});

describe("offers", () => {
  it("copy the profile into an OFFERED row, take a place under the campaign's lock, and email the creator", async () => {
    const r = await offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW);
    expect(r).toMatchObject({ id: "cc9", name: "Aline Uwase", campaignName: "Summer", sent: true, expiresAt: new Date(NOW.getTime() + 14 * DAY).toISOString() });
    expect(h.prisma.$executeRaw).toHaveBeenCalled();
    expect(h.prisma.campaignCreator.create).toHaveBeenCalledWith({
      data: {
        campaignId: "c1",
        status: "OFFERED",
        source: "OFFER",
        offeredBy: "u1",
        offeredAt: NOW,
        profileId: "p1",
        name: "Aline Uwase",
        email: "aline@example.com",
        phone: "+250780000001",
        handles: [{ network: "instagram", handle: "@aline", followers: 12000 }],
        samples: ["https://a/1", "https://a/2", "https://a/3"],
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
      select: { id: true },
    });
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "aline@example.com", subject: 'LEAF invites you to "Summer"' }));
  });

  it("are for owners and admins, to live or draft campaigns of their company", async () => {
    expect(await code(offerCreator(MEMBER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^forbidden:/);
    h.prisma.creatorCampaign.findFirst.mockResolvedValue({ ...campaign, status: "PAUSED" });
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toBe("conflict: Invite creators to a live or draft campaign.");
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(null);
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^not_found:/);
    expect(h.prisma.creatorCampaign.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", businessId: "b1" } }));
    h.prisma.creatorCampaign.findFirst.mockResolvedValue({ ...campaign, status: "DRAFT" });
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toBeNull();
  });

  it("only reach creators who can be found and are not blocked", async () => {
    h.prisma.creatorProfile.findUnique.mockResolvedValue({ ...profile, discoverable: false });
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^not_found: This creator is not taking invitations/);
    h.prisma.creatorProfile.findUnique.mockResolvedValue({ ...profile, blockedAt: new Date() });
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^conflict: BuPulse blocked this creator/);
    expect(h.prisma.campaignCreator.create).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("count toward the plan's creators per campaign", async () => {
    h.limits.creatorsPerCampaign = 3;
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^limit: Your plan allows 3 creators in one campaign/);
    expect(h.prisma.campaignCreator.count).toHaveBeenCalledWith({ where: { campaignId: "c1", OR: [{ status: { in: ["SELECTED", "JOINED"] } }, { status: "OFFERED", offeredAt: { gt: new Date(NOW.getTime() - 14 * DAY) } }] } });
    expect(h.prisma.campaignCreator.create).not.toHaveBeenCalled();
  });

  it("are one open offer per creator and campaign; an expired or declined offer is made again on the same row", async () => {
    h.prisma.campaignCreator.findFirst.mockResolvedValue({ id: "cc1", status: "OFFERED", source: "OFFER", offeredAt: new Date(NOW.getTime() - 13 * DAY) });
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^conflict: You already invited this creator/);
    expect(h.prisma.campaignCreator.findFirst).toHaveBeenCalledWith({ where: { campaignId: "c1", OR: [{ profileId: "p1" }, { email: "aline@example.com" }] }, select: { id: true, status: true, source: true, offeredAt: true } });

    h.prisma.campaignCreator.findFirst.mockResolvedValue({ id: "cc1", status: "OFFERED", source: "OFFER", offeredAt: new Date(NOW.getTime() - 15 * DAY) });
    expect(await offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW)).toMatchObject({ id: "cc1" });
    expect(h.prisma.campaignCreator.updateMany).toHaveBeenLastCalledWith({ where: { id: "cc1", status: "OFFERED" }, data: expect.objectContaining({ status: "OFFERED", offeredAt: NOW, offeredBy: "u1" }) });

    h.prisma.campaignCreator.findFirst.mockResolvedValue({ id: "cc1", status: "DECLINED", source: "OFFER", offeredAt: new Date(NOW.getTime() - 2 * DAY) });
    expect(await offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW)).toMatchObject({ id: "cc1" });
    expect(h.prisma.campaignCreator.create).not.toHaveBeenCalled();
  });

  it("are refused to creators who applied, are in the campaign, or were removed from it", async () => {
    const at = (status: string, source = "LINK") => h.prisma.campaignCreator.findFirst.mockResolvedValue({ id: "cc1", status, source, offeredAt: null });
    at("APPLIED");
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^conflict: This creator already applied/);
    at("JOINED", "OFFER");
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^conflict: This creator is already in this campaign/);
    at("REMOVED");
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/^conflict: You removed this creator/);
    at("DECLINED", "MARKETPLACE");
    expect(await code(offerCreator(OWNER, { profileId: "p1", campaignId: "c1" }, NOW))).toMatch(/Select after all/);
    expect(h.prisma.campaignCreator.updateMany).not.toHaveBeenCalled();
  });

  it("expire 14 days after they were made", () => {
    expect(offerExpired(new Date(NOW.getTime() - 14 * DAY + 1000), NOW)).toBe(false);
    expect(offerExpired(new Date(NOW.getTime() - 14 * DAY), NOW)).toBe(true);
    expect(offerExpired(null, NOW)).toBe(true);
  });
});

describe("withdrawing", () => {
  it("takes back an unanswered offer of this company only", async () => {
    h.prisma.campaignCreator.findFirst.mockResolvedValue({ id: "cc1", status: "OFFERED", campaign: { id: "c1", name: "Summer", status: "LIVE" } });
    await withdrawOffer(OWNER, "cc1");
    expect(h.prisma.campaignCreator.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cc1", campaign: { businessId: "b1" } } }));
    expect(h.prisma.campaignCreator.updateMany).toHaveBeenCalledWith({ where: { id: "cc1", status: "OFFERED" }, data: { status: "DECLINED" } });
    h.prisma.campaignCreator.findFirst.mockResolvedValue({ id: "cc1", status: "JOINED", campaign: { id: "c1", name: "Summer", status: "LIVE" } });
    expect(await code(withdrawOffer(OWNER, "cc1"))).toMatch(/^conflict: This creator already answered/);
  });

  it("withdraws every open offer of a blocked creator", async () => {
    h.prisma.campaignCreator.updateMany.mockResolvedValue({ count: 2 });
    expect(await withdrawAllOffers(h.prisma as never, "p1")).toBe(2);
    expect(h.prisma.campaignCreator.updateMany).toHaveBeenCalledWith({ where: { profileId: "p1", status: "OFFERED" }, data: { status: "DECLINED" } });
  });
});
