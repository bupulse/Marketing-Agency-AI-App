import { describe, expect, it } from "vitest";
import { ADDONS, METRIC_LABEL, OFFER_METRICS, offerIncluded, quoteOffer, type OfferBase } from "@/lib/offers/shared";
import { SEED_PLANS } from "@/lib/plans";

// Video Studio credits as an offer metric and an add-on block (docs/VIDEO_APP_INTEGRATION.md, section 3).
const BUSINESS: OfferBase = { key: "BUSINESS", name: "Business", monthlyMinor: 50_000, yearlyMinor: 500_000, features: ["content", "designs", "calendar", "gallery", "video", "voice"], limits: { ...SEED_PLANS.PRO.limits, videoCredits: 500 } };
const PRICES = [{ addonKey: "block:videoCredits", regionKey: "RW", currency: "RWF", monthlyMinor: 10_000 }];
const quote = (limits: Parameters<typeof quoteOffer>[0]["limits"]) => quoteOffer({ base: BUSINESS, features: [], limits, interval: "MONTH", currency: "RWF", regionKey: "RW", prices: PRICES });

describe("video credits in offers", () => {
  it("is a priced block of 1,000 credits, with its own label", () => {
    expect(OFFER_METRICS).toContain("videoCredits");
    expect(ADDONS.find((a) => a.key === "block:videoCredits")).toEqual({ key: "block:videoCredits", kind: "block", metric: "videoCredits", blockSize: 1000, label: "+1,000 video credits" });
    expect(METRIC_LABEL.videoCredits).toBe("Video Studio credits a month");
  });

  it("includes the base plan's credits and prices what is above them in blocks", () => {
    expect(offerIncluded(BUSINESS, []).videoCredits).toBe(500);
    const q = quote({ text: 300, image: 100, chat: 5000, videoCredits: 2000, seats: 10 });
    expect(q.limits.videoCredits).toBe(2000);
    expect(q.lines.find((l) => l.key === "block:videoCredits")).toMatchObject({ quantity: 2, unitMinor: 10_000, totalMinor: 20_000 });
  });

  it("an offer saved before credits existed keeps the plan's credits and costs nothing more (never NaN)", () => {
    const q = quote({ text: 300, image: 100, chat: 5000, seats: 10 });
    expect(q.limits.videoCredits).toBe(500);
    expect(q.lines.some((l) => l.key === "block:videoCredits")).toBe(false);
    expect(Number.isFinite(q.computedMinor)).toBe(true);
    // A base plan from before credits (no videoCredits in its limits): 0 included.
    const old = { ...BUSINESS, limits: { ...BUSINESS.limits, videoCredits: undefined as unknown as number } };
    expect(offerIncluded(old, []).videoCredits).toBe(0);
  });
});
