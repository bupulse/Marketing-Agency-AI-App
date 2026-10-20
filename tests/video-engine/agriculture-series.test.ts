import { describe, expect, it } from "vitest";
import { BRAIN } from "@/lib/video-engine/brain";
import { brainContext, brainFor, sectorFromText } from "@/lib/video-engine/brain/select";
import { planSeries } from "@/lib/video-engine/brain/series";
import { briefFacts, landmarkOf, suggestHooks, type SuggestBrief } from "@/lib/video-engine/brain/suggest";
import { briefText, type DesignBrief } from "@/lib/video-engine/designer";

// The end-to-end test of 19 October 2026 (LEAF Hydro Tower, a hydroponic tower sold by a Rwandan agriculture company)
// found four flaws: the sector read as restaurant, a week of 2 posts, the product name used as a place, and a pill in
// a pill. These are the facts of that run.
const leaf: SuggestBrief & { photos?: never } = {
  business: { name: "LEAF Business GROUP LTD", description: "LEAF aims to transform agriculture in Rwanda through hydroponic and smart farming solutions. By enabling communities to grow healthy food in limited spaces throughout the year, we seek to increase food production, improve food security and promote sustainable agriculture.", language: "English", phone: "+250791954277", country: "Rwanda" },
  product: {
    name: "LEAF Hydro Tower – Vertical Hydroponic Growing System",
    summary: "Grow fresh, healthy vegetables in limited spaces with the LEAF Hydro Tower, a vertical hydroponic system designed for homes, schools, restaurants, and urban farms. It grows plants without soil using nutrient-enriched water.",
    description: "The LEAF Hydro Tower is an innovative vertical hydroponic growing system. Suitable for lettuce, spinach, kale, basil and other leafy vegetables, in home gardens, greenhouses, school projects, restaurants and small farms.",
    price: "From 250,000 RWF",
    usps: ["LEAF Hydro Tower offers a space-saving way to grow fresh vegetables,", "Reduce reliance on seasonal produce supplies", "Explore sustainable farming", "It is designed for customers who want to produce food at home or start a small urban farming business."],
    features: ["Vertical, space-saving growing design", "Soil-free cultivation using nutrient-rich water", "Recirculating water system", "Suitable for leafy vegetables, herbs, and selected crops", "Designed for homes, schools, restaurants, and small farms", "Optional smart monitoring and control", "Expandable to suit different growing needs", "Installation and user training available"],
  },
};
const text = (b: SuggestBrief) => [b.business.name, b.business.description, b.product.name, b.product.summary].join(" ");

describe("the agriculture sector", () => {
  it("is found for LEAF, ahead of a passing mention of restaurants", () => {
    expect(sectorFromText(text(leaf))).toBe("agriculture");
    expect(sectorFromText("Hydroponic farm in Kigali, fresh vegetables for restaurants and homes")).toBe("agriculture");
    expect(sectorFromText("Poultry feed and layers' vitamins, delivery to farms")).toBe("agriculture");
    expect(sectorFromText("Irrigation pumps and drip kits for farmers")).toBe("agriculture");
    expect(sectorFromText("Seeds and seedlings, maize and beans")).toBe("agriculture");
  });

  it("does not take food businesses", () => {
    expect(sectorFromText("Kigali restaurant, lunch buffet, pilau and brochette")).toBe("restaurant");
    expect(sectorFromText("Bakery: cakes and coffee, food delivery")).toBe("restaurant");
  });

  it("is marked weak, calm or upbeat, and the context says its evidence is early", () => {
    const s = BRAIN.sectors.find((x) => x.id === "agriculture")!;
    expect(s.weak).toBe(true);
    expect(s.evidence).toEqual([]);
    expect(s.music?.moods).toEqual(["calm", "upbeat"]);
    expect(s.formats).toEqual(expect.arrayContaining(["product-reveal", "tutorial", "list"]));
    const pick = brainFor({ platform: "tiktok", sector: "agriculture", format: null, engine: "claude", language: "English", hasPrice: true, hasPhone: true, seconds: 15 });
    expect(pick.hooks.length).toBe(3);
    expect(brainContext({ platform: "tiktok", sector: "agriculture", format: null, engine: "claude", language: "English", hasPrice: true, hasPhone: true, seconds: 15 })).toMatch(/Early evidence: BuPulse has no research for this sector yet/);
    expect(brainContext({ platform: "tiktok", sector: "shop", format: null, engine: "claude", language: "English", hasPrice: true, hasPhone: true, seconds: 15 })).not.toMatch(/no research for this sector/);
  });
});

describe("a week of videos", () => {
  it("fills 7 distinct posts for LEAF", () => {
    const week = planSeries(leaf, { platform: "any", count: 7 });
    expect(week).toHaveLength(7);
    expect(new Set(week.map((p) => p.hookId)).size).toBe(7);
    expect(new Set(week.map((p) => p.templateId)).size).toBe(7);
    expect(week[0].line).toBe("LEAF Hydro Tower · from 250,000 RWF");
    expect(week[0].musicMood).toMatch(/calm|upbeat/);
  });

  it("falls back to other formats instead of stopping when the sector's own formats run out", () => {
    // The old reading (restaurant: offer and UGC formats, no offer in the brief) gave 2 posts.
    const week = planSeries(leaf, { platform: "any", count: 7, sector: "restaurant" });
    expect(week.length).toBeGreaterThanOrEqual(5);
    expect(new Set(week.map((p) => p.templateId)).size).toBe(week.length);
  });

  it("never offers the product name as a place, and keeps the number", () => {
    const week = planSeries(leaf, { platform: "any", count: 7 });
    for (const p of week) {
      expect(p.note).not.toMatch(/the place/i);
      expect(p.note).toContain("0791 954 277");
    }
    expect(briefFacts(leaf).landmark).toBeNull();
  });

  it("still gives a real place when the brief has one", () => {
    const shop: SuggestBrief = { ...leaf, business: { ...leaf.business, description: `${leaf.business.description} Visit us at Makuza Peace Plaza, Room 35, Kigali.` } };
    expect(briefFacts(shop).landmark).toBe("Makuza Peace Plaza, Room 35");
    expect(planSeries(shop, { platform: "any", count: 3 })[0].note).toMatch(/the place \(Makuza Peace Plaza, Room 35, Kigali\)/);
    // A business that is named after a building is a name, not a place.
    expect(landmarkOf("Welcome to T2000 House Phones", ["T2000 House Phones"])).toBeNull();
    expect(landmarkOf("Find us in T2000 House", ["Nova Phones"])).toBe("T2000 House");
  });

  it("suggests hooks that stay true for LEAF", () => {
    expect(suggestHooks(leaf, { platform: "tiktok" })[0].line).toBe("LEAF Hydro Tower · from 250,000 RWF");
  });
});

describe("the designer brief with no place", () => {
  const brief = (over: Partial<DesignBrief["business"]> = {}, purpose: DesignBrief["purpose"] = "ad"): DesignBrief => ({ business: { ...leaf.business, ...over }, product: leaf.product, photos: [], styleId: "kigali-price-first", hookId: "price-banner", ratio: "9:16", seconds: 15, purpose });
  it("tells Claude to leave the place line out when the brief has none", () => {
    expect(briefText(brief())).toMatch(/Place: none given[^\n]*Never use the product's or the business's name as a place/);
  });
  it("says nothing of it when the brief names a place", () => {
    expect(briefText(brief({ description: "We are in Kimironko, Kigali, on KK 15 Road." }))).not.toMatch(/Place: none given/);
  });
});
