import { describe, expect, it } from "vitest";
import { healthFlags, riskLevel, riskScore, usageShareOf, whatsappLink, type HealthInput } from "@/lib/admin/client-health-shared";

const now = new Date("2026-10-13T12:00:00Z");
const base: HealthInput = { status: "ACTIVE", plan: "STANDARD", trialEndsAt: null, lastActiveAt: new Date("2026-10-12T12:00:00Z"), usageShare: 0.5, periodDays: 10, suspended: false };

describe("client health", () => {
  it("is healthy when active, recent and using the plan", () => {
    expect(healthFlags(base, now)).toEqual([]);
    expect(riskLevel(riskScore([]))).toBe("ok");
  });
  it("flags 7 days without activity", () => {
    expect(healthFlags({ ...base, lastActiveAt: new Date("2026-10-05T11:00:00Z") }, now)).toContain("inactive");
    expect(healthFlags({ ...base, lastActiveAt: null }, now)).toContain("inactive");
  });
  it("flags a trial ending within 3 days", () => {
    expect(healthFlags({ ...base, status: "TRIALING", plan: "TRIAL", trialEndsAt: new Date("2026-10-15T00:00:00Z") }, now)).toContain("trial_ending");
    expect(healthFlags({ ...base, status: "TRIALING", plan: "TRIAL", trialEndsAt: new Date("2026-10-25T00:00:00Z") }, now)).not.toContain("trial_ending");
  });
  it("flags past due as high risk", () => {
    const flags = healthFlags({ ...base, status: "PAST_DUE" }, now);
    expect(flags).toContain("past_due");
    expect(riskLevel(riskScore(flags))).toBe("high");
  });
  it("flags low usage only after a week of a paid period", () => {
    expect(healthFlags({ ...base, usageShare: 0.02 }, now)).toContain("low_usage");
    expect(healthFlags({ ...base, usageShare: 0.02, periodDays: 3 }, now)).not.toContain("low_usage");
  });
  it("uses the busiest limit", () => {
    expect(usageShareOf({ text: 10, image: 9 }, { text: 100, image: 10, videoSeconds: 0 })).toBeCloseTo(0.9);
    expect(usageShareOf({ text: 1 }, { text: 0 })).toBeNull();
  });
  it("builds WhatsApp links with the Rwandan code for local numbers", () => {
    expect(whatsappLink("0788 123 456", "Hi")).toBe("https://wa.me/250788123456?text=Hi");
    expect(whatsappLink("+250 788 123 456", "Hi there")).toBe("https://wa.me/250788123456?text=Hi%20there");
    expect(whatsappLink("123", "Hi")).toBeNull();
    expect(whatsappLink(null, "Hi")).toBeNull();
  });
});
