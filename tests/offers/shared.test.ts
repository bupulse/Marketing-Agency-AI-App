import { describe, expect, it } from "vitest";
import {
  ADDONS,
  adjustmentText,
  canMoveOffer,
  checkOfferDraft,
  customPlanKeyFor,
  isOfferExpired,
  offerDraftSchema,
  quoteOffer,
  removalBlockedBy,
  requestSchema,
  resolveOfferFeatures,
  type AddonPriceRow,
  type OfferBase,
} from "@/lib/offers/shared";

// The add-on catalog, the price maths, prerequisites, the offer rules and the request form (lib/offers/shared.ts).

// Rwanda's add-on prices, as the migration seeds them (docs/RWANDA_LAUNCH_PLAN.md section 4).
const RW: AddonPriceRow[] = [
  ["block:text", 3000], ["block:image", 5000], ["block:chat", 3000], ["seat", 3000], ["aiPhotos", 8000], ["websiteChat", 10000], ["autopilot", 20000], ["analytics", 5000],
  ["canva", 5000], ["storeImport", 10000], ["driveImport", 3000], ["webhooks", 5000], ["apiAccess", 15000], ["managed:light", 100000], ["managed:full", 180000],
].map(([addonKey, monthlyMinor]) => ({ addonKey: String(addonKey), regionKey: "RW", currency: "RWF", monthlyMinor: Number(monthlyMinor) }));

// Rwanda's Business plan: website chat and Autopilot are add-ons there (docs/RWANDA_LAUNCH_PLAN.md section 2).
const BUSINESS: OfferBase = { key: "BUSINESS", name: "Business", monthlyMinor: 35000, yearlyMinor: 350000, features: ["content", "designs", "calendar", "gallery"], limits: { text: 200, image: 100, chat: 0, videos: 0, voiceCharacters: 0, videoCredits: 0, seats: 3 } };
const baseLimits = { text: 200, image: 100, chat: 0, seats: 3 };
const quote = (over: Partial<Parameters<typeof quoteOffer>[0]> = {}) => quoteOffer({ base: BUSINESS, features: [], limits: baseLimits, interval: "MONTH", currency: "RWF", regionKey: "RW", prices: RW, ...over });

describe("pricing totals", () => {
  it("the plan's own example: Business + website chat + Autopilot + AI photos = 73,000 RWF a month", () => {
    const q = quote({ features: ["websiteChat", "autopilot", "aiPhotos"], limits: { ...baseLimits, image: 130, chat: 500 } });
    expect(q.lines.map((l) => [l.key, l.totalMinor])).toEqual([["plan:BUSINESS", 35000], ["aiPhotos", 8000], ["websiteChat", 10000], ["autopilot", 20000]]);
    expect(q.computedMinor).toBe(73000);
    expect(q.missing).toEqual([]);
    expect(q.added).toEqual(["aiPhotos", "websiteChat", "autopilot"]);
  });

  it("yearly: the base plan's yearly price plus 10 months of each add-on", () => {
    const q = quote({ features: ["websiteChat", "autopilot", "aiPhotos"], interval: "YEAR" });
    expect(q.computedMinor).toBe(350000 + 38000 * 10);
  });

  it("limits above what is included are bought in blocks; add-ons bring their own allowance", () => {
    const q = quote({ features: ["websiteChat"], limits: { text: 450, image: 100, chat: 1500, seats: 5 } });
    expect(q.included).toEqual({ text: 200, image: 100, chat: 500, videoCredits: 0, seats: 3, postsPerAppPerDay: 1 });
    const line = (k: string) => q.lines.find((l) => l.key === k);
    expect(line("block:text")).toMatchObject({ quantity: 3, totalMinor: 9000 }); // 250 more texts = 3 blocks of 100
    expect(line("block:chat")).toMatchObject({ quantity: 1, totalMinor: 3000 }); // 1,000 more replies
    expect(line("seat")).toMatchObject({ quantity: 2, totalMinor: 6000 });
    expect(line("block:image")).toBeUndefined();
    expect(q.limits).toMatchObject({ text: 450, chat: 1500, seats: 5, videos: 0 });
  });

  it("a lower limit than the base plan gives no credit", () => {
    expect(quote({ features: ["webhooks"], limits: { ...baseLimits, text: 10 } }).computedMinor).toBe(40000);
  });

  it("each region is priced in its own currency only; a missing price is flagged and counted as 0", () => {
    const eac: AddonPriceRow[] = [{ addonKey: "websiteChat", regionKey: "EAC", currency: "USD", monthlyMinor: 900 }];
    const q = quoteOffer({ base: { ...BUSINESS, key: "PRO", name: "Pro", monthlyMinor: 4900, yearlyMinor: 49000 }, features: ["websiteChat", "autopilot"], limits: baseLimits, interval: "MONTH", currency: "USD", regionKey: "EAC", prices: [...RW, ...eac] });
    expect(q.computedMinor).toBe(4900 + 900);
    expect(q.missing).toEqual(["Autopilot"]);
    expect(q.lines.find((l) => l.key === "autopilot")).toMatchObject({ totalMinor: 0, missingPrice: true });
  });

  it("without a base plan every feature is priced, prerequisites included", () => {
    const q = quote({ base: null, features: ["autopilot"], limits: { text: 0, image: 0, chat: 0, seats: 1 } });
    expect(q.features).toEqual(["content", "designs", "calendar", "gallery", "autopilot"]);
    expect(q.computedMinor).toBe(20000);
    expect(q.missing).toEqual(["AI content", "Branded designs", "Calendar and scheduling", "Media gallery"]);
  });

  it("Managed by BuPulse is priced by tier, and Full brings Analytics", () => {
    const light = quote({ features: ["managed"], managedTier: "light" });
    expect(light.lines.map((l) => l.key)).toEqual(["plan:BUSINESS", "managed:light"]);
    const full = quote({ features: ["managed"], managedTier: "full" });
    expect(full.features).toContain("analytics");
    expect(full.computedMinor).toBe(35000 + 180000 + 5000);
  });

  it("every add-on key is unique and the catalog covers every built, priced feature", () => {
    expect(new Set(ADDONS.map((a) => a.key)).size).toBe(ADDONS.length);
    expect(ADDONS.map((a) => a.key)).toEqual(expect.arrayContaining(RW.map((r) => r.addonKey)));
    expect(ADDONS.some((a) => a.key === "voice")).toBe(true); // voiceover is built and sold as an add-on
    expect(ADDONS.some((a) => a.key === "video")).toBe(true); // slideshow videos are built
  });
});

describe("prerequisites in offers", () => {
  it("adding pulls prerequisites; unknown keys are dropped", () => {
    expect(resolveOfferFeatures(["aiPhotos", "nope"])).toEqual(["designs", "aiPhotos"]);
    // Voiceover brings Videos (and AI content) with it, and its characters.
    expect(resolveOfferFeatures(["voice"])).toEqual(["content", "video", "voice"]);
    expect(resolveOfferFeatures(["driveImport"])).toEqual(["gallery", "driveImport"]);
  });

  it("removing is blocked while a ticked feature needs it", () => {
    const selected = resolveOfferFeatures(["autopilot", "aiPhotos"]);
    expect(removalBlockedBy("designs", selected)).toEqual(["aiPhotos", "autopilot"]);
    expect(removalBlockedBy("aiPhotos", selected)).toEqual([]);
    expect(removalBlockedBy("analytics", ["calendar", "analytics", "managed"], "full")).toEqual(["managed"]);
    expect(removalBlockedBy("analytics", ["calendar", "analytics", "managed"], "light")).toEqual([]);
  });

  it("the server refuses unknown features instead of dropping them quietly", () => {
    const unknown = offerDraftSchema.parse({ features: ["teleport"], limits: baseLimits, interval: "MONTH" });
    expect(checkOfferDraft(unknown, quote())).toMatchObject({ ok: false, error: '"teleport" is not a feature.' });
  });
});

describe("the admin's price", () => {
  const draft = (over: object = {}) => offerDraftSchema.parse({ basePlanKey: "BUSINESS", features: ["websiteChat", "autopilot", "aiPhotos"], limits: baseLimits, interval: "MONTH", ...over });
  const q = quote({ features: ["websiteChat", "autopilot", "aiPhotos"] });

  it("the computed total by default; a rounded or discounted price needs a reason", () => {
    expect(checkOfferDraft(draft(), q)).toEqual({ ok: true, adjustedMinor: 73000, adjustReason: null });
    expect(checkOfferDraft(draft({ adjustedMinor: 70000 }), q)).toMatchObject({ ok: false });
    expect(checkOfferDraft(draft({ adjustedMinor: 70000, adjustReason: "Rounded" }), q)).toEqual({ ok: true, adjustedMinor: 70000, adjustReason: "Rounded" });
    expect(adjustmentText(73000, 70000)).toBe("4% off");
    expect(adjustmentText(73000, 75000)).toBe("Rounded up");
    expect(adjustmentText(73000, 73000)).toBeNull();
  });

  it("refuses an offer that is the base plan unchanged, or has no price at all", () => {
    expect(checkOfferDraft(draft({ features: [] }), quote())).toMatchObject({ ok: false, error: expect.stringMatching(/same as the base plan/) });
    const free = quote({ base: null, features: ["ownComposio"], limits: { text: 0, image: 0, chat: 0, seats: 1 } });
    expect(checkOfferDraft(draft({ basePlanKey: null, features: ["ownComposio"] }), free)).toMatchObject({ ok: false, error: expect.stringMatching(/no price yet/) });
    expect(offerDraftSchema.safeParse({ limits: baseLimits, interval: "MONTH", adjustedMinor: 0 }).success).toBe(false);
    expect(offerDraftSchema.safeParse({ limits: { ...baseLimits, seats: 0 }, interval: "MONTH" }).success).toBe(false);
  });
});

describe("statuses and expiry", () => {
  it("draft -> sent -> accepted -> paid; expired and withdrawn are final", () => {
    expect(canMoveOffer("draft", "sent")).toBe(true);
    expect(canMoveOffer("sent", "accepted")).toBe(true);
    expect(canMoveOffer("accepted", "paid")).toBe(true);
    expect(canMoveOffer("sent", "paid")).toBe(false);
    expect(canMoveOffer("draft", "accepted")).toBe(false);
    for (const final of ["paid", "expired", "withdrawn"]) expect(canMoveOffer(final, "sent")).toBe(false);
  });

  it("a sent offer expires at its date; an accepted one does not (the client may have paid)", () => {
    const at = new Date("2026-10-20T10:00:00Z");
    expect(isOfferExpired({ status: "sent", validUntil: at }, new Date("2026-10-20T09:59:59Z"))).toBe(false);
    expect(isOfferExpired({ status: "sent", validUntil: at }, at)).toBe(true);
    expect(isOfferExpired({ status: "accepted", validUntil: at }, new Date("2026-11-20T00:00:00Z"))).toBe(false);
  });

  it("the custom plan key is the same for the same offer and is a valid plan key", () => {
    expect(customPlanKeyFor("cmabc123def456")).toBe(customPlanKeyFor("cmabc123def456"));
    expect(customPlanKeyFor("cmabc123def456")).toMatch(/^[A-Za-z][A-Za-z0-9_-]{1,31}$/);
  });
});

describe("request validation", () => {
  const ok = { description: "We sell shoes in Kigali.", features: ["websiteChat"] };

  it("keeps known features, drops unknown ones, and an unknown budget or source", () => {
    const r = requestSchema.parse({ ...ok, features: ["websiteChat", "teleport", "video"], budget: "lots", source: "spam" });
    expect(r).toMatchObject({ features: ["websiteChat", "video"], budget: null, source: "billing" });
    expect(requestSchema.parse({ ...ok, budget: "50k_100k", source: "pricing" })).toMatchObject({ budget: "50k_100k", source: "pricing" });
  });

  it("needs a description of a sentence, within limits; there is no goals field any more (an old one is dropped)", () => {
    expect(requestSchema.safeParse({ ...ok, description: "shoes" }).success).toBe(false);
    expect(requestSchema.safeParse({ ...ok, description: "x".repeat(2001) }).success).toBe(false);
    const parsed = requestSchema.safeParse({ ...ok, goals: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("goals");
  });
});

describe("posts per app per day in an offer", () => {
  it("is set (1 to 10), not priced, and the custom plan carries it; the base plan's is the default", () => {
    const q = quote({ limits: { ...baseLimits, postsPerAppPerDay: 6 } });
    expect(q.limits.postsPerAppPerDay).toBe(6);
    expect(q.lines.some((l) => l.key.includes("posts"))).toBe(false);
    expect(quote({ base: { ...BUSINESS, limits: { ...BUSINESS.limits, postsPerAppPerDay: 3 } } }).limits.postsPerAppPerDay).toBe(3);
    expect(offerDraftSchema.safeParse({ limits: { text: 1, image: 1, chat: 1, seats: 1, postsPerAppPerDay: 11 }, interval: "MONTH" }).success).toBe(false);
    expect(offerDraftSchema.parse({ limits: { text: 1, image: 1, chat: 1, seats: 1 }, interval: "MONTH" }).limits.postsPerAppPerDay).toBe(1);
  });
});
