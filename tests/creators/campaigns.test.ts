import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The company side of creator campaigns (lib/creators/campaigns.ts) against a mocked database: permissions, the
// periods a campaign starts with, the plan limits, invite links (only their hash is stored), rejecting posts and
// payouts.

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const prisma = {
    business: { findUnique: fn() },
    creatorCampaign: { findFirst: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), updateMany: fn(), delete: fn() },
    creatorTask: { findMany: fn(), findFirst: fn(), count: fn(), createMany: fn(), update: fn(), delete: fn() },
    creatorPeriod: { findFirst: fn(), deleteMany: fn(), createMany: fn(), updateMany: fn() },
    campaignCreator: { findFirst: fn(), findMany: fn(), count: fn(), update: fn(), updateMany: fn(), groupBy: fn() },
    creatorPost: { findFirst: fn(), update: fn(), updateMany: fn() },
    creatorSubmission: { findFirst: fn(), update: fn() },
    creatorPayout: { findFirst: fn(), findMany: fn(), update: fn(), updateMany: fn() },
    creatorProfile: { findUnique: fn() },
    $executeRaw: fn(),
    $transaction: vi.fn(),
  };
  return { prisma, limits: { liveCampaigns: 2, creatorsPerCampaign: 20 } as Record<string, number>, sendEmail: vi.fn(async () => true) };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/plan-catalog", () => ({ getPlanLimits: vi.fn(async () => ({ text: 0, image: 0, videos: 0, voiceCharacters: 0, chat: 0, videoCredits: 0, seats: 1, ...h.limits })) }));
vi.mock("@/lib/auth/request-site", () => ({ linkSiteUrl: async () => "https://bupulse.com" }));
vi.mock("@/lib/publishing/email", () => ({ renderEmail: (x: { heading: string }) => ({ html: x.heading, text: x.heading }), sendEmail: h.sendEmail }));
vi.mock("@/lib/region", () => ({ companyRegion: async () => ({ currency: "RWF" }) }));
vi.mock("@/lib/team/service", () => ({
  newInviteToken: () => "t".repeat(64),
  hashToken: async (t: string) => createHash("sha256").update(t).digest("hex"),
}));

import { createCampaign, createTasks, deleteTask, markPayoutPaid, rejectPost, selectApplicant, setCampaignStatus, updateCampaign, updatePeriodGoals, type CampaignActor } from "@/lib/creators/campaigns";
import type { CampaignInput } from "@/lib/creators/company-forms";
import type { PayoutBreakdown } from "@/lib/creators/pay";

const OWNER: CampaignActor = { actorId: "u1", businessId: "b1", role: "OWNER" };
const MEMBER: CampaignActor = { actorId: "u2", businessId: "b1", role: "MEMBER" };
const NOW = new Date("2026-10-21T08:00:00Z");

const input = (over: Partial<CampaignInput> = {}): CampaignInput => ({
  name: "Kigali Summer!",
  brief: "Show our juice on a hot day.",
  platforms: ["instagram", "tiktok"],
  startsOn: "2026-11-01",
  endsOn: "2026-12-15",
  mentions: ["@leaf"],
  currency: "RWF",
  payRules: { ratePerThousand: 2000 },
  viewTargetPerCreator: 50_000,
  budget: 1_000_000,
  questions: [],
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: "c1", businessId: "b1", status: "DRAFT", startsOn: new Date("2026-11-01"), endsOn: new Date("2026-12-15"), platforms: ["instagram", "tiktok"], currency: "RWF", ...over });
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message: string }) => `${e.code}: ${e.message}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  h.limits = { liveCampaigns: 2, creatorsPerCampaign: 20 };
  h.prisma.$transaction.mockImplementation(async (run: (tx: typeof h.prisma) => unknown) => run(h.prisma));
  h.prisma.business.findUnique.mockResolvedValue({ name: "LEAF", timezone: "Africa/Kigali", userId: "u1", user: { subscription: { plan: "BUSINESS" } } });
  h.prisma.creatorCampaign.count.mockResolvedValue(0);
  h.prisma.creatorCampaign.create.mockImplementation(async ({ data }: { data: { slug: string } }) => ({ id: "c1", slug: data.slug }));
  h.prisma.creatorCampaign.findFirst.mockResolvedValue(row());
  h.prisma.creatorCampaign.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.creatorTask.findMany.mockResolvedValue([]);
  h.prisma.creatorTask.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  h.prisma.campaignCreator.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.creatorPayout.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.creatorPeriod.updateMany.mockResolvedValue({ count: 1 });
});

describe("campaigns", () => {
  it("are run by owners and admins only", async () => {
    expect(await code(createCampaign(MEMBER, input()))).toBe("forbidden: Ask your company owner or an admin to do this.");
    expect(h.prisma.creatorCampaign.create).not.toHaveBeenCalled();
  });

  it("start as a draft with a unique slug and their 30-day periods in the company's timezone, each with the goals", async () => {
    h.prisma.creatorCampaign.count.mockResolvedValueOnce(1); // "kigali-summer" is taken
    const made = await createCampaign(OWNER, input());
    expect(made.slug).toMatch(/^kigali-summer-[a-z0-9]{5}$/);
    const data = h.prisma.creatorCampaign.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ businessId: "b1", name: "Kigali Summer!", currency: "RWF", payRules: { ratePerThousand: 2000 }, viewTargetPerCreator: 50_000, createdBy: "u1" });
    expect(data.status).toBeUndefined(); // DRAFT by default
    const periods = data.periods.create;
    expect(periods.map((p: { index: number }) => p.index)).toEqual([1, 2]);
    // Midnight in Kigali (UTC+2) is 22:00 the day before in UTC.
    expect(periods[0]).toMatchObject({ startsAt: new Date("2026-10-31T22:00:00Z"), endsAt: new Date("2026-11-30T22:00:00Z"), viewTargetPerCreator: 50_000, budget: 1_000_000 });
    expect(periods[1].endsAt).toEqual(new Date("2026-12-15T22:00:00Z"));
  });

  it("refuse rules that pay nothing and a first day in the past", async () => {
    expect(await code(createCampaign(OWNER, input({ payRules: { capPerPost: 100 } })))).toMatch(/^invalid: Set how creators earn/);
    expect(await code(createCampaign(OWNER, input({ startsOn: "2026-10-20" })))).toBe("invalid: The first day cannot be in the past.");
  });

  it("keep their dates and currency once live; new goals go to periods not started", async () => {
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ status: "LIVE" }));
    expect(await code(updateCampaign(OWNER, "c1", input({ endsOn: "2026-12-31" })))).toMatch(/^conflict: The dates and the currency/);
    await updateCampaign(OWNER, "c1", input({ viewTargetPerCreator: 80_000, payRules: { ratePerThousand: 2500 } }), NOW);
    expect(h.prisma.creatorCampaign.update.mock.calls[0][0].data.payRules).toEqual({ ratePerThousand: 2500 });
    expect(h.prisma.creatorPeriod.updateMany).toHaveBeenCalledWith({ where: { campaignId: "c1", status: "OPEN", startsAt: { gt: NOW } }, data: { viewTargetPerCreator: 80_000, viewTargetCampaign: null, budget: 1_000_000 } });
  });

  it("refuse taking off a platform a task needs", async () => {
    h.prisma.creatorTask.findMany.mockResolvedValue([{ id: "t1", title: "TikTok dance", platforms: ["tiktok"], startsOn: new Date("2026-11-01"), endsOn: new Date("2026-11-07") }]);
    expect(await code(updateCampaign(OWNER, "c1", input({ platforms: ["instagram"] })))).toMatch(/^invalid: The task "TikTok dance" uses only platforms you took off/);
  });

  it("go live with a task, inside the plan's live campaigns (paused ones count)", async () => {
    h.prisma.creatorTask.count.mockResolvedValue(0);
    expect(await code(setCampaignStatus(OWNER, "c1", "LIVE", NOW))).toMatch(/^invalid: Add at least one task first/);
    h.prisma.creatorTask.count.mockResolvedValue(3);
    h.prisma.creatorCampaign.count.mockResolvedValue(2);
    expect(await code(setCampaignStatus(OWNER, "c1", "LIVE", NOW))).toMatch(/^limit: Your plan allows 2 live campaigns at a time/);
    expect(h.prisma.creatorCampaign.count).toHaveBeenCalledWith({ where: { businessId: "b1", status: { in: ["LIVE", "PAUSED"] }, id: { not: "c1" } } });
    h.prisma.creatorCampaign.count.mockResolvedValue(1);
    expect(await setCampaignStatus(OWNER, "c1", "LIVE", NOW)).toEqual({ status: "LIVE" });
    expect(h.prisma.creatorCampaign.updateMany).toHaveBeenLastCalledWith({ where: { id: "c1", status: "DRAFT" }, data: { status: "LIVE" } });
  });

  it("end: applications stop and periods that had not started go", async () => {
    h.prisma.creatorCampaign.findFirst.mockResolvedValue(row({ status: "LIVE" }));
    await setCampaignStatus(OWNER, "c1", "ENDED", NOW);
    expect(h.prisma.creatorCampaign.updateMany).toHaveBeenCalledWith({ where: { id: "c1", status: "LIVE" }, data: { status: "ENDED", acceptingApplications: false } });
    expect(h.prisma.creatorPeriod.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "c1", status: "OPEN", startsAt: { gt: NOW }, payouts: { none: {} } } });
  });
});

describe("tasks", () => {
  const task = { title: "Summer moment", instructions: "A short video outside.", startsOn: "2026-11-01", endsOn: "2026-11-14", postsPerDay: 1, platforms: ["instagram" as const], platformMode: "ANY" as const, mediaKind: "VIDEO" as const };

  it("can be made one per week or per day, inside the campaign", async () => {
    expect(await createTasks(OWNER, "c1", task, "week")).toEqual({ count: 2 });
    expect(h.prisma.creatorTask.createMany.mock.calls[0][0].data.map((t: { title: string }) => t.title)).toEqual(["Summer moment (week 1)", "Summer moment (week 2)"]);
    expect(await createTasks(OWNER, "c1", { ...task, endsOn: "2026-11-02" }, "day")).toEqual({ count: 2 });
    expect(h.prisma.creatorTask.createMany.mock.calls[1][0].data[1].title).toBe("Summer moment (2 Nov)");
    expect(await code(createTasks(OWNER, "c1", { ...task, endsOn: "2026-12-31" }))).toBe("invalid: The task's days must be inside the campaign's dates.");
    expect(await code(createTasks(OWNER, "c1", { ...task, platforms: ["facebook"] }))).toBe("invalid: Pick platforms of the campaign only.");
    expect(await code(createTasks(OWNER, "c1", { ...task, postsPerDay: 11 }))).toBe("invalid: At most 10 posts a day.");
  });

  it("already handed in cannot be deleted", async () => {
    h.prisma.creatorTask.findFirst.mockResolvedValue({ id: "t1", _count: { submissions: 2 } });
    expect(await code(deleteTask(OWNER, "t1"))).toMatch(/^conflict: Creators already handed in this task/);
    expect(h.prisma.creatorTask.delete).not.toHaveBeenCalled();
  });
});

describe("picking applicants", () => {
  const applicant = { id: "cc1", status: "APPLIED", name: "Aline Uwase", email: "aline@example.com", phone: "+250780000001", campaign: { id: "c1", name: "Summer", status: "LIVE" } };

  it("stores only the sha-256 of a 14-day invite link and emails the link", async () => {
    h.prisma.campaignCreator.findFirst.mockResolvedValue(applicant);
    h.prisma.campaignCreator.count.mockResolvedValue(3);
    const invite = await selectApplicant(OWNER, "cc1");
    const token = "t".repeat(64);
    expect(invite).toMatchObject({ link: `https://bupulse.com/creator/join/${token}`, sent: true, phone: "+250780000001", companyName: "LEAF" });
    const saved = h.prisma.campaignCreator.update.mock.calls[0][0].data;
    expect(saved.inviteTokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(h.prisma.campaignCreator.update.mock.calls)).not.toContain(token);
    expect(saved.inviteExpiresAt).toEqual(new Date(NOW.getTime() + 14 * 864e5));
    expect(h.prisma.campaignCreator.updateMany).toHaveBeenCalledWith({ where: { id: "cc1", status: "APPLIED" }, data: { status: "SELECTED", selectedAt: NOW } });
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "aline@example.com" }));
  });

  it("refuses past the plan's creators per campaign (invited, joined and offers under 14 days count)", async () => {
    h.limits.creatorsPerCampaign = 5;
    h.prisma.campaignCreator.findFirst.mockResolvedValue(applicant);
    h.prisma.campaignCreator.count.mockResolvedValue(5);
    expect(await code(selectApplicant(OWNER, "cc1"))).toMatch(/^limit: Your plan allows 5 creators in one campaign/);
    expect(h.prisma.campaignCreator.count).toHaveBeenCalledWith({
      where: { campaignId: "c1", OR: [{ status: { in: ["SELECTED", "JOINED"] } }, { status: "OFFERED", offeredAt: { gt: new Date(NOW.getTime() - 14 * 864e5) } }] },
    });
    expect(h.prisma.campaignCreator.update).not.toHaveBeenCalled();
  });

  it("adds a creator who applied with their account at once: JOINED, no invite link, and an email", async () => {
    h.prisma.campaignCreator.findFirst.mockResolvedValue({ ...applicant, source: "MARKETPLACE", profileId: "p1" });
    h.prisma.creatorProfile.findUnique.mockResolvedValue({ blockedAt: null });
    h.prisma.campaignCreator.count.mockResolvedValue(3);
    const picked = await selectApplicant(OWNER, "cc1");
    expect(picked).toEqual({ joined: true, sent: true, name: "Aline Uwase" });
    expect(h.prisma.campaignCreator.updateMany).toHaveBeenCalledWith({ where: { id: "cc1", status: "APPLIED" }, data: { status: "JOINED", selectedAt: NOW, joinedAt: NOW, inviteTokenHash: null, inviteExpiresAt: null } });
    // No token anywhere: nothing to claim.
    expect(h.prisma.campaignCreator.update).not.toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "aline@example.com", subject: 'LEAF picked you for "Summer"' }));
  });

  it("never 'selects' a creator the company invited itself, nor a blocked one", async () => {
    h.prisma.campaignCreator.findFirst.mockResolvedValue({ ...applicant, status: "DECLINED", source: "OFFER", profileId: "p1" });
    expect(await code(selectApplicant(OWNER, "cc1"))).toMatch(/^conflict: This creator did not apply/);
    h.prisma.campaignCreator.findFirst.mockResolvedValue({ ...applicant, source: "MARKETPLACE", profileId: "p1" });
    h.prisma.creatorProfile.findUnique.mockResolvedValue({ blockedAt: new Date() });
    expect(await code(selectApplicant(OWNER, "cc1"))).toMatch(/^conflict: BuPulse blocked this creator/);
    expect(h.prisma.campaignCreator.updateMany).not.toHaveBeenCalled();
  });
});

describe("rejecting and paying", () => {
  const breakdown = (amounts: Record<string, number>, deducted = 0): PayoutBreakdown => ({
    views: 0,
    countedViews: 0,
    gross: 0,
    earned: Object.values(amounts).reduce((s, n) => s + n, 0),
    posts: Object.entries(amounts).map(([postId, amount]) => ({ postId, views: 0, countedViews: 0, rate: amount, milestones: [], milestonePay: 0, fee: 0, amount })),
    deducted: deducted ? [{ postId: "old", amount: deducted }] : [],
    stillOwed: 0,
  });

  it("a rejected post loses its pay in payouts not paid yet (paid ones are taken back at the next close)", async () => {
    h.prisma.creatorPost.findFirst.mockResolvedValue({ id: "p1", status: "TRACKING", campaignCreatorId: "cc1" });
    h.prisma.creatorPayout.findMany.mockResolvedValue([{ id: "pay1", breakdown: breakdown({ p1: 30_000, p2: 10_000 }, 5_000) }]);
    await rejectPost(OWNER, "p1", "Shows another brand.");
    expect(h.prisma.creatorPost.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { status: "REJECTED", statusReason: "Shows another brand." } });
    expect(h.prisma.creatorPayout.findMany).toHaveBeenCalledWith({ where: { campaignCreatorId: "cc1", status: "DUE" }, select: { id: true, breakdown: true } });
    expect(h.prisma.creatorPayout.update.mock.calls[0][0]).toMatchObject({ where: { id: "pay1" }, data: { amount: 5_000, deductions: 5_000 } });
    expect(await code(rejectPost(OWNER, "p1", "no"))).toMatch(/^invalid: Say why/);
  });

  it("a payout is marked paid once, with its Mobile Money reference and who paid", async () => {
    h.prisma.creatorPayout.findFirst.mockResolvedValue({ id: "pay1", status: "DUE" });
    await markPayoutPaid(OWNER, "pay1", " MP123456 ");
    expect(h.prisma.creatorPayout.updateMany).toHaveBeenCalledWith({ where: { id: "pay1", status: "DUE" }, data: { status: "PAID", paidAt: NOW, paidBy: "u1", reference: "MP123456" } });
    h.prisma.creatorPayout.updateMany.mockResolvedValue({ count: 0 });
    expect(await code(markPayoutPaid(OWNER, "pay1", "MP123456"))).toBe("conflict: This payout is already marked paid.");
    expect(await code(markPayoutPaid(MEMBER, "pay1", "MP123456"))).toMatch(/^forbidden/);
  });

  it("only an open period's goals change", async () => {
    h.prisma.creatorPeriod.findFirst.mockResolvedValue({ id: "per1", status: "CLOSED" });
    h.prisma.creatorPeriod.updateMany.mockResolvedValue({ count: 0 });
    expect(await code(updatePeriodGoals(OWNER, "per1", { budget: 500_000 }))).toMatch(/^conflict: This period is closed/);
    expect(h.prisma.creatorPeriod.updateMany).toHaveBeenCalledWith({ where: { id: "per1", status: "OPEN" }, data: { viewTargetPerCreator: null, viewTargetCampaign: null, budget: 500_000 } });
  });
});
