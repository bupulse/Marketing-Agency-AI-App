import { describe, expect, it } from "vitest";
import { withPrerequisites } from "@/lib/features";
import { SEED_PLANS } from "@/lib/plans";
import {
  POST_RESULTS_FEATURE,
  RESULTS_ACCOUNT_TYPES,
  badgeResults,
  knownResults,
  postResults,
  resultsNote,
  sharesResults,
  type PostResults,
  type ResultsPost,
  type ResultsSnapshot,
} from "@/lib/publishing/results";
import { getProvider } from "@/lib/social/registry";
import { NETWORKS } from "@/lib/social/types";

const now = new Date("2026-10-14T09:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

function post(overrides: Partial<ResultsPost> = {}): ResultsPost {
  return {
    status: "PUBLISHED",
    network: "instagram",
    externalId: "ig_1",
    publishedAt: hoursAgo(20),
    remindOnly: false,
    connection: { postingMode: "AUTO", accountType: "business", status: "ACTIVE" },
    ...overrides,
  };
}

function snapshot(overrides: Partial<ResultsSnapshot> = {}): ResultsSnapshot {
  return { capturedAt: hoursAgo(2), views: 1240, reach: 980, likes: 48, comments: 6, shares: 3, saves: null, ...overrides };
}

describe("per-post results: the plan rule", () => {
  it("shows on every plan that can publish, without Analytics", () => {
    // The Business plan seeded for Rwanda (prisma/migrations/20261010100100_regions_and_demos) has no Analytics.
    const business = withPrerequisites(["content", "designs", "calendar", "gallery"]);
    expect(business).not.toContain("analytics");
    expect(business).toContain(POST_RESULTS_FEATURE);
    // Publishing is the calendar feature: any plan with it shows results on its posts.
    expect(withPrerequisites(["calendar"])).toContain(POST_RESULTS_FEATURE);
    for (const plan of Object.values(SEED_PLANS)) if (plan.features.includes("calendar")) expect(plan.features).toContain(POST_RESULTS_FEATURE);
  });
});

describe("which networks share results", () => {
  it("lists exactly the networks whose provider reads metrics", () => {
    for (const network of NETWORKS) expect(network in RESULTS_ACCOUNT_TYPES, network).toBe(Boolean(getProvider(network).metrics));
  });

  it("reads LinkedIn company pages only, and every Instagram, Facebook and YouTube account", () => {
    expect(sharesResults("linkedin", "organization")).toBe(true);
    expect(sharesResults("linkedin", "personal")).toBe(false);
    expect(sharesResults("linkedin", null)).toBe(false);
    expect(sharesResults("instagram", "creator")).toBe(true);
    expect(sharesResults("facebook", null)).toBe(true);
    expect(sharesResults("tiktok", "personal")).toBe(false);
  });
});

describe("postResults", () => {
  it("is null for a post that is not published", () => {
    expect(postResults(post({ status: "SCHEDULED" }), null, now)).toBeNull();
  });

  it("gives the newest numbers and when they were read", () => {
    expect(postResults(post(), snapshot(), now)).toEqual({ state: "ready", updatedAt: hoursAgo(2).toISOString(), stale: null, views: 1240, reach: 980, likes: 48, comments: 6, shares: 3, saves: null });
  });

  it("says results are on their way for a fresh post of a readable account", () => {
    expect(postResults(post({ publishedAt: hoursAgo(1) }), null, now)).toEqual({ state: "waiting" });
  });

  it("says why there are none", () => {
    expect(postResults(post({ network: "linkedin", connection: { postingMode: "AUTO", accountType: "personal", status: "ACTIVE" } }), null, now)).toEqual({ state: "unsupported" });
    expect(postResults(post({ network: "tiktok", connection: { postingMode: "AUTO", accountType: null, status: "ACTIVE" } }), null, now)).toEqual({ state: "unsupported" });
    // BuPulse-Socials (Composio) reads Facebook and Instagram only, so a LinkedIn Page or YouTube channel there has none.
    const socials = (network: string, accountType: string) => post({ network, connection: { postingMode: "AUTO", accountType, status: "ACTIVE", method: "COMPOSIO" } });
    expect(postResults(socials("linkedin", "organization"), null, now)).toEqual({ state: "unsupported", via: "socials" });
    expect(postResults(socials("youtube", "channel"), null, now)).toEqual({ state: "unsupported", via: "socials" });
    expect(postResults(socials("instagram", "business"), null, now)).toEqual({ state: "waiting" });
    // "Post it yourself": a reminder account, an app that was never connected, or a post marked as posted by hand.
    expect(postResults(post({ connection: { postingMode: "NOTIFY", accountType: "personal", status: "ACTIVE" }, externalId: null }), null, now)).toEqual({ state: "by_hand" });
    expect(postResults(post({ connection: null, remindOnly: true, externalId: null }), null, now)).toEqual({ state: "by_hand" });
    expect(postResults(post({ externalId: null }), null, now)).toEqual({ state: "by_hand" });
    expect(postResults(post({ connection: { postingMode: "AUTO", accountType: "business", status: "EXPIRED" } }), null, now)).toEqual({ state: "reconnect" });
    expect(postResults(post({ connection: null }), null, now)).toEqual({ state: "disconnected" });
    expect(postResults(post({ publishedAt: hoursAgo(24 * 31) }), null, now)).toEqual({ state: "none" });
    // The network answered without any number (a deleted video, for one).
    expect(postResults(post(), snapshot({ views: null, reach: null, likes: null, comments: null, shares: null }), now)).toEqual({ state: "none" });
  });

  it("keeps the last numbers when they stop updating, and says why", () => {
    const stale = (overrides: Partial<ResultsPost>) => (postResults(post(overrides), snapshot(), now) as { stale: unknown }).stale;
    expect(stale({ connection: { postingMode: "AUTO", accountType: "business", status: "REVOKED" } })).toBe("reconnect");
    expect(stale({ connection: null })).toBe("disconnected");
    expect(stale({ publishedAt: hoursAgo(24 * 40) })).toBe("final");
  });
});

describe("what the screens show", () => {
  const ready = postResults(post(), snapshot(), now) as Extract<PostResults, { state: "ready" }>;

  it("badges views, likes and comments, falling back to reach without views", () => {
    expect(badgeResults(ready)).toEqual([
      { key: "views", value: 1240 },
      { key: "likes", value: 48 },
      { key: "comments", value: 6 },
    ]);
    expect(badgeResults({ ...ready, views: null }).map((r) => r.key)).toEqual(["reach", "likes", "comments"]);
    // Facebook gives no views or reach.
    expect(badgeResults({ ...ready, views: null, reach: null }).map((r) => r.key)).toEqual(["likes", "comments"]);
  });

  it("lists every known number in order, leaving unknown ones out", () => {
    expect(knownResults(ready).map((r) => r.key)).toEqual(["views", "reach", "likes", "comments", "shares"]);
  });

  it("explains missing results in plain words", () => {
    expect(resultsNote({ state: "waiting" }, "instagram", "Instagram")).toBe("Results appear within a day of publishing.");
    expect(resultsNote({ state: "unsupported" }, "tiktok", "TikTok")).toBe("TikTok doesn't share post results with BuPulse.");
    expect(resultsNote({ state: "unsupported" }, "linkedin", "LinkedIn")).toMatch(/company pages only/);
    expect(resultsNote({ state: "unsupported", via: "socials" }, "linkedin", "LinkedIn")).toMatch(/through BuPulse-Socials/);
    expect(resultsNote({ state: "by_hand" }, "instagram", "Instagram")).toMatch(/"Post it yourself"/);
    expect(resultsNote({ state: "reconnect" }, "facebook", "Facebook")).toMatch(/Facebook needs to be reconnected/);
    expect(resultsNote(ready, "instagram", "Instagram")).toBeNull();
    expect(resultsNote({ ...ready, stale: "final" }, "instagram", "Instagram")).toMatch(/30 days/);
  });
});
