import { describe, expect, it } from "vitest";
import { buildVariants, normalizeHashtags, truncateSmart, variantText } from "@/lib/studio/variants";

const tags = Array.from({ length: 15 }, (_, i) => `tag${i + 1}`);
const source = { caption: "Fresh sourdough every morning. Come and taste it! 🍞", hashtags: tags, videoScript: "0-5s: oven" };
const by = (network: string) => buildVariants(source).find((v) => v.network === network)!;

describe("buildVariants", () => {
  it("returns all five networks with their aspect ratios", () => {
    const ratios = Object.fromEntries(buildVariants(source).map((v) => [v.network, v.aspectRatio]));
    expect(ratios).toEqual({ instagram: "4:5", facebook: "1:1", tiktok: "9:16", linkedin: "1:1", x: "16:9" });
  });

  it("limits hashtags per network", () => {
    expect(by("instagram").hashtags).toHaveLength(15);
    expect(by("facebook").hashtags).toHaveLength(3);
    expect(by("tiktok").hashtags).toHaveLength(5);
    expect(by("linkedin").hashtags).toHaveLength(3);
    expect(by("x").hashtags).toHaveLength(2);
    expect(by("x").hashtags[0]).toBe("#tag1");
  });

  it("keeps X within 280 characters including hashtags", () => {
    const long = { ...source, caption: "Sentence number one is here. ".repeat(30) };
    const x = buildVariants(long).find((v) => v.network === "x")!;
    expect(x.characterCount).toBeLessThanOrEqual(280);
    expect(variantText(x).length).toBe(x.characterCount);
    expect(x.caption.endsWith("…")).toBe(true);
  });

  it("keeps Instagram and TikTok within 2,200 characters including hashtags", () => {
    const long = { ...source, caption: "word ".repeat(1000) };
    for (const v of buildVariants(long).filter((v) => v.network === "instagram" || v.network === "tiktok")) {
      expect(v.characterCount).toBeLessThanOrEqual(2200);
      expect(variantText(v).length).toBe(v.characterCount);
    }
  });

  it("removes emojis for LinkedIn only and gives TikTok the video script", () => {
    expect(by("linkedin").caption).not.toContain("🍞");
    expect(by("instagram").caption).toContain("🍞");
    expect(by("tiktok").videoScript).toBe("0-5s: oven");
    expect(by("instagram").videoScript).toBeUndefined();
  });

  it("leaves short captions untouched", () => {
    expect(by("x").caption).toBe(source.caption);
    expect(by("x").limit).toBe(280);
  });
});

describe("truncateSmart", () => {
  it("cuts at a sentence end when there is one late enough", () => {
    expect(truncateSmart("First sentence is here. Second sentence goes on and on", 40)).toBe("First sentence is here.…");
  });
  it("otherwise cuts at a word", () => {
    expect(truncateSmart("alpha beta gamma delta epsilon", 20)).toBe("alpha beta gamma…");
  });
  it("returns short text as is", () => {
    expect(truncateSmart("short", 20)).toBe("short");
  });
});

describe("normalizeHashtags", () => {
  it("adds #, trims, and removes duplicates", () => {
    expect(normalizeHashtags(["a", "#A", " # b ", "", "c d"])).toEqual(["#a", "#b", "#cd"]);
  });
});
