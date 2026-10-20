import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn(), findMany: vi.fn() },
    dailyPostRun: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    post: { count: vi.fn(), groupBy: vi.fn() },
    campaign: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
  },
  featureStatus: vi.fn(),
  isServiceEnabled: vi.fn(),
  runDayContent: vi.fn(),
  networkChoices: vi.fn(),
  getUsageSummary: vi.fn(),
  getSetting: vi.fn(),
  sendEmail: vi.fn(),
  push: vi.fn(),
  spend: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/entitlements", () => ({ featureStatus: mocks.featureStatus }));
vi.mock("@/lib/admin/settings", () => ({ getSetting: mocks.getSetting }));
vi.mock("@/lib/admin/switch", () => {
  class ServiceDisabledError extends Error {}
  return { isServiceEnabled: mocks.isServiceEnabled, textAiService: () => "gemini", ServiceDisabledError };
});
vi.mock("@/lib/ai/budget", () => {
  class AIBudgetExceededError extends Error {}
  class CompanyBudgetExceededError extends AIBudgetExceededError {}
  return { AIBudgetExceededError, CompanyBudgetExceededError, companySpendThisMonth: mocks.spend, effectiveBudgetUsd: async () => 30, spentThisMonthUsd: async () => 1, imageUnitUsd: () => 0.039 };
});
vi.mock("@/lib/content-flow/service", () => {
  class DayRunError extends Error {}
  return { DayRunError, ALREADY_RUNNING: "Already making today's content… it shows here in a moment.", runDayContent: mocks.runDayContent, networkChoices: mocks.networkChoices };
});
vi.mock("@/lib/usage", () => ({ getUsageSummary: mocks.getUsageSummary }));
vi.mock("@/lib/visuals/service", () => ({ aiPhotosAvailable: async () => true, videoAvailable: async () => false }));
vi.mock("@/lib/voice/service", () => ({ VOICE_FEATURE: "voice" }));
vi.mock("@/lib/publishing/email", () => ({ renderEmail: (x: { heading: string }) => ({ html: x.heading, text: x.heading }), sendEmail: mocks.sendEmail }));
vi.mock("@/lib/push/service", () => ({ pushToLeadWatchers: mocks.push }));
vi.mock("@/lib/team/recipients", () => ({ alertRecipients: async (_b: string, f: string) => [f] }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://bupulse.com" }));

import { Prisma } from "@/lib/generated/prisma/client";
import { claimDailyRun, runDailyPosts, runDueDailyPosts, sendReadyNotice } from "@/lib/daily-posts/service";

// 00:13 in Kigali on 20 October.
const night = new Date("2026-10-19T22:13:00Z");
const day = new Date("2026-10-20T00:00:00Z");
const business = { id: "b1", userId: "u1", timezone: "Africa/Kigali", dailyPostSettings: null, user: { deletionScheduledFor: null, suspendedAt: null } };
const duplicate = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.business.findUnique.mockResolvedValue(business);
  mocks.featureStatus.mockResolvedValue("ok");
  mocks.isServiceEnabled.mockResolvedValue(true);
  mocks.prisma.dailyPostRun.create.mockResolvedValue({ id: "run1", attempts: 1 });
  mocks.prisma.dailyPostRun.findMany.mockResolvedValue([]);
  mocks.prisma.post.groupBy.mockResolvedValue([]);
  mocks.prisma.campaign.findMany.mockResolvedValue([]);
  mocks.prisma.product.findMany.mockResolvedValue([{ id: "p1" }]);
  mocks.networkChoices.mockResolvedValue([{ network: "instagram", connected: true }, { network: "facebook", connected: false }]);
  mocks.getUsageSummary.mockResolvedValue({ limits: { text: 200, image: 100, videos: 0, postsPerAppPerDay: 3 }, used: { text: 0, image: 0, videos: 0 }, videosToday: 0, resetsAt: new Date("2026-11-13T00:00:00Z") });
  mocks.spend.mockResolvedValue({ totalUsd: 0, widgetUsd: 0, ownerUsd: 0, allowanceUsd: 6, widgetCapUsd: 3 });
  mocks.runDayContent.mockResolvedValue({ posts: 1, scheduled: 0, angles: ["tips"], notes: [], skipped: [] });
  mocks.getSetting.mockResolvedValue(true);
  mocks.push.mockResolvedValue(1);
});

describe("claiming the day", () => {
  it("takes a new day once; a second call finds it taken", async () => {
    expect(await claimDailyRun("b1", day, night)).toEqual({ id: "run1", attempts: 1 });
    mocks.prisma.dailyPostRun.create.mockRejectedValueOnce(duplicate());
    mocks.prisma.dailyPostRun.findUnique.mockResolvedValueOnce({ id: "run1", status: "DONE", attempts: 1, updatedAt: night, createdAt: night });
    expect(await claimDailyRun("b1", day, night)).toBeNull();
  });

  it("retakes a failed day by compare-and-set, a few times at most", async () => {
    mocks.prisma.dailyPostRun.create.mockRejectedValue(duplicate());
    mocks.prisma.dailyPostRun.findUnique.mockResolvedValueOnce({ id: "run1", status: "FAILED", attempts: 1, updatedAt: night, createdAt: night });
    mocks.prisma.dailyPostRun.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await claimDailyRun("b1", day, night)).toEqual({ id: "run1", attempts: 2 });
    expect(mocks.prisma.dailyPostRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run1", status: "FAILED", updatedAt: night } }));
    mocks.prisma.dailyPostRun.findUnique.mockResolvedValueOnce({ id: "run1", status: "FAILED", attempts: 3, updatedAt: night, createdAt: night });
    expect(await claimDailyRun("b1", day, night)).toBeNull();
  });

  it("closes a run that died after saving posts, and retakes one that saved none", async () => {
    mocks.prisma.dailyPostRun.create.mockRejectedValue(duplicate());
    const old = new Date(night.getTime() - 20 * 60 * 1000);
    mocks.prisma.dailyPostRun.findUnique.mockResolvedValue({ id: "run1", status: "RUNNING", attempts: 1, updatedAt: old, createdAt: old });
    mocks.prisma.post.count.mockResolvedValueOnce(2);
    expect(await claimDailyRun("b1", day, night)).toBeNull();
    expect(mocks.prisma.dailyPostRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DONE", posts: 2 }) }));
    mocks.prisma.post.count.mockResolvedValueOnce(0);
    mocks.prisma.dailyPostRun.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await claimDailyRun("b1", day, night)).toEqual({ id: "run1", attempts: 2 });
  });
});

describe("one company's day", () => {
  it("makes the day's posts with content flow v3's 'AI makes it for me', within the day's share", async () => {
    expect(await runDailyPosts("b1", night)).toEqual({ status: "made", posts: 1, scheduled: 0, reason: null });
    const [owner, input] = mocks.runDayContent.mock.calls[0];
    expect(owner).toEqual({ userId: "u1", businessId: "b1", service: true });
    expect(input).toMatchObject({ scope: { kind: "product", id: "p1" }, mode: "ai", design: "free", networks: ["instagram"], price: "auto", daily: { maxPosts: 1, room: { instagram: 1 }, maxAiImages: 0, maxVideos: 0, avoidAngles: [] } });
    expect(mocks.prisma.dailyPostRun.update).toHaveBeenCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "DONE", posts: 1, subjectKind: "product", subjectId: "p1", angles: ["tips"] }) });
  });

  it("rotates to another subject and leaves out yesterday's ideas", async () => {
    mocks.prisma.dailyPostRun.findMany.mockResolvedValueOnce([{ day: new Date("2026-10-19T00:00:00Z"), subjectKind: "product", subjectId: "p1", angles: ["tips", "faq"] }]);
    await runDailyPosts("b1", night);
    expect(mocks.runDayContent.mock.calls[0][1]).toMatchObject({ scope: { kind: "general" }, daily: { avoidAngles: ["tips", "faq"] } });
  });

  it("counts every post the company already has today, so Autopilot's day gets nothing more", async () => {
    mocks.prisma.post.groupBy.mockResolvedValueOnce([{ network: "instagram", _count: { _all: 1 } }]);
    expect(await runDailyPosts("b1", night)).toEqual({ status: "skipped", reason: "full" });
    expect(mocks.runDayContent).not.toHaveBeenCalled();
  });

  it("skips a day the month's spread does not allow, with the reason", async () => {
    mocks.getUsageSummary.mockResolvedValueOnce({ limits: { text: 200, image: 0, videos: 0 }, used: { text: 195, image: 0, videos: 0 }, videosToday: 0, resetsAt: new Date("2026-11-13T00:00:00Z") });
    expect(await runDailyPosts("b1", night)).toEqual({ status: "skipped", reason: "allowance" });
    expect(mocks.prisma.dailyPostRun.update).toHaveBeenCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "SKIPPED", reason: "allowance" }) });
  });

  it("leaves alone companies switched off, without the plan, read-only or past midday, without claiming", async () => {
    mocks.prisma.business.findUnique.mockResolvedValueOnce({ ...business, dailyPostSettings: { enabled: false } });
    expect(await runDailyPosts("b1", night)).toMatchObject({ status: "not_due" });
    mocks.featureStatus.mockResolvedValueOnce("not_in_plan");
    expect(await runDailyPosts("b1", night)).toMatchObject({ status: "not_due" });
    mocks.featureStatus.mockResolvedValueOnce("plan_unknown");
    expect(await runDailyPosts("b1", night)).toMatchObject({ status: "wait" });
    expect(await runDailyPosts("b1", new Date("2026-10-20T10:30:00Z"))).toMatchObject({ status: "not_due", why: "after midday" });
    mocks.prisma.business.findUnique.mockResolvedValueOnce({ ...business, user: { deletionScheduledFor: new Date(), suspendedAt: null } });
    expect(await runDailyPosts("b1", night)).toMatchObject({ status: "not_due" });
    expect(mocks.prisma.dailyPostRun.create).not.toHaveBeenCalled();
  });

  it("records a failure to retry later; the AI allowance running out is a skip", async () => {
    mocks.runDayContent.mockRejectedValueOnce(new Error("boom"));
    expect(await runDailyPosts("b1", night)).toMatchObject({ status: "failed" });
    expect(mocks.prisma.dailyPostRun.update).toHaveBeenLastCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "FAILED", subjectKind: "product" }) });
    const { CompanyBudgetExceededError } = await import("@/lib/ai/budget");
    mocks.runDayContent.mockRejectedValueOnce(new CompanyBudgetExceededError("gemini"));
    expect(await runDailyPosts("b1", night)).toEqual({ status: "skipped", reason: "ai_allowance" });
  });
});

describe("the morning notice", () => {
  const run = { id: "run1", businessId: "b1", status: "DONE", day, notifiedAt: null, business: { id: "b1", name: "LEAF", timezone: "Africa/Kigali", user: { email: "owner@example.com" } } };
  const morning = new Date("2026-10-20T05:30:00Z"); // 07:30 in Kigali

  it("says once a day that the posts are ready, by email and push, when some wait", async () => {
    mocks.prisma.dailyPostRun.findUnique.mockResolvedValue(run);
    mocks.prisma.post.count.mockResolvedValue(2);
    mocks.prisma.dailyPostRun.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.sendEmail.mockResolvedValue(true);
    expect(await sendReadyNotice("run1", morning)).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", subject: "Your posts for today are ready: approve them" }));
    expect(mocks.push).toHaveBeenCalledWith("b1", expect.objectContaining({ url: "/dashboard/content" }));
    expect(await sendReadyNotice("run1", morning)).toBe(false);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends nothing before 07:00, nor when nothing waits", async () => {
    mocks.prisma.dailyPostRun.findUnique.mockResolvedValue(run);
    expect(await sendReadyNotice("run1", night)).toBe(false);
    mocks.prisma.post.count.mockResolvedValue(0);
    mocks.prisma.dailyPostRun.updateMany.mockResolvedValue({ count: 1 });
    expect(await sendReadyNotice("run1", morning)).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("the cron", () => {
  it("makes nothing while the owner paused daily posts for everyone", async () => {
    mocks.getSetting.mockResolvedValueOnce(false);
    expect(await runDueDailyPosts({ now: night, cursor: "x" })).toMatchObject({ paused: true, made: 0 });
    expect(mocks.prisma.business.findMany).not.toHaveBeenCalled();
  });

  it("makes a couple of companies per call and hands back a cursor; done days are passed over", async () => {
    mocks.prisma.business.findMany.mockResolvedValueOnce([
      { id: "a", timezone: "Africa/Kigali", dailyPostSettings: null, dailyPostRuns: [{ day, status: "DONE", attempts: 1, updatedAt: night }] },
      { id: "b", timezone: "Africa/Kigali", dailyPostSettings: null, dailyPostRuns: [] },
      { id: "c", timezone: "Africa/Kigali", dailyPostSettings: null, dailyPostRuns: [] },
      { id: "d", timezone: "Africa/Kigali", dailyPostSettings: null, dailyPostRuns: [] },
    ]);
    const out = await runDueDailyPosts({ now: night, cursor: "0", limit: 2, budgetMs: 60_000 });
    expect(out).toMatchObject({ checked: 2, made: 2, nextCursor: "c" });
    expect(mocks.prisma.business.findUnique.mock.calls.map((c) => c[0].where.id)).toEqual(["b", "c"]);
  });
});
