import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/designs/templates/registry";
import { getProvider } from "@/lib/social/registry";
import { NETWORKS } from "@/lib/social/types";
import { IDEAS, ideaNetworks, industryTags, suitsIndustry } from "@/lib/autopilot/playbook";

describe("playbook", () => {
  it("has 25 to 40 ideas with unique ids", () => {
    expect(IDEAS.length).toBeGreaterThanOrEqual(25);
    expect(IDEAS.length).toBeLessThanOrEqual(40);
    expect(new Set(IDEAS.map((i) => i.id)).size).toBe(IDEAS.length);
  });

  it("has ideas for every network", () => {
    for (const network of NETWORKS) {
      expect(IDEAS.filter((i) => ideaNetworks(i).includes(network)).length, network).toBeGreaterThanOrEqual(5);
    }
  });

  it("gives each idea guidance and a real template or none", () => {
    const templates = new Set(TEMPLATES.map((t) => t.id));
    for (const idea of IDEAS) {
      expect(idea.guidance.length, idea.id).toBeGreaterThan(40);
      if (idea.template) expect(templates.has(idea.template), idea.id).toBe(true);
      expect(Object.keys(idea.formats).length, idea.id).toBeGreaterThan(0);
    }
  });

  it("uses only formats the networks accept in Stage 1", () => {
    for (const idea of IDEAS) {
      for (const [network, format] of Object.entries(idea.formats)) {
        const rules = getProvider(network as never).rules;
        expect(rules.formats, `${idea.id} on ${network}`).toContain(format);
        // Video-only networks get scripts, never posts.
        if (rules.videoOnly) expect(format, `${idea.id} on ${network}`).toBe("SCRIPT");
      }
    }
  });

  it("puts long-form ARTICLE on LinkedIn only", () => {
    const articles = IDEAS.filter((i) => Object.values(i.formats).includes("ARTICLE"));
    expect(articles.length).toBeGreaterThanOrEqual(2);
    for (const idea of articles) expect(Object.keys(idea.formats)).toEqual(["linkedin"]);
  });

  it("never asks the writer to invent customer quotes", () => {
    const story = IDEAS.find((i) => i.id === "customer-story")!;
    expect(story.guidance).toMatch(/NEVER invent a quote/);
  });

  it("covers all four goals", () => {
    expect(new Set(IDEAS.map((i) => i.goal))).toEqual(new Set(["awareness", "engagement", "sales", "trust"]));
  });

  it("maps industries to soft tags and keeps universal ideas for everyone", () => {
    expect(industryTags("Restaurants & cafés")).toContain("food");
    expect(industryTags("Salons & beauty")).toContain("beauty");
    expect(industryTags("Construction")).toContain("construction");
    expect(industryTags("Something unusual")).toEqual([]);
    const universal = IDEAS.filter((i) => suitsIndustry(i, []));
    expect(universal.length).toBeGreaterThanOrEqual(20);
  });
});
