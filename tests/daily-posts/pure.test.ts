import { describe, expect, it } from "vitest";
import { dailyTodayLine, dayBudget, daysLeft, PLATFORM_CEILING, TEXT_POST_USD, todayShare, type DayBudgetInput } from "@/lib/daily-posts/budget";
import { appRoom, chooseSubject, dueDay, noticeDue } from "@/lib/daily-posts/plan";
import { dailyApps, dailyPostLabel, dailySettingsSchema, DEFAULT_DAILY_SETTINGS, readDailySettings } from "@/lib/daily-posts/settings";
import { withinDaily } from "@/lib/content-flow/slots";

const base: DayBudgetInput = {
  room: { instagram: 1, facebook: 1 },
  textLeft: 200,
  imagesLeft: 100,
  videosLeftMonth: 120,
  videosLeftNow: 4,
  periodDays: 30,
  wantsAi: false,
  voice: false,
  companyUsdLeft: 6,
  monthDays: 30,
  platformCapUsd: 30,
  platformSpentUsd: 0,
  imageUsd: 0.039,
};

describe("the day's share of the allowances", () => {
  it("spreads what is left over the days left, keeping a fifth for the owner", () => {
    expect(todayShare(200, 30)).toBe(5);
    expect(todayShare(10, 30)).toBe(0);
    expect(todayShare(-3, 30)).toBe(0);
    expect(daysLeft(new Date("2026-10-20T10:00:00Z"), new Date("2026-10-23T10:00:00Z"))).toBe(3);
    expect(daysLeft(new Date("2026-10-20T10:00:00Z"), new Date("2026-10-20T09:00:00Z"))).toBe(1);
  });

  it("makes one post per app with room when the month allows it, free designs unless AI was chosen", () => {
    expect(dayBudget(base)).toEqual({ ok: true, maxPosts: 2, maxAiImages: 0, maxVideos: 2, estimateUsd: 0.04, smaller: null });
    expect(dayBudget({ ...base, wantsAi: true })).toMatchObject({ ok: true, maxAiImages: 2 });
  });

  it("never uses the month up in the first week: fewer posts, then none, with the reason", () => {
    // 40 texts left over 30 days: one a day.
    expect(dayBudget({ ...base, textLeft: 40 })).toMatchObject({ ok: true, maxPosts: 1, smaller: "allowance" });
    expect(dayBudget({ ...base, textLeft: 20 })).toEqual({ ok: false, reason: "allowance" });
    // A whole month of daily posts on 2 apps stays within 80% of a 200-text plan.
    let left = 200;
    for (let day = 30; day >= 1; day--) {
      const b = dayBudget({ ...base, textLeft: left, periodDays: day });
      if (b.ok) left -= b.maxPosts;
    }
    expect(left).toBeGreaterThanOrEqual(200 - 160);
  });

  it("AI photos and videos only within their own spread", () => {
    expect(dayBudget({ ...base, wantsAi: true, imagesLeft: 20 })).toMatchObject({ maxAiImages: 0 });
    expect(dayBudget({ ...base, videosLeftNow: 0 })).toMatchObject({ maxVideos: 0 });
    expect(dayBudget({ ...base, videosLeftMonth: 30 })).toMatchObject({ maxVideos: 0 });
  });

  it("shrinks or skips a day the company's AI allowance cannot carry: AI photos first, then videos, then posts", () => {
    // $1 left over 30 days: about 2.7 cents a day, one written post.
    expect(dayBudget({ ...base, wantsAi: true, companyUsdLeft: 1 })).toMatchObject({ ok: true, maxPosts: 1, maxAiImages: 0, smaller: "ai_allowance" });
    expect(dayBudget({ ...base, wantsAi: true, companyUsdLeft: 0.2 })).toEqual({ ok: false, reason: "ai_allowance" });
  });

  it("never pushes the platform's AI budget past its ceiling", () => {
    expect(dayBudget({ ...base, platformSpentUsd: 30 * PLATFORM_CEILING })).toEqual({ ok: false, reason: "budget" });
    expect(dayBudget({ ...base, platformSpentUsd: 30 * PLATFORM_CEILING - TEXT_POST_USD })).toMatchObject({ ok: true, maxPosts: 1, smaller: "budget" });
  });

  it("makes nothing when every app already has its posts (Autopilot's count too)", () => {
    expect(dayBudget({ ...base, room: { instagram: 0, facebook: 0 } })).toEqual({ ok: false, reason: "full" });
  });

  it("says what happened today in one line for the admin", () => {
    expect(dailyTodayLine({ day: "2026-10-20", paused: false, companies: 3, posts: 7, skipped: { allowance: 2, budget: 1 }, failed: 0, running: 0 })).toBe(
      "Today (2026-10-20, Kigali): 3 companies got daily posts (7 posts); 3 skipped (2 plan allowance spread over the month, 1 platform AI budget).",
    );
    expect(dailyTodayLine({ day: "2026-10-20", paused: true, companies: 0, posts: 0, skipped: {}, failed: 1, running: 0 })).toContain("Paused");
  });
});

describe("when and what", () => {
  it("is due from local midnight until midday, for the local day", () => {
    expect(dueDay("Africa/Kigali", new Date("2026-10-19T22:13:00Z"))).toBe("2026-10-20"); // 00:13 in Kigali
    expect(dueDay("Africa/Kigali", new Date("2026-10-20T09:59:00Z"))).toBe("2026-10-20"); // 11:59
    expect(dueDay("Africa/Kigali", new Date("2026-10-20T10:00:00Z"))).toBeNull(); // midday
    expect(dueDay("America/New_York", new Date("2026-10-20T10:00:00Z"))).toBe("2026-10-20"); // 06:00 there
  });

  it("announces the day's posts from 07:00 on that day only", () => {
    expect(noticeDue("2026-10-20", "Africa/Kigali", new Date("2026-10-20T04:59:00Z"))).toBe(false);
    expect(noticeDue("2026-10-20", "Africa/Kigali", new Date("2026-10-20T05:00:00Z"))).toBe(true);
    expect(noticeDue("2026-10-20", "Africa/Kigali", new Date("2026-10-21T05:00:00Z"))).toBe(false);
  });

  it("rotates the subject: never had first, then the one had longest ago; never the same twice in a row", () => {
    const subjects = [{ kind: "campaign" as const, id: "c1" }, { kind: "product" as const, id: "p1" }, { kind: "product" as const, id: "p2" }, { kind: "general" as const }];
    expect(chooseSubject(subjects, [])).toEqual(subjects[0]);
    expect(chooseSubject(subjects, [{ kind: "campaign", id: "c1" }])).toEqual(subjects[1]);
    const history = [{ kind: "product", id: "p2" }, { kind: "general", id: null }, { kind: "product", id: "p1" }, { kind: "campaign", id: "c1" }];
    expect(chooseSubject(subjects, history)).toEqual(subjects[0]);
    expect(chooseSubject([{ kind: "general" }], [{ kind: "general", id: null }])).toEqual({ kind: "general" });
    expect(chooseSubject([], [])).toBeNull();
  });

  it("gives each app the owner's posts per app within the plan, less what it already has today", () => {
    expect(appRoom(["instagram", "facebook"], 2, 3, { instagram: 1 })).toEqual({ instagram: 1, facebook: 2 });
    expect(appRoom(["instagram"], 5, 1, {})).toEqual({ instagram: 1 });
    expect(appRoom(["instagram"], 1, 3, { instagram: 4 })).toEqual({ instagram: 0 });
  });

  it("keeps a run within the day's posts and each app's room, every app once first", () => {
    expect(withinDaily(["instagram", "facebook", "instagram", "facebook"], { maxPosts: 3, room: { instagram: 2, facebook: 1 } })).toEqual(["instagram", "facebook", "instagram"]);
    expect(withinDaily(["instagram", "facebook"], { maxPosts: 1, room: { instagram: 1, facebook: 1 } })).toEqual(["instagram"]);
    expect(withinDaily(["tiktok"], { maxPosts: 5, room: {} })).toEqual([]);
  });
});

describe("daily posts settings", () => {
  it("are on by default, one post per app, the connected apps, free designs", () => {
    expect(readDailySettings(null)).toEqual(DEFAULT_DAILY_SETTINGS);
    expect(DEFAULT_DAILY_SETTINGS).toEqual({ enabled: true, perApp: 1, apps: null, design: "free", videoQuality: "simple" });
  });

  it("read field by field, so one bad value does not reset the rest", () => {
    expect(readDailySettings({ enabled: false, perApp: 99, apps: ["facebook", "instagram"], design: "ai" })).toEqual({ enabled: false, perApp: 1, apps: ["instagram", "facebook"], design: "ai", videoQuality: "simple" });
    expect(readDailySettings("garbage")).toEqual(DEFAULT_DAILY_SETTINGS);
  });

  it("validate input strictly", () => {
    expect(dailySettingsSchema.safeParse({ enabled: true, perApp: 2, apps: null, design: "free" }).success).toBe(true);
    expect(dailySettingsSchema.safeParse({ enabled: true, perApp: 2, apps: [], design: "free" }).success).toBe(false);
    expect(dailySettingsSchema.safeParse({ enabled: true, perApp: 2, apps: ["myspace"], design: "free" }).success).toBe(false);
    expect(dailySettingsSchema.safeParse({ enabled: true, perApp: 2, apps: null, design: "free", extra: 1 }).success).toBe(false);
  });

  it("make posts for the chosen apps, else the connected ones, else Instagram and Facebook", () => {
    expect(dailyApps({ apps: ["linkedin"] }, ["instagram"])).toEqual(["linkedin"]);
    expect(dailyApps({ apps: null }, ["tiktok", "instagram"])).toEqual(["instagram", "tiktok"]);
    expect(dailyApps({ apps: null }, [])).toEqual(["instagram", "facebook"]);
  });

  it("keep only the apps a plan allows a day (Starter: one), the first in the app list", () => {
    expect(dailyApps({ apps: null }, ["tiktok", "instagram"], 1)).toEqual(["instagram"]);
    expect(dailyApps({ apps: ["facebook", "linkedin"] }, [], 1)).toEqual(["facebook"]);
    expect(dailyApps({ apps: null }, [], 1)).toEqual(["instagram"]);
    expect(dailyApps({ apps: null }, ["tiktok", "instagram"], null)).toEqual(["instagram", "tiktok"]);
    expect(dailyApps({ apps: null }, ["tiktok", "instagram"], 0)).toEqual(["instagram", "tiktok"]);
  });

  it("label a daily post 'Made for you this morning' on its own day", () => {
    const now = new Date("2026-10-20T08:00:00Z");
    expect(dailyPostLabel("2026-10-19T22:30:00Z", "Africa/Kigali", now)).toBe("Made for you this morning");
    expect(dailyPostLabel("2026-10-18T22:30:00Z", "Africa/Kigali", now)).toBe("Made for you");
  });
});
