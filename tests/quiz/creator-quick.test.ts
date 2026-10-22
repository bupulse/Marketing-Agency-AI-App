import { describe, expect, it } from "vitest";
import { defaultForm } from "@/lib/creators/form-fields";
import { minRate } from "@/lib/creators/pay-floor";
import {
  budgetPresets,
  CARD_STEPS,
  cardForStep,
  cardInputs,
  continueHref,
  detailedSetupHref,
  lengthChipOf,
  progressAt,
  QUICK_CARDS,
  QUICK_STEPS,
  quickDates,
  rateRange,
  sizeOf,
  sliderPay,
  startChipOf,
  withRate,
  withSize,
} from "@/lib/creators/quick";
import { checkStep, ideaExamples, ideaExamplesFor, MAX_IDEA, planTasks, type WizardAnswers } from "@/lib/creators/wizard-steps";
import { stepFromSuggestion, templateSuggestion, type SuggestContext } from "@/lib/creators/wizard-suggest";
import { SUGGEST_STEPS } from "@/lib/creators/wizard-suggest";

// Creator campaign quick mode (docs/QUIZ_MODE.md, "C"): each card sends the detailed wizard's step inputs, so a draft
// is the same either way; the chips, the size tiles and the pay slider's range.

const TODAY = "2026-10-22"; // a Thursday

const ctx: SuggestContext = {
  businessName: "Sample Juice Bar",
  industry: "Juice bar",
  country: "Rwanda",
  contentLanguage: "English",
  instagramHandle: "samplejuice",
  currency: "RWF",
  networks: ["instagram", "facebook"],
  productNames: ["Mango juice"],
  creatorsPerCampaign: 10,
  idea: "Get people to film our new juice",
  name: "",
  kind: "PRODUCT_REVIEW",
};

/** A draft as createDraft fills it from the template: the answers quick mode starts from after card 1. */
function draft(): WizardAnswers {
  const s = templateSuggestion(ctx);
  let a: WizardAnswers = {
    idea: ctx.idea,
    name: s.name,
    kind: s.kind,
    knowledgeCampaignId: null,
    productIds: ["p1"],
    goal: null,
    requirements: { niches: [], locations: [], languages: [] },
    platforms: [],
    platformMode: "ANY",
    formats: [],
    mentions: [],
    startsOn: "2026-10-26",
    endsOn: "2026-11-24",
    briefEvery: null,
    postsPerDay: 1,
    mediaKind: "VIDEO",
    brief: "",
    tasks: [],
    dos: [],
    donts: [],
    rules: null,
    currency: "RWF",
    payRules: {},
    viewTargetPerCreator: null,
    viewTargetCampaign: null,
    budget: null,
    applicationForm: defaultForm(),
    files: { exampleLinks: [] },
    look: {},
    listed: true,
    acceptingApplications: true,
  };
  for (const step of SUGGEST_STEPS) a = { ...a, ...stepFromSuggestion(step, s, a, { creatorsPerCampaign: ctx.creatorsPerCampaign, today: TODAY }) };
  return { ...a, tasks: planTasks({ startsOn: a.startsOn, endsOn: a.endsOn, briefEvery: a.briefEvery ?? "MONTH", postsPerDay: 1, mediaKind: a.mediaKind, platforms: a.platforms, platformMode: "ANY", texts: s.tasks }) };
}

describe("the cards", () => {
  it("are nine, in the spec's order, in three rounds", () => {
    expect(QUICK_CARDS).toEqual(["idea", "goal", "creators", "where", "when", "pay", "prepared", "files", "ready"]);
    expect([...new Set(QUICK_STEPS.map((s) => s.round))]).toEqual(["idea", "setup", "finish"]);
  });

  it("send the detailed wizard's step inputs, and each passes checkStep", () => {
    const a = draft();
    for (const card of QUICK_CARDS) {
      const inputs = cardInputs(card, a);
      expect(inputs.map((i) => i.step)).toEqual(CARD_STEPS[card]);
      for (const { step, input } of inputs) expect(checkStep(step, input), `${card} → ${step}`).toMatchObject({ ok: true });
    }
  });

  it("still pass after the quick answers change them", () => {
    let a = draft();
    a = { ...a, goal: "VIEWS", requirements: withSize({ ...a.requirements, locations: ["Kigali, Gasabo", "Musanze town"], niches: ["Food and drinks", "Lifestyle"] }, "10K") };
    a = { ...a, platforms: ["instagram", "facebook"], formats: ["REEL", "STORY"] };
    a = { ...a, ...quickDates("TODAY", "2W", TODAY, a), briefEvery: "WEEK" };
    a = { ...a, payRules: withRate(a.payRules, 2_500), budget: budgetPresets("RWF")[1] };
    for (const card of ["goal", "creators", "where", "when", "pay"] as const) for (const { step, input } of cardInputs(card, a)) expect(checkStep(step, input), card).toMatchObject({ ok: true });
    expect(cardInputs("pay", a)[0].input).toMatchObject({ currency: "RWF", payRules: { ratePerThousand: 2_500, rateViews: 1_000 }, budget: 100_000 });
    expect(cardInputs("creators", a)[0].input).toMatchObject({ requirements: { minFollowers: 10_000 } });
  });

  it("are refused by the same checks: no network, below the pay floor", () => {
    const a = draft();
    expect(checkStep("where", cardInputs("where", { ...a, platforms: [] })[0].input)).toEqual({ ok: false, error: "Pick at least one network." });
    expect(checkStep("pay", cardInputs("pay", { ...a, payRules: { ratePerThousand: 900, rateViews: 1_000 } })[0].input)).toMatchObject({ ok: false, error: expect.stringMatching(/at least 1,000 RWF/) });
  });

  it("never send the tasks back (Content is saved by its detailed step)", () => {
    expect(Object.values(CARD_STEPS).flat()).not.toContain("content");
  });
});

describe("where a draft continues", () => {
  it("maps the furthest wizard step to a card", () => {
    expect(cardForStep(2)).toBe("goal");
    expect(cardForStep(5)).toBe("when");
    expect(cardForStep(6)).toBe("pay");
    expect(cardForStep(9)).toBe("prepared");
    expect(cardForStep(12)).toBe("files");
    expect(cardForStep(null)).toBe("files");
  });

  it("opens quick mode from the draft list's Continue, with the detailed wizard beside it", () => {
    expect(continueHref("c1", 2)).toBe("/dashboard/creators/c1/quick?card=goal");
    expect(continueHref("c1", 8)).toBe("/dashboard/creators/c1/quick?card=pay");
    expect(continueHref("c1", 12)).toBe("/dashboard/creators/c1/quick?card=files");
    expect(detailedSetupHref("c1", 8)).toBe("/dashboard/creators/c1/setup?step=8");
  });

  it("counts the cards before as answered and their rounds as done", () => {
    expect(progressAt("goal")).toEqual({ index: 1, answered: ["idea"], skipped: [], doneRounds: ["idea"] });
    expect(progressAt("prepared")).toMatchObject({ index: 6, doneRounds: ["idea", "setup"] });
    expect(progressAt("idea")).toMatchObject({ index: 0, answered: [], doneRounds: [] });
  });
});

describe("the chips and tiles", () => {
  it("size tiles read and write the least followers", () => {
    expect(sizeOf(null)).toBe("ANY");
    expect(sizeOf(500)).toBe("ANY");
    expect(sizeOf(1_000)).toBe("1K");
    expect(sizeOf(25_000)).toBe("10K");
    expect(sizeOf(1_000_000)).toBe("50K");
    expect(withSize({ niches: [], locations: [], languages: [], minFollowers: 5_000 }, "ANY").minFollowers).toBeNull();
  });

  it("date chips make the first and last day", () => {
    const current = { startsOn: "2026-10-26", endsOn: "2026-11-24" };
    expect(quickDates("TODAY", "1W", TODAY, current)).toEqual({ startsOn: TODAY, endsOn: "2026-10-28" });
    expect(quickDates("MONDAY", "1M", TODAY, current)).toEqual({ startsOn: "2026-10-26", endsOn: "2026-11-24" });
    expect(quickDates("PICK", "2W", TODAY, { startsOn: "2026-11-03", endsOn: "2026-11-03" })).toEqual({ startsOn: "2026-11-03", endsOn: "2026-11-16" });
    // A picked last day stays; a new start keeps the length.
    expect(quickDates("PICK", "PICK", TODAY, { startsOn: "2026-11-03", endsOn: "2026-11-20" })).toEqual({ startsOn: "2026-11-03", endsOn: "2026-11-20" });
    expect(quickDates("TODAY", "PICK", TODAY, { startsOn: "2026-11-03", endsOn: "2026-11-05" })).toEqual({ startsOn: TODAY, endsOn: "2026-10-24" });
    expect(startChipOf(TODAY, TODAY)).toBe("TODAY");
    expect(startChipOf("2026-10-26", TODAY)).toBe("MONDAY");
    expect(startChipOf("2026-11-03", TODAY)).toBe("PICK");
    expect(lengthChipOf("2026-10-26", "2026-11-24")).toBe("1M");
    expect(lengthChipOf("2026-10-26", "2026-11-01")).toBe("1W");
    expect(lengthChipOf("2026-10-26", "2026-11-10")).toBe("PICK");
  });

  it("the pay slider starts at the floor and keeps the views the price is for", () => {
    expect(rateRange("RWF", 1_000, 1_500)).toEqual({ min: 1_000, max: 5_000, step: 100 });
    expect(rateRange("RWF", 10_000, 80_000).max).toBe(80_000);
    expect(rateRange("RWF", 1_000, 99_000).max).toBe(20_000); // never past the typing-mistake cap
    expect(rateRange("USD", 1_000, null)).toMatchObject({ min: minRate("USD"), step: 1 });
    expect(withRate({ ratePerThousand: 15_000, rateViews: 10_000 }, 20_000)).toEqual({ ratePerThousand: 20_000, rateViews: 10_000 });
    expect(withRate({}, 1_500)).toEqual({ ratePerThousand: 1_500, rateViews: 1_000 });
    expect(sliderPay({ ratePerThousand: 1_500 })).toBe(true);
    expect(sliderPay({ feePerPost: 2_000 })).toBe(false);
    expect(budgetPresets("RWF")).toEqual([50_000, 100_000, 250_000]);
  });
});

describe("card 1's idea examples", () => {
  it("name the business's products, one per idea, in its industry's words", () => {
    expect(ideaExamplesFor("Juice bar", ["Passion Juice"])).toEqual(["Film yourself trying our Passion Juice", "Your first sip or bite of our Passion Juice in 15 seconds", "Show a friend tasting our Passion Juice"]);
    expect(ideaExamplesFor("Juice bar", ["Passion Juice", "Mango juice"]).map((i) => i.includes("Mango juice"))).toEqual([false, true, false]);
    expect(ideaExamplesFor("Hair salon", ["Shea butter cream"])[0]).toBe("Try our Shea butter cream for a week and tell us");
    expect(ideaExamplesFor(null, ["Sample product"])[0]).toBe("Film yourself trying our Sample product");
  });

  it("fall back to the industry's examples without a usable product name", () => {
    expect(ideaExamplesFor("Juice bar", [])).toEqual(ideaExamples("Juice bar"));
    expect(ideaExamplesFor("Juice bar", [" ", "x".repeat(80)])).toEqual(ideaExamples("Juice bar"));
    for (const idea of ideaExamplesFor("Tech shop", ["Laptop"])) expect(idea.length).toBeLessThanOrEqual(MAX_IDEA);
  });
});
