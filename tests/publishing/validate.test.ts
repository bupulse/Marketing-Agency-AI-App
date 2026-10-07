import { describe, expect, it } from "vitest";
import { composeText, formatFor, scriptExplanation, validatePost, type RuleSummary } from "@/lib/publishing/validate";

const instagram: RuleSummary = { network: "instagram", label: "Instagram", maxText: 2200, maxHashtags: 30, requiresMedia: true, maxImages: 10, formats: ["POST", "CAROUSEL", "SCRIPT"], videoOnly: false };
const linkedin: RuleSummary = { network: "linkedin", label: "LinkedIn", maxText: 3000, maxHashtags: 5, requiresMedia: false, maxImages: 9, formats: ["POST", "ARTICLE", "SCRIPT"], videoOnly: false };
const tiktok: RuleSummary = { network: "tiktok", label: "TikTok", maxText: 2200, requiresMedia: true, maxImages: 1, formats: ["SCRIPT"], videoOnly: true };

describe("validatePost", () => {
  it("requires an image for Instagram", () => {
    const result = validatePost(instagram, { format: "POST", text: "Hello", hashtags: [], mediaCount: 0 });
    expect(result.errors.join(" ")).toMatch(/need a photo/);
    expect(validatePost(instagram, { format: "POST", text: "Hello", hashtags: [], mediaCount: 1 }).errors).toEqual([]);
  });

  it("counts the hashtags towards the limit and says how far over", () => {
    const text = "x".repeat(2195);
    const result = validatePost(instagram, { format: "POST", text, hashtags: ["#sale", "#new"], mediaCount: 1 });
    expect(result.length).toBe(composeText(text, ["#sale", "#new"]).length);
    expect(result.errors[0]).toMatch(/2,200 characters/);
  });

  it("limits hashtags and images", () => {
    expect(validatePost(linkedin, { format: "POST", text: "Hi", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"], mediaCount: 0 }).errors.join(" ")).toMatch(/up to 5 hashtags/);
    expect(validatePost(instagram, { format: "CAROUSEL", text: "Hi", hashtags: [], mediaCount: 11 }).errors.join(" ")).toMatch(/up to 10 photos/);
  });

  it("accepts a script reminder for video-only networks without media, explained kindly", () => {
    expect(formatFor(tiktok, 0)).toBe("SCRIPT");
    expect(validatePost(tiktok, { format: "SCRIPT", text: "0-5s: show the cake", hashtags: [], mediaCount: 0 }).errors).toEqual([]);
    expect(validatePost(tiktok, { format: "SCRIPT", text: "", hashtags: [], mediaCount: 0 }).errors[0]).toMatch(/video script/);
    expect(scriptExplanation("TikTok")).toMatch(/email you/);
  });

  it("picks carousel for several images where the network allows it", () => {
    expect(formatFor(instagram, 3)).toBe("CAROUSEL");
    expect(formatFor(instagram, 1)).toBe("POST");
    expect(formatFor({ ...linkedin, formats: ["POST", "SCRIPT"] }, 3)).toBe("POST");
  });

  it("composes text with hashtags on their own line", () => {
    expect(composeText("Hello", ["#a", "#b"])).toBe("Hello\n\n#a #b");
    expect(composeText("  ", ["#a"])).toBe("#a");
    expect(composeText("Hello", [])).toBe("Hello");
  });
});
