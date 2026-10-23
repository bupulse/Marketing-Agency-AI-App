import { describe, expect, it } from "vitest";
import { chooseTiers, creditsOf, directBatch, patternsFromBrief, type RecentConcept } from "@/lib/image-engine/director";
import { PATTERNS } from "@/lib/image-engine/patterns";

const facts = { reviews: false, price: true };

describe("the Director: Pro or Lite within the credits", () => {
  it("auto makes the first picture Pro, then one in four, while the credits allow (Lite 2, Pro 4)", () => {
    expect(chooseTiers(4, 100, "auto")).toEqual(["pro", "lite", "lite", "lite"]);
    expect(chooseTiers(10, 100, "auto")).toEqual(["pro", "pro", "pro", "lite", "lite", "lite", "lite", "lite", "lite", "lite"]);
    expect(creditsOf(chooseTiers(4, 100, "auto"))).toBe(10);
  });
  it("never spends more than the budget: fewer Pro pictures, then fewer pictures", () => {
    expect(chooseTiers(4, 9, "pro")).toEqual(["lite", "lite", "lite", "lite"]);
    expect(chooseTiers(4, 10, "pro")).toEqual(["pro", "lite", "lite", "lite"]);
    expect(chooseTiers(4, 16, "pro")).toEqual(["pro", "pro", "pro", "pro"]);
    expect(chooseTiers(4, 5, "auto")).toEqual(["lite", "lite"]);
    expect(chooseTiers(4, 1, "auto")).toEqual([]);
    expect(chooseTiers(4, 100, "lite")).toEqual(["lite", "lite", "lite", "lite"]);
    for (const q of ["auto", "pro", "lite"] as const) for (let b = 0; b < 30; b++) expect(creditsOf(chooseTiers(5, b, q))).toBeLessThanOrEqual(b);
  });
});

describe("the Director: every picture a different idea", () => {
  it("gives a batch different patterns, shots, lights and layouts, and rotates the photos", () => {
    const slots = directBatch({ tiers: chooseTiers(6, 100, "auto"), recent: [], photoCount: 2, facts, seed: "s1" });
    expect(new Set(slots.map((s) => s.pattern)).size).toBe(6);
    expect(new Set(slots.map((s) => s.shot)).size).toBe(6);
    expect(new Set(slots.map((s) => s.layout)).size).toBe(6);
    expect(new Set(slots.map((s) => s.photoIndex))).toEqual(new Set([0, 1]));
  });
  it("avoids what the company had lately", () => {
    const first = directBatch({ tiers: chooseTiers(4, 100, "lite"), recent: [], photoCount: 1, facts, seed: "a" });
    const recent: RecentConcept[] = first.map(({ pattern, shot, light, layout }) => ({ pattern, shot, light, layout }));
    const second = directBatch({ tiers: chooseTiers(4, 100, "lite"), recent, photoCount: 1, facts, seed: "b" });
    for (const s of second) expect(first.map((f) => f.pattern)).not.toContain(s.pattern);
  });
  it("leaves out patterns that need facts the business lacks, and puts the brief's patterns first", () => {
    const all = directBatch({ tiers: Array(PATTERNS.length).fill("lite"), recent: [], photoCount: 0, facts: { reviews: false, price: false }, seed: "x" });
    expect(all.map((s) => s.pattern)).not.toContain("testimonial");
    expect(all.map((s) => s.pattern)).not.toContain("offer");
    expect(all.every((s) => s.photoIndex === null)).toBe(true);
    const brief = "show a happy farmer, generate different products with the same concept that work on a large scale";
    expect(patternsFromBrief(brief)).toEqual(["at-scale", "product-line", "outcome"]);
    const slots = directBatch({ tiers: ["pro", "lite", "lite", "lite"], recent: [], photoCount: 1, facts, seed: "y", prefer: patternsFromBrief(brief) });
    expect(slots.slice(0, 3).map((s) => s.pattern)).toEqual(["at-scale", "product-line", "outcome"]);
    expect(slots[1].treatment).toBe("line");
  });
});
