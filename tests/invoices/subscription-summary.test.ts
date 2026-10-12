import { describe, expect, it } from "vitest";
import { subscriptionSummary } from "@/lib/admin/subscription-summary";

// What the Demos list and the demo panel show instead of Activate account once a company is past its demo.

const NOW = new Date("2026-10-13T08:00:00Z");
const names: Record<string, string> = { TRIAL: "Trial", BUSINESS: "Business", PRO: "Pro" };
const name = (k: string) => names[k] ?? k;
const base = { status: "PENDING_DEMO", plan: "TRIAL", provider: null, interval: "MONTH", trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };

describe("subscriptionSummary", () => {
  it("nothing while the company waits for its demo (Activate account is shown then)", () => {
    expect(subscriptionSummary(base, name, NOW)).toBeNull();
  });

  it("a trial: until when, with Extend trial and Change plan", () => {
    expect(subscriptionSummary({ ...base, status: "TRIALING", trialEndsAt: new Date("2026-10-15T10:00:00Z") }, name, NOW)).toEqual({ text: "On trial until 15 Oct", links: ["extend_trial", "change_plan"] });
    expect(subscriptionSummary({ ...base, status: "TRIALING", trialEndsAt: new Date("2026-10-12T10:00:00Z") }, name, NOW)?.text).toBe("Trial ended 12 Oct");
    expect(subscriptionSummary({ ...base, status: "EXPIRED", trialEndsAt: new Date("2026-10-12T10:00:00Z") }, name, NOW)).toEqual({ text: "Trial ended 12 Oct", links: ["extend_trial", "change_plan"] });
  });

  it("paying: plan, method and the period, with Change plan only", () => {
    expect(subscriptionSummary({ ...base, status: "ACTIVE", plan: "BUSINESS", provider: "MANUAL_MOMO", currentPeriodEnd: new Date("2026-11-12T08:00:00Z") }, name, NOW)).toEqual({ text: "Active – Business, MoMo, paid until 12 Nov", links: ["change_plan"] });
    expect(subscriptionSummary({ ...base, status: "ACTIVE", plan: "PRO", provider: "PADDLE", currentPeriodEnd: new Date("2026-11-12T08:00:00Z") }, name, NOW)?.text).toBe("Active – Pro, card, renews 12 Nov");
    expect(subscriptionSummary({ ...base, status: "ACTIVE", plan: "PRO", provider: "PADDLE", cancelAtPeriodEnd: true, currentPeriodEnd: new Date("2026-11-12T08:00:00Z") }, name, NOW)?.text).toBe("Active – Pro, card, cancels 12 Nov");
    expect(subscriptionSummary({ ...base, status: "PAST_DUE", plan: "BUSINESS", provider: "MANUAL_MOMO", currentPeriodEnd: new Date("2026-10-09T08:00:00Z") }, name, NOW)).toEqual({ text: "Past due – Business, MoMo (ended 9 Oct)", links: ["change_plan"] });
  });
});
