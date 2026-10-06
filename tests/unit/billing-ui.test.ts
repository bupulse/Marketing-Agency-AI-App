import { describe, expect, it } from "vitest";
import { bannerState } from "@/components/app/trial-banner";
import { blockCopy, formatUsd, parseUsageBlock, planButtonAction, planFeatures, priceFor, statusLabel, yearlySavings } from "@/components/billing/helpers";
import { PRICES } from "@/lib/billing/catalog";
import { pricingPlans } from "@/lib/content/site";

describe("prices", () => {
  it("formats dollars and reads the catalog", () => {
    expect(formatUsd(490)).toBe("$490");
    expect(formatUsd(1000)).toBe("$1,000");
    expect(priceFor("STANDARD", "YEAR")).toBe(490);
    expect(pricingPlans.map((p) => p.price)).toEqual([PRICES.STANDARD.MONTH, PRICES.PRO.MONTH]);
  });

  it("yearly is 2 months free", () => {
    expect(yearlySavings("STANDARD")).toBe(98);
    expect(yearlySavings("PRO")).toBe(198);
  });
});

describe("planButtonAction", () => {
  const trial = { plan: "TRIAL", interval: "MONTH", paid: false } as const;
  const standard = { plan: "STANDARD", interval: "MONTH", paid: true } as const;

  it("trial customers buy", () => {
    expect(planButtonAction(trial, { plan: "PRO", interval: "YEAR" })).toBe("upgrade");
  });
  it("paying customers switch, and the current plan is marked", () => {
    expect(planButtonAction(standard, { plan: "STANDARD", interval: "MONTH" })).toBe("current");
    expect(planButtonAction(standard, { plan: "STANDARD", interval: "YEAR" })).toBe("switch");
    expect(planButtonAction(standard, { plan: "PRO", interval: "MONTH" })).toBe("switch");
  });
});

describe("usage blocks", () => {
  it("parses the 402 body", () => {
    expect(parseUsageBlock({ error: "usage_blocked", reason: "past_due" })).toBe("past_due");
    expect(parseUsageBlock({ error: "usage_blocked", reason: "weird" })).toBe("inactive");
    expect(parseUsageBlock({ error: "ai_failed" })).toBeNull();
    expect(parseUsageBlock(null)).toBeNull();
  });

  it("writes plain copy per reason", () => {
    expect(blockCopy("trial_expired").title).toBe("Your free trial has ended");
    const limit = blockCopy("limit_reached", { limit: 100, resetsAt: "2026-11-05T00:00:00Z" });
    expect(limit.body).toContain("all 100 text generations");
    expect(limit.body).toContain("November 5, 2026");
    expect(blockCopy("past_due").action).toBe("portal");
  });
});

describe("misc", () => {
  it("lists features from plan limits", () => {
    expect(planFeatures("STANDARD")[0]).toBe("100 text generations per month");
    expect(planFeatures("PRO")).toContain("120 seconds of video");
  });
  it("labels statuses", () => {
    expect(statusLabel("PAST_DUE")).toBe("Payment failed");
    expect(statusLabel("ACTIVE", true)).toBe("Cancels soon");
  });
  it("banner shows the past-due state first", () => {
    const base = { isTrial: false, trialDaysLeft: null, subscriptionActive: false, text: { used: 0, max: 100 }, image: { used: 0, max: 50 } };
    expect(bannerState({ ...base, pastDue: true })).toBe("pastDue");
    expect(bannerState({ ...base, subscriptionActive: true })).toBe("hidden");
  });
});
