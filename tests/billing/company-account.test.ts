import { describe, expect, it } from "vitest";
import { isCompanyAccount } from "@/lib/billing/company-account";
import { periodState } from "@/lib/billing/period";
import { accountBlock, featurePlanKey } from "@/lib/entitlements";

// A company account is a paid-plan subscription with no payment behind it: free, never ending, not revenue.

const company = { plan: "PRO", status: "ACTIVE", provider: null, providerSubscriptionId: null, currentPeriodEnd: null, chosenPlan: "PRO", trialEndsAt: null, cancelAtPeriodEnd: false };

describe("isCompanyAccount", () => {
  it("only the admin-made shape: ACTIVE, a paid plan, no provider, no end", () => {
    expect(isCompanyAccount(company)).toBe(true);
    expect(isCompanyAccount({ ...company, provider: "PADDLE", providerSubscriptionId: "sub_1" })).toBe(false);
    expect(isCompanyAccount({ ...company, provider: "MANUAL_MOMO", currentPeriodEnd: new Date("2026-12-01") })).toBe(false);
    expect(isCompanyAccount({ ...company, plan: "TRIAL", status: "TRIALING" })).toBe(false);
    expect(isCompanyAccount({ ...company, status: "PAST_DUE" })).toBe(false);
    expect(isCompanyAccount(null)).toBe(false);
  });

  it("never ends and is never read-only, years from now", () => {
    const later = new Date("2036-01-01T00:00:00Z");
    expect(periodState(company, later)).toBe("active");
    expect(accountBlock(company, later)).toBeNull();
    expect(featurePlanKey(company)).toBe("PRO");
  });
});
