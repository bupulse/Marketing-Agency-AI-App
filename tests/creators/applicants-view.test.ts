import { beforeEach, describe, expect, it, vi } from "vitest";

// The company's Applicants and Creators lists (lib/creators/applicants-view.ts): answers in words with signed links
// for uploads, the match against the requirements (the profile's place for marketplace applicants), and followers
// verified by connected accounts. Only for a campaign of the asking company.

const h = vi.hoisted(() => ({
  campaign: vi.fn(),
  rows: vi.fn(),
  profiles: vi.fn(async () => [{ id: "p1", location: "Kigali, Gasabo" }]),
  connections: vi.fn(async () => [{ profileId: "p1", network: "instagram", username: "@ana.rw", displayName: "@ana.rw", followers: 900 }]),
  urls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
}));
vi.mock("@/lib/db", () => ({ prisma: { creatorCampaign: { findFirst: h.campaign }, campaignCreator: { findMany: h.rows }, creatorProfile: { findMany: h.profiles }, creatorConnection: { findMany: h.connections } } }));
vi.mock("@/lib/creators/media", () => ({ mediaUrls: h.urls }));

import { applicantDetails, joinedAccounts } from "@/lib/creators/applicants-view";

const PATH = "applications/c1/0b9f3c2e-1a2b-4c3d-9e8f-001122334455.mp4";

beforeEach(() => {
  h.campaign.mockReset().mockResolvedValue({
    applicationForm: { intro: null, phone: "REQUIRED", samples: "OPTIONAL", fields: [{ id: "location", preset: "location", type: "LOCATION", label: "Where do you live?", required: true }, { id: "intro", type: "UPLOAD", accept: "VIDEO", label: "Intro", required: false }] },
    questions: null,
    requirements: { locations: ["Kigali"], minFollowers: 1000 },
    currency: "RWF",
  });
  h.rows.mockReset().mockResolvedValue([
    { id: "r1", answers: { location: "Musanze", intro: PATH } },
    { id: "r2", answers: null },
  ]);
});

describe("applicantDetails", () => {
  it("puts answers in words, signs uploads, matches on the requirements with verified followers", async () => {
    const d = await applicantDetails("b1", "c1", [
      { id: "r1", profileId: null, handles: [{ network: "youtube", handle: "ana", followers: 5000 }] },
      { id: "r2", profileId: "p1", handles: [{ network: "instagram", handle: "ana.rw", followers: 20_000 }] },
    ]);
    expect(h.campaign).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", businessId: "b1" } }));
    expect(d.r1.answers).toEqual([
      { id: "location", label: "Where do you live?", text: "Musanze" },
      { id: "intro", label: "Intro", text: "File sent", file: `https://signed/${PATH}` },
    ]);
    expect(d.r1.match).toMatchObject({ kind: "miss", misses: ["Not in Kigali"] });
    expect(d.r1.accounts).toEqual([{ network: "youtube", label: "YouTube", handle: "ana", followers: 5000, check: null, verified: false }]);
    // A marketplace applicant: placed by the profile, followers by the connected account (900, not the 20,000 typed).
    expect(d.r2.match).toMatchObject({ kind: "miss", misses: ["Fewer than 1,000 followers"] });
    expect(d.r2.accounts[0]).toMatchObject({ check: "Said 20,000 · has 900", verified: false });
  });

  it("gives nothing for a campaign of another company", async () => {
    h.campaign.mockResolvedValueOnce(null);
    expect(await applicantDetails("b2", "c1", [{ id: "r1", profileId: null, handles: [] }])).toEqual({});
  });
});

describe("joinedAccounts", () => {
  it("says Verified when the connected account has as many followers", async () => {
    h.connections.mockResolvedValueOnce([{ profileId: "p1", network: "instagram", username: "@ana.rw", displayName: "@ana.rw", followers: 12_300 }]);
    expect(await joinedAccounts([{ id: "r2", profileId: "p1", handles: [{ network: "instagram", handle: "ana.rw", followers: 12_000 }] }])).toEqual({
      r2: [{ network: "instagram", label: "Instagram", handle: "ana.rw", followers: 12_000, check: "12,300 followers · Verified", verified: true }],
    });
  });
});
