import { beforeEach, describe, expect, it, vi } from "vitest";

// Applying in one tap with a creator account (lib/creators/quick-apply.ts, docs/CREATOR_MARKETPLACE.md): the profile
// fills a CampaignCreator (APPLIED, source MARKETPLACE, profileId set); the rules: open campaigns only (not hidden),
// not blocked, a complete profile, rate limited, the company's questions, one application per email and profile per
// campaign, a place left.

const h = vi.hoisted(() => ({
  campaign: null as Record<string, unknown> | null,
  profile: vi.fn(),
  findFirst: vi.fn(),
  createMany: vi.fn(),
  places: vi.fn(async () => 5),
  rateLimit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({ prisma: { creatorProfile: { findUnique: h.profile }, campaignCreator: { findFirst: h.findFirst, createMany: h.createMany } } }));
vi.mock("@/lib/creators/apply", () => ({
  loadPublicCampaign: vi.fn(async () => h.campaign),
  takesApplications: (c: { status: string; acceptingApplications: boolean }) => c.status === "LIVE" && c.acceptingApplications,
}));
vi.mock("@/lib/creators/marketplace", () => ({ placesLeftIn: h.places }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: h.rateLimit }));

import { RateLimitError } from "@/lib/rate-limit";
import { quickApply, viewerOf } from "@/lib/creators/quick-apply";

const USER = { userId: "u1", email: "Ana@Example.com" };
const PROFILE = {
  id: "p1",
  name: "Ana Uwase",
  phone: "+250791954277",
  handles: [
    { network: "instagram", handle: "ana.rw", followers: 12000 },
    { network: "facebook", handle: "ana", followers: 300 },
  ],
  samples: ["https://www.instagram.com/p/abc/"],
  blockedAt: null,
};
const form = (fields: Record<string, string> = {}) => new Map(Object.entries(fields));

beforeEach(() => {
  h.campaign = { id: "c1", status: "LIVE", acceptingApplications: true, hidden: false, listed: false, platforms: ["instagram", "tiktok"], questions: [{ id: "q1", label: "Why us?", required: true }], company: { id: "b1" } };
  h.profile.mockReset().mockResolvedValue(PROFILE);
  h.findFirst.mockReset().mockResolvedValue(null);
  h.createMany.mockReset().mockResolvedValue({ count: 1 });
  h.places.mockReset().mockResolvedValue(5);
  h.rateLimit.mockReset().mockResolvedValue(undefined);
});

describe("quickApply", () => {
  it("saves the application from the profile: MARKETPLACE, profileId, the login email, the campaign's platforms only, the answers", async () => {
    expect(await quickApply(USER, "summer", form({ q_q1: " I love it " }))).toEqual({ ok: true });
    expect(h.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "c1",
          profileId: "p1",
          source: "MARKETPLACE",
          status: "APPLIED",
          name: "Ana Uwase",
          email: "ana@example.com",
          phone: "+250791954277",
          handles: [{ network: "instagram", handle: "ana.rw", followers: 12000 }],
          samples: ["https://www.instagram.com/p/abc/"],
          answers: { q1: "I love it" },
        },
      ],
      skipDuplicates: true,
    });
    expect(h.rateLimit).toHaveBeenCalledWith("creator-quick-apply:p1", expect.objectContaining({ limit: 20 }));
    // An unlisted campaign reached by its link takes applications too.
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ campaignId: "c1", OR: [{ profileId: "p1" }, { email: "ana@example.com" }] });
  });

  it("refuses campaigns that are not open, or hidden by an admin", async () => {
    for (const over of [{ status: "PAUSED" }, { status: "DRAFT" }, { acceptingApplications: false }, { hidden: true }]) {
      h.campaign = { ...h.campaign, ...over };
      expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toEqual({ ok: false, error: "This campaign is not taking applications right now." });
    }
    h.campaign = null;
    expect((await quickApply(USER, "gone", form())).ok).toBe(false);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("refuses a blocked creator, a person without a creator profile, and an incomplete profile", async () => {
    h.profile.mockResolvedValueOnce({ ...PROFILE, blockedAt: new Date() });
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toMatchObject({ ok: false, error: expect.stringMatching(/cannot apply/) });
    h.profile.mockResolvedValueOnce(null);
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toMatchObject({ ok: false, error: "Creators apply with a creator account." });
    h.profile.mockResolvedValueOnce({ ...PROFILE, phone: null });
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toMatchObject({ ok: false, incomplete: true });
    // A handle on Facebook only does not cover a campaign on Instagram and TikTok.
    h.profile.mockResolvedValueOnce({ ...PROFILE, handles: [{ network: "facebook", handle: "ana", followers: 1 }] });
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toMatchObject({ ok: false, incomplete: true });
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("asks the company's required questions", async () => {
    expect(await quickApply(USER, "summer", form())).toEqual({ ok: false, errors: { q_q1: "Please answer this question." } });
  });

  it("one application per email and profile per campaign; an open invitation is answered on the Campaigns page", async () => {
    h.findFirst.mockResolvedValueOnce({ status: "APPLIED" });
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toEqual({ ok: false, error: "You already applied to this campaign." });
    h.findFirst.mockResolvedValueOnce({ status: "OFFERED" });
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toMatchObject({ ok: false, error: expect.stringMatching(/invited you/) });
    // Two taps at once: the unique (campaign, email) keeps one.
    h.createMany.mockResolvedValueOnce({ count: 0 });
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toEqual({ ok: false, error: "You already applied to this campaign." });
  });

  it("refuses when every place is taken, and when rate limited", async () => {
    h.places.mockResolvedValueOnce(0);
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toEqual({ ok: false, error: "All places in this campaign are taken." });
    h.rateLimit.mockRejectedValueOnce(new RateLimitError(60));
    expect(await quickApply(USER, "summer", form({ q_q1: "x" }))).toMatchObject({ ok: false, error: expect.any(String) });
    expect(h.createMany).not.toHaveBeenCalled();
  });
});

describe("viewerOf", () => {
  const campaign = { id: "c1", platforms: ["instagram"] };
  it("tells a visitor, a company person and a creator apart", async () => {
    expect(await viewerOf(campaign, null)).toEqual({ kind: "guest" });
    expect(await viewerOf(campaign, { id: "u1", email: "a@x.rw", email_confirmed_at: null })).toEqual({ kind: "guest" });
    h.profile.mockResolvedValueOnce(null);
    expect(await viewerOf(campaign, { id: "u1", email: "a@x.rw", email_confirmed_at: "2026-10-21" })).toEqual({ kind: "company" });
    h.findFirst.mockResolvedValueOnce({ status: "APPLIED" });
    expect(await viewerOf(campaign, { id: "u1", email: "a@x.rw", email_confirmed_at: "2026-10-21" })).toEqual({ kind: "creator", profileId: "p1", name: "Ana Uwase", blocked: false, gaps: [], applied: { status: "APPLIED" } });
  });
});
