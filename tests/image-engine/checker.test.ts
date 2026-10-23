import { describe, expect, it } from "vitest";
import { judge, wordsShown } from "@/lib/image-engine/checker";
import { painterPrompt } from "@/lib/image-engine/painter-prompt";

const expected = { headline: "Bigger harvests. Happier farmers.", subline: "Grow more greens, right inside your greenhouse.", cta: "Grow with LEAF", productShown: true };

describe("the Checker", () => {
  it("passes a picture whose words are all there, across lines and with a little reading noise", () => {
    const seen = { texts: ["LEAF · GROW · NOURISH · SUSTAIN", "Bigger harvests.", "Happier farmers.", "Grow more greens, right inside your greenhouse.", "Grow with LEAF →"], productVisible: true };
    expect(judge(expected, seen)).toEqual({ ok: true, problems: [], fix: null });
    expect(wordsShown("Grow more greens, right inside your greenhouse.", ["Grow more grens, right inside your greenhouse"])).toBe(true);
  });
  it("finds a misspelt headline, a number nobody gave and a missing product, and tells the Editor what to fix", () => {
    const v = judge(expected, { texts: ["Biger harvsts. Hapier frmers.", "Grow more greens, right inside your greenhouse.", "Grow with LEAF", "50% OFF"], productVisible: false });
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual(["The headline is not written correctly.", "The picture shows numbers nobody gave: 50.", "The product cannot be seen clearly."]);
    expect(v.fix).toContain('Write the headline exactly as: "Bigger harvests. Happier farmers."');
    expect(v.fix).toContain("Keep everything else exactly the same.");
  });
  it("allows the numbers that are in the words", () => {
    expect(judge({ ...expected, headline: "Only 250,000 RWF", productShown: false }, { texts: ["Only 250,000 RWF", expected.subline, expected.cta], productVisible: false }).ok).toBe(true);
  });
});

describe("the Painter's prompt", () => {
  const base = { businessName: "LEAF", aspectRatio: "4:5" as const, concept: { prompt: "A wide shot of a commercial greenhouse.", headline: "Built for the whole farm.", subline: "", cta: "Scale your harvest" }, layout: "words in a column down the left side", colors: ["deep green"] };
  it("is the concept plus the product, the logo and the exact words, with no template", () => {
    const p = painterPrompt({ ...base, treatment: "scale", hasPhoto: true, hasLogo: true });
    expect(p).toContain("A wide shot of a commercial greenhouse.");
    expect(p).toContain("show many of exactly this product");
    expect(p).toContain("The last attached image is the business logo");
    expect(p).toContain('Headline, large and bold: "Built for the whole farm."');
    expect(p).not.toContain("Small line under it");
    expect(p).toContain('Button, a rounded pill: "Scale your harvest"');
    expect(p).toContain("Layout of the words: words in a column down the left side.");
  });
  it("describes the product from Business info when there is no photo, and lets a new product line be invented", () => {
    expect(painterPrompt({ ...base, treatment: "exact", hasPhoto: false, hasLogo: false, productText: "A vertical hydroponic tower" })).toContain("The product: A vertical hydroponic tower.");
    expect(painterPrompt({ ...base, treatment: "line", hasPhoto: true, hasLogo: false })).toContain("invent a new item of the same line");
  });
});
