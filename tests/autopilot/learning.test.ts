import { describe, expect, it } from "vitest";
import {
  buildProfile,
  chooseIdea,
  EMPTY_PROFILE,
  engagementRate,
  MIN_POSTS_TO_LEARN,
  NETWORK_DEFAULTS,
  noopTrendSource,
  preferredHours,
  preferredWeekdays,
  seededRandom,
  type PostResult,
} from "@/lib/autopilot/learning";
import { IDEAS, getIdea } from "@/lib/autopilot/playbook";

const post = (over: Partial<PostResult>): PostResult => ({
  playbookId: "tip-how-to",
  network: "instagram",
  publishedAt: new Date("2026-09-14T10:00:00Z"),
  reach: 1000,
  likes: 10,
  comments: 0,
  saves: 0,
  shares: 0,
  ...over,
});

describe("engagement rate", () => {
  it("weighs likes 1, comments 2, saves 3, shares 3 over reach", () => {
    expect(engagementRate({ reach: 1000, likes: 10, comments: 5, saves: 2, shares: 1 })).toBeCloseTo((10 + 10 + 6 + 3) / 1000);
  });
  it("falls back to views, then to a fixed audience, and caps at 1", () => {
    expect(engagementRate({ views: 200, likes: 20 })).toBeCloseTo(0.1);
    expect(engagementRate({ likes: 20 })).toBeCloseTo(0.2);
    expect(engagementRate({ reach: 10, likes: 500 })).toBe(1);
    expect(engagementRate({})).toBe(0);
  });
  it("prefers reach over views", () => {
    expect(engagementRate({ reach: 100, views: 1000, likes: 10 })).toBeCloseTo(0.1);
  });
});

describe("learning profile", () => {
  const results: PostResult[] = [
    ...Array.from({ length: 4 }, (_, i) => post({ playbookId: "tip-how-to", likes: 80, publishedAt: new Date(`2026-09-1${i + 4}T07:00:00Z`) })),
    ...Array.from({ length: 4 }, (_, i) => post({ playbookId: "offer-promo", likes: 5, publishedAt: new Date(`2026-09-1${i + 4}T16:00:00Z`) })),
  ];

  it("scores ideas by engagement, best first", () => {
    const profile = buildProfile(results, "UTC");
    expect(profile.confident).toBe(true);
    expect(profile.ideas.get("tip-how-to")!).toBeGreaterThan(profile.ideas.get("offer-promo")!);
  });

  it("shrinks a single lucky post towards the mean", () => {
    const profile = buildProfile([...results, post({ playbookId: "milestone", likes: 900 })], "UTC");
    expect(profile.ideas.get("milestone")!).toBeLessThan(0.9);
    expect(profile.ideas.get("milestone")!).toBeGreaterThan(profile.mean);
  });

  it("scores networks", () => {
    const profile = buildProfile([...results, post({ network: "linkedin", likes: 200 }), post({ network: "linkedin", likes: 200 })], "UTC");
    expect(profile.networks.get("linkedin")!).toBeGreaterThan(profile.networks.get("instagram")!);
  });

  it("finds the best hour and weekday in the business's time zone", () => {
    const profile = buildProfile(results, "Africa/Kigali"); // UTC+2
    expect(profile.bestHours.get("all")![0]).toBe(9); // the 07:00 UTC posts did best
    // 14 Sep 2026 is a Monday.
    expect(profile.bestWeekdays.get("all")!.length).toBeGreaterThan(0);
    const late = buildProfile(
      [
        post({ publishedAt: new Date("2026-09-14T23:30:00Z"), likes: 90 }), // Tuesday 01:30 in Kigali
        post({ publishedAt: new Date("2026-09-21T23:30:00Z"), likes: 90 }),
        post({ publishedAt: new Date("2026-09-15T12:00:00Z"), likes: 5 }),
        post({ publishedAt: new Date("2026-09-22T12:00:00Z"), likes: 5 }),
      ],
      "Africa/Kigali",
    );
    expect(late.bestHours.get("instagram")![0]).toBe(1);
    expect(late.bestWeekdays.get("instagram")![0]).toBe(1); // Tuesday there, not Monday
  });

  it("is not confident without enough posts and then uses the defaults", () => {
    const few = buildProfile(results.slice(0, MIN_POSTS_TO_LEARN - 1), "UTC");
    expect(few.confident).toBe(false);
    expect(preferredHours(few, "linkedin")).toEqual(NETWORK_DEFAULTS.linkedin.hours);
    expect(preferredWeekdays(EMPTY_PROFILE, "tiktok")).toEqual(NETWORK_DEFAULTS.tiktok.weekdays);
  });

  it("puts learned hours first when confident", () => {
    const profile = buildProfile(results, "UTC");
    expect(preferredHours(profile, "instagram")[0]).toBe(7);
  });
});

describe("choosing ideas", () => {
  const candidates = IDEAS.filter((i) => !i.needs.length && i.formats.instagram);
  const profileFavouring = (id: string) =>
    buildProfile(
      [
        ...Array.from({ length: 8 }, () => post({ playbookId: id, likes: 400 })),
        ...candidates.filter((c) => c.id !== id).flatMap((c) => Array.from({ length: 2 }, () => post({ playbookId: c.id, likes: 3 }))),
      ],
      "UTC",
    );
  const tally = (profile: ReturnType<typeof buildProfile>, runs: number) => {
    const rng = seededRandom("tally");
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const idea = chooseIdea(candidates, { profile, rng, recent: new Map(), chosenGoals: [] });
      counts.set(idea.id, (counts.get(idea.id) ?? 0) + 1);
    }
    return counts;
  };

  it("exploits the best idea most of the time but still explores", () => {
    const counts = tally(profileFavouring("tip-how-to"), 1000);
    const top = counts.get("tip-how-to") ?? 0;
    expect(top).toBeGreaterThan(250); // exploited
    expect(counts.size).toBeGreaterThan(5); // and explored, not stuck on one idea
  });

  it("explores evenly without data", () => {
    const counts = tally(EMPTY_PROFILE, 1000);
    expect(counts.size).toBeGreaterThan(candidates.length * 0.8);
  });

  it("down-weights recent ideas and repeated goals", () => {
    const rng = seededRandom("recent");
    const recent = new Map(candidates.map((c) => [c.id, c.id === "poll-question" ? 0 : 5]));
    let poll = 0;
    for (let i = 0; i < 300; i++) if (chooseIdea(candidates, { profile: EMPTY_PROFILE, rng, recent, chosenGoals: [] }).id === "poll-question") poll++;
    expect(poll).toBeGreaterThan(300 / candidates.length);
  });

  it("is repeatable for the same seed and throws on no candidates", () => {
    const a = chooseIdea(candidates, { profile: EMPTY_PROFILE, rng: seededRandom("x"), recent: new Map(), chosenGoals: [] });
    const b = chooseIdea(candidates, { profile: EMPTY_PROFILE, rng: seededRandom("x"), recent: new Map(), chosenGoals: [] });
    expect(a.id).toBe(b.id);
    expect(() => chooseIdea([], { profile: EMPTY_PROFILE, rng: seededRandom("x"), recent: new Map(), chosenGoals: [] })).toThrow();
    expect(getIdea("nope")).toBeUndefined();
  });
});

describe("trend source", () => {
  it("has a no-op implementation", async () => {
    expect(await noopTrendSource.trends({ network: "instagram" })).toEqual([]);
  });
});
