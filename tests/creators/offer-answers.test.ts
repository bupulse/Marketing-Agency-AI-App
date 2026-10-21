import { beforeEach, describe, expect, it, vi } from "vitest";

// A creator answers a company's invitation (lib/creators/offer-answers.ts): OFFERED -> JOINED (with joinedAt) or
// DECLINED; expired after 14 days; accepting respects the plan's creatorsPerCampaign under the campaign's lock. And the
// Campaigns page's groups (lib/creators/portal-groups.ts).

const h = vi.hoisted(() => {
  const tx = { $executeRaw: vi.fn(), campaignCreator: { count: vi.fn(), updateMany: vi.fn() } };
  return {
    tx,
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    limits: { creatorsPerCampaign: 3 },
  };
});
vi.mock("@/lib/db", () => ({
  prisma: {
    campaignCreator: { findFirst: h.findFirst, updateMany: h.updateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(h.tx)),
  },
}));
vi.mock("@/lib/creators/campaigns", () => ({ campaignLimits: vi.fn(async () => ({ liveCampaigns: 2, ...h.limits })) }));

import { answerOffer, OfferError } from "@/lib/creators/offer-answers";
import { groupCampaigns, groupOf, offerExpired, rowLabel } from "@/lib/creators/portal-groups";

const DAY = 86_400_000;
const NOW = new Date("2026-10-21T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const offer = (over: Record<string, unknown> = {}) => ({ id: "cc1", status: "OFFERED", offeredAt: ago(2), campaignId: "c1", profile: { blockedAt: null }, campaign: { status: "LIVE", businessId: "b1" }, ...over });
const code = (p: Promise<unknown>) => p.then(() => null, (e: OfferError) => e.code);

beforeEach(() => {
  h.findFirst.mockReset().mockResolvedValue(offer());
  h.updateMany.mockReset().mockResolvedValue({ count: 1 });
  h.tx.$executeRaw.mockReset();
  h.tx.campaignCreator.count.mockReset().mockResolvedValue(2);
  h.tx.campaignCreator.updateMany.mockReset().mockResolvedValue({ count: 1 });
  h.limits.creatorsPerCampaign = 3;
});

describe("answerOffer", () => {
  it("accepts: JOINED with joinedAt, only the creator's own open invitation, counted under the campaign's lock", async () => {
    expect(await answerOffer("p1", "cc1", "accept", NOW)).toBe("JOINED");
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ id: "cc1", profileId: "p1" });
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    // Every place holder but this invitation itself: SELECTED, JOINED and other open invitations.
    expect(h.tx.campaignCreator.count).toHaveBeenCalledWith({ where: { campaignId: "c1", id: { not: "cc1" }, OR: [{ status: { in: ["SELECTED", "JOINED"] } }, { status: "OFFERED", offeredAt: { gt: ago(14) } }] } });
    expect(h.tx.campaignCreator.updateMany).toHaveBeenCalledWith({ where: { id: "cc1", profileId: "p1", status: "OFFERED" }, data: { status: "JOINED", joinedAt: NOW } });
  });

  it("refuses to accept when every place is taken", async () => {
    h.tx.campaignCreator.count.mockResolvedValue(3);
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("limit");
    expect(h.tx.campaignCreator.updateMany).not.toHaveBeenCalled();
  });

  it("declines: DECLINED", async () => {
    expect(await answerOffer("p1", "cc1", "decline", NOW)).toBe("DECLINED");
    expect(h.updateMany).toHaveBeenCalledWith({ where: { id: "cc1", profileId: "p1", status: "OFFERED" }, data: { status: "DECLINED" } });
  });

  it("refuses an expired invitation (over 14 days), either answer", async () => {
    h.findFirst.mockResolvedValue(offer({ offeredAt: ago(14.1) }));
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("expired");
    expect(await code(answerOffer("p1", "cc1", "decline", NOW))).toBe("expired");
    h.findFirst.mockResolvedValue(offer({ offeredAt: ago(13.9) }));
    expect(await answerOffer("p1", "cc1", "decline", NOW)).toBe("DECLINED");
  });

  it("refuses someone else's row, an answered invitation, an ended campaign, a blocked creator, and a second tap", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("not_found");
    h.findFirst.mockResolvedValueOnce(offer({ status: "JOINED" }));
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("conflict");
    h.findFirst.mockResolvedValueOnce(offer({ campaign: { status: "ENDED", businessId: "b1" } }));
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("conflict");
    h.findFirst.mockResolvedValueOnce(offer({ profile: { blockedAt: ago(1) } }));
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("blocked");
    h.tx.campaignCreator.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await code(answerOffer("p1", "cc1", "accept", NOW))).toBe("conflict");
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await code(answerOffer("p1", "cc1", "decline", NOW))).toBe("conflict");
  });
});

describe("the Campaigns page's groups", () => {
  const row = (status: string, campaignStatus = "LIVE", over: Record<string, unknown> = {}) => ({ status, source: "LINK", offeredAt: null as Date | null, campaign: { status: campaignStatus }, ...over });

  it("puts each row in Joined, Waiting, Invitations or Ended", () => {
    expect(groupOf(row("JOINED"), NOW)).toBe("joined");
    expect(groupOf(row("JOINED", "PAUSED"), NOW)).toBe("joined");
    expect(groupOf(row("JOINED", "ENDED"), NOW)).toBe("ended");
    expect(groupOf(row("APPLIED"), NOW)).toBe("waiting");
    expect(groupOf(row("SELECTED"), NOW)).toBe("waiting");
    expect(groupOf(row("APPLIED", "ENDED"), NOW)).toBe("ended");
    expect(groupOf(row("OFFERED", "LIVE", { offeredAt: ago(1) }), NOW)).toBe("invitations");
    expect(groupOf(row("OFFERED", "DRAFT", { offeredAt: ago(20) }), NOW)).toBe("invitations"); // shown as Expired a while
    expect(groupOf(row("OFFERED", "LIVE", { offeredAt: ago(29) }), NOW)).toBe("ended");
    expect(groupOf(row("REMOVED"), NOW)).toBe("ended");
    expect(groupOf(row("DECLINED"), NOW)).toBe("ended");
    const g = groupCampaigns([row("JOINED"), row("APPLIED"), row("REMOVED")], NOW);
    expect([g.joined.length, g.waiting.length, g.invitations.length, g.ended.length]).toEqual([1, 1, 0, 1]);
  });

  it("labels the rows", () => {
    expect(rowLabel(row("OFFERED", "LIVE", { offeredAt: ago(1) }), NOW)).toBe("Invitation");
    expect(rowLabel(row("OFFERED", "LIVE", { offeredAt: ago(15) }), NOW)).toBe("Expired");
    expect(rowLabel(row("DECLINED", "LIVE", { source: "OFFER" }), NOW)).toBe("You said no");
    expect(rowLabel(row("DECLINED"), NOW)).toBe("Not picked");
    expect(rowLabel(row("JOINED", "PAUSED"), NOW)).toBe("Paused");
    expect(offerExpired(null, NOW)).toBe(true);
  });
});
