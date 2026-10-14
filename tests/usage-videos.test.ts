import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./admin/fake-db";

// Video usage in videos, not seconds (owner decision, 14 October 2026; docs/CONTENT_VISUALS.md): 120 a month on the
// plans with video (a plan setting), at most 4 a day (Kigali day, also a plan setting), each at most 30 seconds; a
// failed render uses nothing; the migration moves existing counters and plans.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get: (_t, p) => (h.db as never)[p] }) }));

import { consumeDailyVideo, consumeUsage, DailyVideoLimitError, getUsageSummary, refundDailyVideo, UsageLimitError } from "@/lib/usage";
import { cleanLimits, resetPlanCache } from "@/lib/plan-catalog";
import { SEED_PLANS, VIDEO_MAX_SECONDS, VIDEO_PLAN_VIDEOS, VIDEOS_PER_DAY, videosLeftNow, videosPerDayLimit, VOICE_PLAN_CHARACTERS } from "@/lib/plans";
import { planFeatures } from "@/components/billing/helpers";

const USER = "11111111-1111-4111-8111-111111111111";

function seed(plan = "PRO") {
  h.db.user.rows.push({ id: USER, email: "a@b.rw", suspendedAt: null });
  h.db.subscription.rows.push({ id: "s1", userId: USER, plan, status: "ACTIVE", currentPeriodStart: new Date("2026-10-01T00:00:00Z"), currentPeriodEnd: new Date("2026-11-01T00:00:00Z"), trialEndsAt: null, user: { suspendedAt: null } });
}

beforeEach(() => {
  h.db = createFakeDb();
  resetPlanCache();
});

describe("the rule (pure)", () => {
  it("4 a day for 30 days = 120 a month, at most 30 s each; voiceover fits a 30 s voiceover for each", () => {
    expect([VIDEOS_PER_DAY, VIDEO_PLAN_VIDEOS, VIDEO_MAX_SECONDS]).toEqual([4, 120, 30]);
    expect(VOICE_PLAN_CHARACTERS).toBe(120 * 600);
    expect(SEED_PLANS.PRO.limits).toMatchObject({ videos: 120, voiceCharacters: 72_000 });
    expect(SEED_PLANS.TRIAL.limits.videos).toBe(1);
  });

  it("the daily cap is the plan's own (0 to 100), 4 when not set, never more than the month's", () => {
    expect(videosPerDayLimit({ videos: 120 })).toBe(4);
    expect(videosPerDayLimit({ videos: 120, videosPerDay: 6 })).toBe(6);
    expect(videosPerDayLimit({ videos: 1 })).toBe(1);
    expect(videosPerDayLimit({ videos: 0 })).toBe(0);
    expect(cleanLimits({ videos: 120, videosPerDay: 6 })).toMatchObject({ videos: 120, videosPerDay: 6 });
    expect(cleanLimits({ videos: 120, videosPerDay: -1 }).videosPerDay).toBeUndefined();
  });

  it("left now = the lower of this month's and today's", () => {
    expect(videosLeftNow({ used: { videos: 10 }, limits: { videos: 120 }, videosToday: 1 })).toBe(3);
    expect(videosLeftNow({ used: { videos: 119 }, limits: { videos: 120 }, videosToday: 0 })).toBe(1);
    expect(videosLeftNow({ used: { videos: 5 }, limits: { videos: 120 }, videosToday: 4 })).toBe(0);
  });

  it("the plan cards and comparison say videos, not seconds", () => {
    expect(planFeatures(SEED_PLANS.PRO.limits)).toContain("120 videos a month (up to 30 s each, 4 a day)");
    expect(planFeatures(SEED_PLANS.TRIAL.limits)).toContain("1 video a month (up to 30 s each)");
  });
});

describe("counting (database)", () => {
  it("one video a time: the month's count and today's, 4 a day; a refund gives today's back", async () => {
    seed();
    const now = new Date("2026-10-13T20:00:00Z"); // 22:00 in Kigali
    for (let i = 0; i < 4; i++) {
      await consumeUsage(USER, "videos", 1);
      await consumeDailyVideo(USER, 4, now);
    }
    await expect(consumeDailyVideo(USER, 4, now)).rejects.toBeInstanceOf(DailyVideoLimitError);
    await expect(consumeDailyVideo(USER, 4, now)).rejects.toBeInstanceOf(UsageLimitError);
    // Midnight in Kigali is a new day (22:00 UTC).
    await expect(consumeDailyVideo(USER, 4, new Date("2026-10-13T22:30:00Z"))).resolves.toEqual({ day: "2026-10-14" });
    await refundDailyVideo(USER, "2026-10-13");
    await expect(consumeDailyVideo(USER, 4, now)).resolves.toEqual({ day: "2026-10-13" });
    const summary = await getUsageSummary(USER);
    expect(summary.used.videos).toBe(4);
    expect(summary.videosPerDay).toBe(4);
  });

  it("the month's 120 are a hard cap", async () => {
    seed();
    h.db.usageRecord.rows.push({ id: "u1", userId: USER, periodStart: new Date("2026-10-01T00:00:00Z"), textGenerations: 0, imageGenerations: 0, videos: 120, voiceCharacters: 0, chatMessages: 0 });
    await expect(consumeUsage(USER, "videos", 1)).rejects.toBeInstanceOf(UsageLimitError);
  });
});

describe("the migration (20261018120000_videos_per_month)", () => {
  const sql = readFileSync("prisma/migrations/20261018120000_videos_per_month/migration.sql", "utf8");

  it("moves the counter to videos (each started 30 s is one) and the plans to 120 a month, 4 a day, the trial 1", () => {
    expect(sql).toContain(`ALTER TABLE "UsageRecord" RENAME COLUMN "videoSeconds" TO "videos";`);
    expect(sql).toContain(`SET "videos" = CEIL("videos" / 30.0)::int WHERE "videos" > 0`);
    expect(sql).toMatch(/'videos', CASE WHEN .*<= 0 THEN 0 WHEN .*<= 30 THEN 1 ELSE 120 END/);
    expect(sql).toMatch(/'videosPerDay', CASE WHEN .*<= 0 THEN 0 WHEN .*<= 30 THEN 1 ELSE 4 END/);
    expect(sql).toContain(`("limits" - 'videoSeconds')`);
    expect(sql).toMatch(/CREATE TABLE "VideoDayUsage"[\s\S]*PRIMARY KEY \("userId", "day"\)[\s\S]*ENABLE ROW LEVEL SECURITY[\s\S]*REVOKE ALL ON TABLE "VideoDayUsage"/);
  });
});
