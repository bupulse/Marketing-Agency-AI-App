import { describe, expect, it } from "vitest";
import { ANGLES, ANGLE_IDS, chooseAngles, eligibleAngles, formatFor, spreadNetworks, type AngleFacts } from "@/lib/studio/angles";
import { diversifyPack, fallbackPlan } from "@/lib/visuals/direction";

const facts = (over: Partial<AngleFacts> = {}): AngleFacts => ({ subjectType: "product", hasPrice: true, isNew: false, hasCompetitors: false, hasFaqs: false, moment: null, ...over });

describe("angles", () => {
  it("skips angles whose facts are missing: no price, nothing new, no competitors, no local moment", () => {
    expect(eligibleAngles(facts({ hasPrice: false }))).not.toContain("price");
    expect(eligibleAngles(facts())).not.toContain("news");
    expect(eligibleAngles(facts())).not.toContain("why-us");
    expect(eligibleAngles(facts())).not.toContain("seasonal");
    expect(eligibleAngles(facts({ isNew: true, hasCompetitors: true, moment: "Umuganura (2026-08-07)" }))).toEqual([...ANGLE_IDS]);
    // Every angle has a people scene for its picture.
    expect(ANGLE_IDS.every((id) => ANGLES[id].people.length > 10)).toBe(true);
  });

  it("a new subject starts with the angles that sell its kind best; picks are distinct", () => {
    expect(chooseAngles(facts(), [], 5)).toEqual(["features", "price", "story", "tips", "how-it-works"]);
    expect(chooseAngles(facts({ subjectType: "service" }), [], 3)).toEqual(["how-it-works", "story", "price"]);
    expect(chooseAngles(facts({ subjectType: "event", isNew: true }), [], 2)).toEqual(["news", "cta"]);
    expect(new Set(chooseAngles(facts(), [], 7)).size).toBe(7);
  });

  it("rotates: angles never used first, then the least recently used, so an angle does not repeat until the others had their turn", () => {
    const first = chooseAngles(facts(), [], 5);
    const second = chooseAngles(facts(), [...first].reverse(), 5);
    // The 8 eligible angles: the 3 not used yet come first, then the oldest of the first pack.
    expect(second.slice(0, 3).sort()).toEqual(["behind-scenes", "cta", "faq"].sort());
    expect(second.slice(3)).toEqual([first[0], first[1]]);
    expect(second.filter((a) => first.includes(a))).toEqual([first[0], first[1]]);
  });

  it("spreads a pack over the apps: every app once before any gets a second, the angle's favourite app first", () => {
    const slots = spreadNetworks(["features", "how-it-works", "news", "tips", "price"], ["instagram", "facebook", "tiktok", "linkedin"]);
    const count = (n: string) => slots.filter((s) => s.network === n).length;
    expect(["instagram", "facebook", "tiktok", "linkedin"].map(count).sort()).toEqual([1, 1, 1, 2]);
    expect(slots.find((s) => s.angle === "how-it-works")).toMatchObject({ network: "tiktok", format: "video" });
    expect(slots.find((s) => s.angle === "features")).toMatchObject({ network: "instagram", format: "carousel" });
    expect(slots.find((s) => s.angle === "news")).toMatchObject({ network: "facebook", format: "image" });
  });

  it("formats follow the app: video on TikTok and YouTube, carousels for list angles, images otherwise; default apps when none is connected", () => {
    expect(formatFor("story", "youtube")).toBe("video");
    expect(formatFor("tips", "linkedin")).toBe("carousel");
    expect(formatFor("price", "instagram")).toBe("image");
    expect(spreadNetworks(["price", "story", "tips", "cta"], []).map((s) => s.network).sort()).toEqual(["facebook", "instagram", "linkedin", "tiktok"]);
  });
});

describe("visually different posts in a pack", () => {
  const plan = (template: "new-arrival" | "offer" | "announcement", source: "ai" | "text" = "ai") =>
    fallbackPlan({ subjectType: "product", title: "Phone", caption: "Hi", headlines: ["Phone"], business: { name: "B" }, photos: [], carouselAllowed: false, aiAllowed: source === "ai" });

  it("no two covers share a template while others are free; text covers never get a photo template", () => {
    const plans = [plan("new-arrival"), plan("new-arrival"), plan("new-arrival"), plan("new-arrival", "text"), plan("new-arrival", "text")];
    const out = diversifyPack(plans, "product");
    const templates = out.map((p) => p.slides[0].template);
    expect(new Set(templates).size).toBe(templates.length);
    expect(templates.slice(3).every((t) => !["new-arrival", "just-listed", "project-done"].includes(t))).toBe(true);
    expect(templates).not.toContain("quote");
  });
});
