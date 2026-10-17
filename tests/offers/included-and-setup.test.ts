import { describe, expect, it } from "vitest";
import { featuresNotSetUp } from "@/lib/features";
import { notSetUpFeatures, serviceSetUp } from "@/lib/feature-setup";
import {
  comingSoonAddons,
  notSetUpProblem,
  offerIncluded,
  quoteAddition,
  quoteOffer,
  selfServeFeatures,
  withIncludedLimits,
  type AddonPriceRow,
  type OfferBase,
} from "@/lib/offers/shared";

// A feature that brings units (website chat: 500 chat replies, AI photos: 30 images) never ends up with fewer in an
// offer (a chat limit of 0 refuses every reply), and a feature none of whose services is set up is not sold.

const RW: AddonPriceRow[] = [
  ["block:text", 3000], ["block:image", 5000], ["block:chat", 3000], ["seat", 3000], ["aiPhotos", 8000], ["websiteChat", 10000], ["autopilot", 20000], ["analytics", 5000],
  ["canva", 5000], ["storeImport", 10000], ["driveImport", 3000], ["webhooks", 5000], ["apiAccess", 15000],
].map(([addonKey, monthlyMinor]) => ({ addonKey: String(addonKey), regionKey: "RW", currency: "RWF", monthlyMinor: Number(monthlyMinor) }));
const BUSINESS: OfferBase = { key: "BUSINESS", name: "Business", monthlyMinor: 35000, yearlyMinor: 350000, features: ["content", "designs", "calendar", "gallery"], limits: { text: 200, image: 100, chat: 0, videos: 0, voiceCharacters: 0, videoCredits: 0, seats: 3 } };
const quote = (over: Partial<Parameters<typeof quoteOffer>[0]> = {}) => quoteOffer({ base: BUSINESS, features: [], limits: { text: 200, image: 100, chat: 0, seats: 3 }, interval: "MONTH", currency: "RWF", regionKey: "RW", prices: RW, ...over });

describe("included amounts", () => {
  it("what the base plan and the added features include: website chat brings 500 replies, AI photos 30 images", () => {
    expect(offerIncluded(BUSINESS, ["websiteChat", "aiPhotos"])).toEqual({ text: 200, image: 130, chat: 500, videoCredits: 0, seats: 3, postsPerAppPerDay: 1 });
    expect(offerIncluded(null, ["websiteChat"])).toMatchObject({ chat: 500, image: 0, seats: 1 });
    // A feature already in the base plan adds nothing on top of it.
    expect(offerIncluded({ ...BUSINESS, features: [...BUSINESS.features, "websiteChat"], limits: { ...BUSINESS.limits, chat: 800 } }, ["websiteChat"]).chat).toBe(800);
  });

  it("an offer with website chat and 0 chat replies keeps the 500 included (the LEAF bug), at no extra price", () => {
    const q = quote({ features: ["websiteChat"] });
    expect(q.limits.chat).toBe(500);
    expect(q.lines.map((l) => l.key)).toEqual(["plan:BUSINESS", "websiteChat"]);
    expect(q.computedMinor).toBe(45000);
  });

  it("the same for AI photos, users and every other limit: never below what is included", () => {
    const q = quote({ base: null, features: ["aiPhotos"], limits: { text: 0, image: 0, chat: 0, seats: 0 } });
    expect(q.limits).toMatchObject({ image: 30, seats: 1, chat: 0 });
    expect(quote({ limits: { text: 10, image: 5, chat: 0, seats: 1 } }).limits).toMatchObject({ text: 200, image: 100, seats: 3 });
  });

  it("more than included is still priced in blocks", () => {
    const q = quote({ features: ["websiteChat"], limits: { text: 200, image: 100, chat: 1500, seats: 3 } });
    expect(q.limits.chat).toBe(1500);
    expect(q.lines.find((l) => l.key === "block:chat")).toMatchObject({ quantity: 1 });
  });

  it("features added to a running plan bring their units too", () => {
    const add = quoteAddition({ current: { key: "BUSINESS", name: "Business", priceMinor: 35000, features: BUSINESS.features, limits: BUSINESS.limits }, features: ["websiteChat"], interval: "MONTH", currency: "RWF", regionKey: "RW", prices: RW, periodEnd: new Date("2026-11-01T00:00:00Z"), now: new Date("2026-10-15T00:00:00Z") });
    expect(add.limits.chat).toBe(500);
  });

  it("a plan made from an older offer (0 chat replies) gets the included amount back; other limits stay", () => {
    const stored = { text: 200, image: 100, chat: 0, videos: 0, voiceCharacters: 0, videoCredits: 0, seats: 3 };
    expect(withIncludedLimits(stored, ["content", "websiteChat", "aiPhotos"])).toEqual({ ...stored, chat: 500 });
    expect(withIncludedLimits({ ...stored, chat: 2000 }, ["websiteChat"]).chat).toBe(2000);
    expect(withIncludedLimits(stored, ["content"])).toEqual(stored);
    expect(withIncludedLimits({ ...stored, image: 10 }, ["aiPhotos"]).image).toBe(30);
  });
});

describe("features that are not set up are not sold", () => {
  const none = {};
  const all = { GOOGLE_PICKER_API_KEY: "k", GOOGLE_PICKER_APP_ID: "1", GOOGLE_CLIENT_ID: "c", DROPBOX_APP_KEY: "d", SHOPIFY_API_KEY: "s", SHOPIFY_API_SECRET: "t", CANVA_CLIENT_ID: "c", CANVA_CLIENT_SECRET: "s", ELEVENLABS_API_KEY: "e" };

  it("Drive and Dropbox import needs a Google Picker key (with an OAuth client) or a Dropbox app key", () => {
    expect(notSetUpFeatures(none)).toContain("driveImport");
    expect(notSetUpFeatures({ GOOGLE_PICKER_API_KEY: "k", GOOGLE_PICKER_APP_ID: "1" })).toContain("driveImport"); // no OAuth client
    expect(notSetUpFeatures({ GOOGLE_PICKER_API_KEY: "k", GOOGLE_PICKER_APP_ID: "1", GOOGLE_YOUTUBE_CLIENT_ID: "y" })).not.toContain("driveImport");
    expect(notSetUpFeatures({ DROPBOX_APP_KEY: "d" })).not.toContain("driveImport");
  });

  it("store import works without Shopify keys (WooCommerce takes each client's own keys); the AI never blocks a sale", () => {
    expect(serviceSetUp("woocommerce", none)).toBe(true);
    expect(serviceSetUp("shopify", none)).toBe(false);
    expect(notSetUpFeatures(none)).not.toContain("storeImport");
    expect(serviceSetUp("gemini", none)).toBe(true); // core: missing keys are a Health problem, not "coming soon"
    for (const key of ["content", "aiPhotos", "autopilot", "websiteChat", "storeImport", "video"] as const) expect(notSetUpFeatures(none)).not.toContain(key);
    expect(notSetUpFeatures(all)).toEqual([]);
  });

  it("a feature with no outside service is always set up; one with any service set up is too", () => {
    expect(featuresNotSetUp(() => false)).toEqual(expect.arrayContaining(["driveImport", "storeImport", "canva", "content"]));
    expect(featuresNotSetUp(() => false)).not.toContain("websiteChat");
    expect(featuresNotSetUp((id) => id === "dropbox")).not.toContain("driveImport");
  });

  it("Billing's Add features leaves them out (and what needs them), lists them as coming soon", () => {
    const owned = BUSINESS.features;
    expect(selfServeFeatures(owned, RW, "RW", "RWF")).toContain("driveImport");
    const addable = selfServeFeatures(owned, RW, "RW", "RWF", ["driveImport"]);
    expect(addable).not.toContain("driveImport");
    expect(addable).toContain("storeImport");
    expect(comingSoonAddons(owned, ["driveImport"])).toEqual(["driveImport"]);
    expect(comingSoonAddons([...owned, "driveImport"], ["driveImport"])).toEqual([]);
  });

  it("an offer may not add one, but may keep one its base plan already has", () => {
    expect(notSetUpProblem(["websiteChat", "driveImport"], ["driveImport"])).toMatch(/Drive and Dropbox import is coming soon/);
    expect(notSetUpProblem(["websiteChat"], ["driveImport"])).toBeNull();
  });
});
