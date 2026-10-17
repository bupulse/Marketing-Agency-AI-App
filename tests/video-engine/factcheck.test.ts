import { describe, expect, it, vi } from "vitest";
import { designVideo, systemPrompt, type DesignBrief } from "@/lib/video-engine/designer";
import { factCheck, normalise, numbersIn, wordsToNumber, type FactBrief } from "@/lib/video-engine/factcheck";
import type { MotionSpec } from "@/lib/video-engine/spec";

// The real Nova Phones facts (TEST database): "refurbished" and "one-year warranty" are only in the business description.
const nova: FactBrief = {
  business: { name: "Nova Phones Kigali", description: "We sell new and refurbished smartphones, chargers and accessories in Kigali, with a one-year warranty.", phone: "+250 788 300 400", country: "Rwanda" },
  product: { name: "Samsung Galaxy A56", summary: "Samsung Galaxy A56 5G, 8 GB RAM, 256 GB, in stock now in black, light blue and pink.", price: "420,000 RWF", usps: ["Genuine with 12-month warranty", "Pay with MoMo, instalments available"], features: ["6.7-inch AMOLED screen", "50 MP camera", "5,000 mAh battery"], targetCustomer: "Students and professionals in Kigali who want a reliable 5G phone" },
};

const design = (scenes: { texts: string[]; say?: string }[], caption = ""): Pick<MotionSpec, "scenes" | "caption"> => ({
  caption,
  scenes: scenes.map((s) => ({ seconds: 3, background: { kind: "solid" as const, colors: ["#000000"] }, say: s.say, layers: s.texts.map((text) => ({ kind: "text" as const, text, font: "inter" as const, size: 0.06, color: "#ffffff", x: 0.5, y: 0.5, w: 0.8, h: 0.1 })) })),
});

describe("fact check", () => {
  it("case 1: a design that only uses the facts has no warnings (prices, specs, phone, spoken numbers, durations)", () => {
    const spec = design(
      [
        { texts: ["Samsung Galaxy A56 5G", "420,000 RWF", "IN STOCK NOW"], say: "The Galaxy A56, only four hundred and twenty thousand francs!" },
        { texts: ["6.7-INCH AMOLED", "50 MP camera", "5,000 mAh battery", "3 COLOURS"], say: "A six point seven inch screen and a fifty megapixel camera." },
        { texts: ["Genuine · 1-year warranty", "Pay with MoMo", "0788 300 400"], say: "Order on WhatsApp, 0788 300 400. Find the one for you." },
      ],
      "Samsung Galaxy A56 5G, 8 GB RAM, 256 GB: 420K RWF. Genuine with a 12-month warranty. WhatsApp +250788300400",
    );
    expect(factCheck(spec, nova)).toEqual([]);
  });

  it("case 2: the Kigali price-first design's 'New & refurbished' is caught: true of the shop, not a product fact", () => {
    const warnings = factCheck(design([{ texts: ["New & refurbished • 1-year warranty"] }]), nova);
    expect(warnings.map((w) => [w.found, w.problem, w.where])).toEqual([
      ["new", "business-only", "scene 1 text"],
      ["refurbished", "business-only", "scene 1 text"],
    ]);
    expect(warnings[1].message).toContain("check it is true of this product");
  });

  it("case 3: invented prices, percentages, durations, phone numbers and claims are reported once each, with where they are", () => {
    const warnings = factCheck(
      design([{ texts: ["Now 399,000 RWF", "15% OFF", "2-year warranty"], say: "Award-winning, the best phone in Kigali." }, { texts: ["Call 0788 999 111", "15% OFF"] }], "Free delivery today!"),
      nova,
    );
    const found = warnings.map((w) => `${w.found}@${w.where}:${w.problem}`);
    expect(found).toEqual(
      expect.arrayContaining(["399,000@scene 1 text:not-in-brief", "15%@scene 1 text:not-in-brief", "2-year@scene 1 text:not-in-brief", "award@scene 1 voice:not-in-brief", "award-winning@scene 1 voice:not-in-brief", "best@scene 1 voice:not-in-brief", "0788 999 111@scene 2 text:not-in-brief", "free@caption:not-in-brief"]),
    );
    expect(found.filter((f) => f.startsWith("15%"))).toHaveLength(1);
  });

  it("case 4: anything in the owner's note is allowed", () => {
    const spec = design([{ texts: ["Free delivery in Kigali", "10% off this weekend"] }]);
    expect(factCheck(spec, nova).length).toBeGreaterThan(0);
    expect(factCheck(spec, { ...nova, note: "Weekend offer: 10% off and free delivery in Kigali" })).toEqual([]);
  });

  it("reads numbers the way they are written or spoken", () => {
    expect(wordsToNumber("four hundred and twenty thousand")).toBe(420_000);
    expect(wordsToNumber("six point seven")).toBe(6.7);
    expect(wordsToNumber("fifty")).toBe(50);
    expect(normalise("A one-year warranty")).toBe("a 1-year warranty");
    expect(normalise("the one for you")).toBe("the one for you");
    expect(numbersIn("420k rwf, 12-month, +250 788 300 400").map((n) => [n.kind, n.value])).toEqual([
      ["phone", 250788300400],
      ["duration", 8760],
      ["number", 420_000],
    ]);
  });

  it("designVideo returns the warnings, and the system prompt states the rule", async () => {
    const brief: DesignBrief = { ...nova, photos: [], styleId: "kigali-price-first", hookId: "auto", ratio: "9:16", seconds: 6 };
    const raw = { palette: {}, scenes: [{ seconds: 3, background: {}, layers: [{ kind: "text", text: "Brand new, 50% off", font: "inter", size: 0.06, color: "#fff", x: 0.5, y: 0.5, w: 0.8, h: 0.1 }] }, { seconds: 3, background: {}, layers: [] }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(raw) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    const result = await designVideo(brief, { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.warnings.map((w) => w.found)).toEqual(expect.arrayContaining(["50%", "brand new", "new"]));
    expect(systemPrompt()).toContain("A checker compares every text, say line and the caption with the brief");
    // The brain's score comes with it: 0 to 100, what passed and what failed.
    expect(result.score.score).toBeGreaterThanOrEqual(0);
    expect(result.score.score).toBeLessThanOrEqual(100);
    expect(result.score.passed.length + result.score.failed.length).toBeGreaterThan(0);
    expect(result.score.failed.some((f) => f.id === "say-lines")).toBe(true);
    const quiet = await designVideo({ ...brief, voice: false }, { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(quiet.score.failed.some((f) => f.id === "say-lines")).toBe(false);
  });
});
