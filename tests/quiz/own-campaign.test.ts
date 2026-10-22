import { describe, expect, it } from "vitest";
import {
  allowedFacts,
  campaignFromQuiz,
  datesForChip,
  numbersIn,
  sanitizeOwnSuggestion,
  templateOwnSuggestion,
  usesOnlyFacts,
  whenChipsFor,
  type OwnQuizAnswers,
  type OwnSuggestContext,
} from "@/lib/knowledge/campaign-quiz";
import { campaignInputSchema } from "@/lib/knowledge/campaigns";

// The own campaign quiz (docs/QUIZ_MODE.md, "B"): the date chips, the answers as the full form's input, and the AI's
// ideas made safe (no invented prices or discounts), with the template when the AI cannot answer.

const THURSDAY = "2026-10-22";

const answers = (over: Partial<OwnQuizAnswers> = {}): OwnQuizAnswers => ({
  type: "OFFER",
  line: "20% off all juices this weekend",
  productIds: ["p1"],
  when: "WEEKEND",
  pickStartsOn: "",
  pickEndsOn: "",
  deal: "20% off all juices",
  highlights: ["Fresh every morning"],
  name: "Juice weekend",
  description: "Our juices for less, this weekend only.",
  ...over,
});

const ctx = (over: Partial<OwnSuggestContext> = {}): OwnSuggestContext => ({
  type: "OFFER",
  line: "20% off all juices this weekend",
  businessName: "Sample Juice Bar",
  products: [{ name: "Mango juice", price: "2,000 RWF" }],
  ...over,
});

describe("date chips", () => {
  it("turn into the first and last day from the business's today", () => {
    expect(datesForChip("TODAY", THURSDAY)).toEqual({ startsOn: THURSDAY, endsOn: null });
    expect(datesForChip("WEEKEND", THURSDAY)).toEqual({ startsOn: "2026-10-24", endsOn: "2026-10-25" });
    expect(datesForChip("NEXT_WEEK", THURSDAY)).toEqual({ startsOn: "2026-10-26", endsOn: "2026-11-01" });
    expect(datesForChip("MONTH", THURSDAY)).toEqual({ startsOn: THURSDAY, endsOn: "2026-10-31" });
    expect(datesForChip("NONE", THURSDAY)).toEqual({ startsOn: null, endsOn: null });
  });

  it("know the weekend from a Saturday or a Sunday, and a Monday's next week", () => {
    expect(datesForChip("WEEKEND", "2026-10-24")).toEqual({ startsOn: "2026-10-24", endsOn: "2026-10-25" });
    expect(datesForChip("WEEKEND", "2026-10-25")).toEqual({ startsOn: "2026-10-25", endsOn: null });
    expect(datesForChip("NEXT_WEEK", "2026-10-26")).toEqual({ startsOn: "2026-11-02", endsOn: "2026-11-08" });
    expect(datesForChip("MONTH", "2026-12-31")).toEqual({ startsOn: "2026-12-31", endsOn: null });
    expect(datesForChip("MONTH", "2028-02-10")).toEqual({ startsOn: "2028-02-10", endsOn: "2028-02-29" });
  });

  it("keep picked dates that are real days, and drop an end equal to the start", () => {
    expect(datesForChip("PICK", THURSDAY, { startsOn: "2026-11-05", endsOn: "2026-11-07" })).toEqual({ startsOn: "2026-11-05", endsOn: "2026-11-07" });
    expect(datesForChip("PICK", THURSDAY, { startsOn: "2026-11-05", endsOn: "2026-11-05" })).toEqual({ startsOn: "2026-11-05", endsOn: null });
    expect(datesForChip("PICK", THURSDAY, { startsOn: "2026-02-30", endsOn: "" })).toEqual({ startsOn: null, endsOn: null });
  });

  it("offer no 'No dates' to an event", () => {
    expect(whenChipsFor("EVENT").map((w) => w.value)).not.toContain("NONE");
    expect(whenChipsFor("OFFER").map((w) => w.value)).toContain("NONE");
  });
});

describe("the quiz's answers", () => {
  it("are the full form's input and pass its schema", () => {
    const input = campaignFromQuiz(answers(), THURSDAY);
    expect(input).toEqual({
      type: "OFFER",
      name: "Juice weekend",
      description: "Our juices for less, this weekend only.",
      startsOn: "2026-10-24",
      endsOn: "2026-10-25",
      priceInfo: "20% off all juices",
      highlights: ["Fresh every morning"],
      productIds: ["p1"],
      status: "ACTIVE",
    });
    expect(campaignInputSchema.safeParse(input).success).toBe(true);
  });

  it("fill a skipped name and description from the line, and 'No price' saves none", () => {
    const input = campaignFromQuiz(answers({ name: "", description: "", deal: "  ", when: "NONE", line: "our new branch in Kimironko" , type: "LAUNCH" }), THURSDAY);
    expect(input).toMatchObject({ name: "Our new branch in Kimironko", description: "our new branch in Kimironko", priceInfo: null, startsOn: null, endsOn: null });
    expect(campaignInputSchema.safeParse(input).success).toBe(true);
    expect(campaignFromQuiz(answers({ name: "", line: "", type: "EVENT" }), THURSDAY).name).toBe("Our event");
  });

  it("keep the schema's checks: an event needs a date, the end not before the start", () => {
    const event = campaignInputSchema.safeParse(campaignFromQuiz(answers({ type: "EVENT", when: "PICK", pickStartsOn: "" }), THURSDAY));
    expect(event.success).toBe(false);
    const backwards = campaignInputSchema.safeParse(campaignFromQuiz(answers({ when: "PICK", pickStartsOn: "2026-11-05", pickEndsOn: "2026-11-01" }), THURSDAY));
    expect(backwards.success).toBe(false);
  });
});

describe("no invented prices", () => {
  it("reads numbers plainly", () => {
    expect(numbersIn("20% off, now 2,000 RWF (was 2 500)")).toEqual(["20", "2000", "2500"]);
    expect(numbersIn("$12.50 and 007")).toEqual(["12.5", "7"]);
  });

  it("allows only the numbers and deal words of the owner's line and the stored prices", () => {
    const facts = allowedFacts(ctx());
    expect(usesOnlyFacts("20% off all juices", facts)).toBe(true);
    expect(usesOnlyFacts("Mango juice for 2,000 RWF", facts)).toBe(true);
    expect(usesOnlyFacts("30% off everything", facts)).toBe(false);
    expect(usesOnlyFacts("Mango juice for 1,500 RWF", facts)).toBe(false);
    expect(usesOnlyFacts("Free delivery in Kigali", facts)).toBe(false);
    expect(usesOnlyFacts("Fresh every morning", facts)).toBe(true);
    expect(usesOnlyFacts("Free delivery", allowedFacts(ctx({ line: "Free delivery this week" })))).toBe(true);
  });

  it("drops the AI's invented deals, highlights, name and description, and keeps the rest", () => {
    const fallback = templateOwnSuggestion(ctx());
    const s = sanitizeOwnSuggestion(
      {
        name: "Juice weekend",
        description: "Get 50% off every juice and a free cake.",
        when: "weekend",
        deals: ["20% off all juices", "Buy 2 get 1 free", "Mango juice: 2,000 RWF", "Half price smoothies"],
        highlights: ["Fresh every morning", "Free delivery", "Save 1,000 RWF", "Made in Kigali"],
      },
      ctx(),
      fallback,
    );
    expect(s).toMatchObject({ name: "Juice weekend", when: "WEEKEND", deals: ["20% off all juices", "Mango juice: 2,000 RWF"], highlights: ["Fresh every morning", "Made in Kigali"], source: "ai" });
    expect(s.description).toBe(fallback.description);
  });

  it("takes the template for anything unusable, and never 'No dates' for an event", () => {
    const fallback = templateOwnSuggestion(ctx({ type: "EVENT", line: "Open day at our shop" }));
    expect(sanitizeOwnSuggestion(null, ctx(), fallback)).toBe(fallback);
    const s = sanitizeOwnSuggestion({ name: "x", description: 3, when: "NONE", deals: "20%", highlights: [] }, ctx({ type: "EVENT", line: "Open day at our shop" }), fallback);
    expect(s).toMatchObject({ name: fallback.name, description: fallback.description, when: fallback.when, deals: fallback.deals, highlights: fallback.highlights });
  });
});

describe("the template (no AI)", () => {
  it("builds deals only from the owner's line and the stored prices", () => {
    const t = templateOwnSuggestion(ctx());
    expect(t.deals).toEqual(["20% off all juices this weekend", "Mango juice: 2,000 RWF"]);
    const facts = allowedFacts(ctx());
    for (const text of [t.name, t.description, ...t.deals, ...t.highlights]) expect(usesOnlyFacts(text, facts)).toBe(true);
  });

  it("makes no deal when there is no price anywhere, for every kind", () => {
    for (const type of ["OFFER", "EVENT", "PROMOTION", "LAUNCH", "OTHER"] as const) {
      const c = ctx({ type, line: "Something nice for our customers", products: [{ name: "Tea", price: null }] });
      const t = templateOwnSuggestion(c);
      expect(t.deals).toEqual([]);
      expect(t.source).toBe("template");
      const facts = allowedFacts(c);
      for (const text of [t.name, t.description, ...t.highlights]) expect(usesOnlyFacts(text, facts)).toBe(true);
      expect(campaignInputSchema.safeParse(campaignFromQuiz({ type, line: c.line, productIds: [], when: t.when, pickStartsOn: "", pickEndsOn: "", deal: "", highlights: t.highlights, name: t.name, description: t.description }, THURSDAY)).success).toBe(true);
    }
  });
});
