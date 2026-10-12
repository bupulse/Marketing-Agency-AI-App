import { describe, expect, it } from "vitest";
import { clip, INDUSTRY_CONTEXT_MAX, industryContext, type IndustryGuide } from "@/lib/industry-context";

const retail: IndustryGuide = {
  name: "Shops & retail",
  shortDescription: "Shops and boutiques selling everyday goods, fashion and gifts.",
  customers: "Families and young professionals in Kigali; month-end buyers.",
  offerings: "Kitenge fashion, shoes, bags, home goods; moto delivery in Kigali.",
  postIdeas: "New arrivals with real photos; back in stock; weekend deals.",
  tone: "Warm, friendly and concrete.",
  hashtags: ["#Kigali", "#MadeInRwanda", "#KigaliShopping"],
  seasons: "Month-end (25th to 5th); Christmas; back-to-school in September; Umuganura (first Friday of August); no promotions during Kwibuka (7 to 13 April).",
  avoid: "Never invent prices; no 'cheapest in Kigali'; single-use plastic bags are banned.",
};

describe("industryContext", () => {
  it("is empty without a sector or a description", () => {
    expect(industryContext(null)).toBe("");
    expect(industryContext({})).toBe("");
    expect(industryContext({ industry: "  ", industryDescription: "" })).toBe("");
  });

  it("puts the owner's words first, then the sector's guided fields, marked as guidance", () => {
    const text = industryContext({ industryRef: retail, industry: "Shops & retail", industryDescription: "We sell kitenge dresses and accessories to young women in Kigali." });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Industry: Shops & retail (Shops and boutiques selling everyday goods, fashion and gifts.)");
    expect(lines[1]).toBe("About this business, in the owner's words: We sell kitenge dresses and accessories to young women in Kigali.");
    expect(text).toContain("Sector guidance (general knowledge about this kind of business, not facts about this one");
    for (const t of ["- Typical customers: Families", "- Typical products and services: Kitenge", "- Post ideas that work: New arrivals", "- Tone: Warm", "- Hashtags that fit: #Kigali #MadeInRwanda #KigaliShopping", "- Dates and seasons in Rwanda and East Africa: Month-end", "Kwibuka", "- Avoid (words, claims, compliance): Never invent prices"]) {
      expect(text).toContain(t);
    }
  });

  it("uses the owner's own industry text and description for Other", () => {
    const text = industryContext({ industry: "Car wash", industryOther: "Car wash", industryDescription: "We wash and detail cars in Remera, with pick-up in Kigali." });
    expect(text).toBe("Industry (in the owner's words): Car wash\nAbout this business, in the owner's words: We wash and detail cars in Remera, with pick-up in Kigali.");
    expect(text).not.toContain("Sector guidance");
  });

  it("falls back to the onboarding description for companies from before the sign-up field", () => {
    expect(industryContext({ industry: "Bakery", description: "Fresh bread every morning in Kimironko." })).toContain("About this business, in the owner's words: Fresh bread every morning in Kimironko.");
    expect(industryContext({ industryRef: retail, industryDescription: "Sign-up text", description: "Onboarding text" })).toContain("owner's words: Sign-up text");
  });

  it("stays within the budget: each field is clipped and the block never exceeds the maximum", () => {
    const long = "x".repeat(2000);
    const guide: IndustryGuide = { ...retail, customers: `${"word ".repeat(400)}end`, offerings: long, postIdeas: long, seasons: long, avoid: `${"Never promise results. ".repeat(50)}END` };
    const text = industryContext({ industryRef: guide, industryDescription: `${"We sell many things. ".repeat(80)}END` });
    expect(text.length).toBeLessThanOrEqual(INDUSTRY_CONTEXT_MAX);
    expect(text).toContain("Industry: Shops & retail");
    expect(text).toContain("About this business");
    // The compliance line survives before the longer idea lists.
    expect(text).toContain("- Avoid (words, claims, compliance): Never promise results.");
    expect(industryContext({ industryRef: guide, industryDescription: long }, { maxChars: 300 }).length).toBeLessThanOrEqual(300);
  });

  it("clip cuts at a word and marks the cut", () => {
    expect(clip("short text", 50)).toBe("short text");
    expect(clip("one two three four five six", 14)).toBe("one two three…");
    expect(clip("  spaced   out   words  ", 100)).toBe("spaced out words");
  });
});
