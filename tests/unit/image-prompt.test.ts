import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "@/lib/designs/prompt";

const business = {
  name: "Glow Studio",
  industry: "Beauty & wellness",
  audience: "Brides aged 25 to 40",
  country: "Spain",
  tone: "luxury",
  knowledge: { area: "Madrid centro", faqs: [] },
  brandColors: ["#C2185B", "#zzzzzz"],
};

describe("buildImagePrompt", () => {
  it("adds realistic local customers from the business info by default", () => {
    const prompt = buildImagePrompt({ business, prompt: "A bride getting her hair styled", aspectRatio: "1:1" });
    expect(prompt).toMatch(/People: include one to three realistic people/);
    expect(prompt).toContain("Brides aged 25 to 40");
    expect(prompt).toContain("local people in Madrid centro, Spain");
    expect(prompt).toMatch(/Mood: luxury/);
    expect(prompt).toContain("brand colours (pink)");
    expect(prompt).not.toMatch(/#[0-9a-z]{6}/i);
  });

  it("leaves people out when switched off or when the description asks for none", () => {
    expect(buildImagePrompt({ business, prompt: "A bottle of shampoo", aspectRatio: "1:1", includePeople: false })).not.toMatch(/People:/);
    expect(buildImagePrompt({ business, prompt: "Shampoo bottle, no people, white background", aspectRatio: "1:1" })).not.toMatch(/People:/);
    expect(buildImagePrompt({ business, prompt: "Product-only shot of our serum", aspectRatio: "1:1" })).not.toMatch(/People:/);
  });

  it("keeps an attached product photo as the focus", () => {
    const prompt = buildImagePrompt({ business, prompt: "Our serum in use", aspectRatio: "4:5", hasPhoto: true });
    expect(prompt).toMatch(/people interact with it/);
  });

  it("works with only a name", () => {
    const prompt = buildImagePrompt({ business: { name: "Shop" }, prompt: "Shelves of goods", aspectRatio: "16:9" });
    expect(prompt).toMatch(/typical customers or staff, naturally/);
    expect(prompt).not.toMatch(/Mood:/);
  });
});

describe("colorName", () => {
  it("names colours in words", async () => {
    const { colorName } = await import("@/lib/designs/prompt");
    expect(["#1D4ED3", "#E85D2C", "#F2A516", "#2E7D32", "#111111", "#FFFFFF", "#6D4C41", "#BBDEFB"].map(colorName)).toEqual([
      "blue", "orange", "orange", "green", "black", "white", "brown", "light blue",
    ]);
  });
});

describe("readKnowledge", () => {
  it("keeps stored knowledge that lacks empty fields", async () => {
    const { readKnowledge } = await import("@/lib/brand/schemas");
    expect(readKnowledge({ faqs: [], hours: "9am to 6pm" })).toMatchObject({ hours: "9am to 6pm", faqs: [] });
    expect(readKnowledge({ area: "Kigali" })).toMatchObject({ area: "Kigali", faqs: [] });
    expect(readKnowledge("nonsense")).toMatchObject({ faqs: [] });
  });
});
