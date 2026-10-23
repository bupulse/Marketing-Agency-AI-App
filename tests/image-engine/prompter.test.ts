import { describe, expect, it } from "vitest";
import { chooseTiers, directBatch } from "@/lib/image-engine/director";
import { plannerPrompt, readConcepts, ruleConcept, type PlannerInput } from "@/lib/image-engine/prompter";

const slots = directBatch({ tiers: chooseTiers(3, 50, "auto"), recent: [], photoCount: 1, facts: { reviews: false, price: true }, seed: "t", prefer: ["at-scale", "product-line", "outcome"] });
const input: PlannerInput = {
  business: { name: "LEAF", industry: "Agriculture", description: "Vertical hydroponic towers for homes and farms", audience: "Urban families and farmers", place: "Kigali, Rwanda", language: "English", voice: "Warm", colors: ["deep green"] },
  subject: { name: "LEAF Hydro Tower", description: "Grows 30 plants in one square metre", price: "250,000 RWF", sellingPoints: ["Uses 90% less water"] },
  brief: "Show a happy farmer in a greenhouse; different products at large scale",
  reviews: [],
  slots,
  recent: ["Family balcony harvest at sunset"],
};
const longPrompt = "A wide establishing advertising photograph inside a commercial greenhouse in Rwanda with rows of tall cream vertical towers full of lettuce and kale, three workers harvesting into crates, soft morning daylight through the glass roof, calm space at the top for the words, deep green accents in aprons and crates, realistic and warm.";

describe("the Prompter's request", () => {
  it("fences the facts, carries the brief, the slots and what not to repeat", () => {
    const p = plannerPrompt(input);
    expect(p).toContain("<<<DATA");
    expect(p).toContain("OWNER'S BRIEF");
    expect(p).toContain("SLOT 0: pattern \"At scale\"");
    expect(p).toContain("product treatment: line");
    expect(p).toContain("Family balcony harvest at sunset");
    expect(p).toContain("Write the words in: English.");
  });
});

describe("reading the Prompter's answer", () => {
  it("keeps good concepts, by slot number, and takes quotes out of the image prompt", () => {
    const out = readConcepts({ concepts: [{ slot: 1, title: "Grow Walls", scene: "s", headline: "Every row, a harvest wall", subline: "Grows 30 plants in one square metre", cta: "See the range", prompt: `${longPrompt} "LEAF"` }] }, input);
    expect(out[0]).toBeNull();
    expect(out[1]).toMatchObject({ title: "Grow Walls", headline: "Every row, a harvest wall", subline: "Grows 30 plants in one square metre", cta: "See the range" });
    expect(out[1]!.prompt).not.toContain('"');
  });
  it("replaces words with invented numbers, percentages or promises", () => {
    const [a] = readConcepts({ concepts: [{ slot: 0, title: "t", scene: "s", headline: "Harvest 3x more", subline: "Now 20% off, guaranteed", cta: "Free trial", prompt: longPrompt }] }, input);
    expect(a!.headline).toBe("LEAF Hydro Tower");
    expect(a!.subline).toBe("");
    expect(a!.cta).toBe("");
    const [b] = readConcepts({ concepts: [{ slot: 0, title: "t", scene: "s", headline: "Only 250,000 RWF", subline: "Uses 90% less water", cta: "Order", prompt: longPrompt }] }, input);
    expect(b).toMatchObject({ headline: "Only 250,000 RWF", subline: "Uses 90% less water" });
  });
  it("drops an answer whose image prompt is too thin, and the rules can always write one", () => {
    expect(readConcepts({ concepts: [{ slot: 0, title: "t", scene: "s", headline: "Hi", subline: "", cta: "", prompt: "a farm" }] }, input)[0]).toBeNull();
    expect(readConcepts("nonsense", input)).toEqual([null, null, null]);
    const r = ruleConcept(slots[0], input);
    expect(r.headline).toBe("LEAF Hydro Tower");
    expect(r.prompt).toContain(slots[0].shot);
  });
});
