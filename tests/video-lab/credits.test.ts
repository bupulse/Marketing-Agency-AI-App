import { afterEach, describe, expect, it, vi } from "vitest";

// A client's credits are their plan's videoCredits (lib/usage.ts): the studio's charge and refund go there, not to the
// owner's test wallet file (which these tests never touch).
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super(`blocked ${reason}`);
    }
  }
  return {
    UsageLimitError,
    consumeUsage: vi.fn(),
    refundUsage: vi.fn(async () => undefined),
    getUsageSummary: vi.fn(),
  };
});
vi.mock("@/lib/usage", () => usage);

import { charge, creditsLeft, enterRequest, refund } from "@/video-lab/credits";

const client = { userId: "u-1", businessId: "b-1", companyUserId: "owner-9", role: "MEMBER" };
const PERIOD = new Date("2026-10-01T00:00:00Z");
const FUTURE = new Date(Date.now() + 20 * 86400_000);
const PAST = new Date(Date.now() - 20 * 86400_000);
const active = { status: "ACTIVE", plan: "STARTER", user: { suspendedAt: null }, currentPeriodEnd: FUTURE, trialEndsAt: null };

afterEach(() => {
  enterRequest(null);
  vi.clearAllMocks();
});

describe("a client's video credits", () => {
  it("are taken from the company owner's plan and the charge says where to refund", async () => {
    usage.consumeUsage.mockResolvedValue({ periodStart: PERIOD });
    enterRequest(client);
    const payer = await charge(25, "Motion video");
    expect(usage.consumeUsage).toHaveBeenCalledWith("owner-9", "videoCredits", 25);
    expect(payer).toEqual({ userId: "owner-9", periodStart: PERIOD.toISOString() });
  });

  it("go back to the same company and period, also from a background poll with no request", async () => {
    enterRequest(null);
    await refund(25, "Seedance failed", "sd-1", { userId: "owner-9", periodStart: PERIOD.toISOString() });
    expect(usage.refundUsage).toHaveBeenCalledWith("owner-9", "videoCredits", PERIOD, 25);
  });

  it("say in plain English how many are needed and left when the plan is short", async () => {
    usage.consumeUsage.mockRejectedValue(new usage.UsageLimitError("limit_reached", "videoCredits"));
    usage.getUsageSummary.mockResolvedValue({ subscription: active, limits: { videoCredits: 100 }, used: { videoCredits: 90 } });
    enterRequest(client);
    await expect(charge(25, "x")).rejects.toThrow("Not enough video credits: this needs 25 and you have 10. Buy more credits on BuPulse.");
  });

  it("say why videos cannot be made when the plan is not active", async () => {
    usage.consumeUsage.mockRejectedValue(new usage.UsageLimitError("trial_expired", "videoCredits"));
    enterRequest(client);
    await expect(charge(25, "x")).rejects.toThrow("the free trial has ended");
  });

  it("let other errors through, so a real fault is not shown as 'no credits'", async () => {
    usage.consumeUsage.mockRejectedValue(new Error("database down"));
    enterRequest(client);
    await expect(charge(25, "x")).rejects.toThrow("database down");
  });

  it("count the balance as the plan's limit minus what is used", async () => {
    usage.getUsageSummary.mockResolvedValue({ subscription: active, limits: { videoCredits: 300 }, used: { videoCredits: 120 } });
    expect(await creditsLeft("owner-9")).toEqual({ left: 180, used: 120 });
    usage.getUsageSummary.mockResolvedValue({ subscription: active, limits: { videoCredits: 100 }, used: { videoCredits: 130 } });
    expect(await creditsLeft("owner-9")).toEqual({ left: 0, used: 130 });
    usage.getUsageSummary.mockRejectedValue(new usage.UsageLimitError("no_subscription", "text"));
    expect(await creditsLeft("owner-9")).toEqual({ blocked: "there is no active plan" });
  });

  it("show no balance for a plan that cannot spend (trial ended, payment late, suspended, waiting for the demo)", async () => {
    const limits = { videoCredits: 50 };
    const used = { videoCredits: 0 };
    const blocked = async (subscription: object) => (usage.getUsageSummary.mockResolvedValue({ subscription, limits, used }), creditsLeft("owner-9"));
    expect(await blocked({ ...active, plan: "TRIAL", status: "TRIALING", trialEndsAt: PAST })).toEqual({ blocked: "the free trial has ended" });
    expect(await blocked({ ...active, status: "PAST_DUE" })).toEqual({ blocked: "the last payment did not go through" });
    expect(await blocked({ ...active, user: { suspendedAt: new Date() } })).toEqual({ blocked: "the plan is not active" });
    expect(await blocked({ ...active, status: "PENDING_DEMO" })).toEqual({ blocked: "the account is waiting for its demo to start" });
    expect(await blocked({ ...active, currentPeriodEnd: new Date(Date.now() - 400 * 86400_000) })).toEqual({ blocked: "the plan is not active" });
    expect(await blocked({ ...active, plan: "TRIAL", status: "TRIALING", trialEndsAt: FUTURE })).toEqual({ left: 50, used: 0 });
  });
});
