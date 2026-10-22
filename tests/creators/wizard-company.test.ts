import { describe, expect, it } from "vitest";
import { applicationFormSchema, defaultForm, fieldSchema } from "@/lib/creators/form-fields";
import { minRate, suggestedRate } from "@/lib/creators/pay-floor";
import { CAMPAIGN_KINDS } from "@/lib/creators/wizard";
import {
  campaignFolderName,
  checkStep,
  costEstimate,
  ideaFromKnowledge,
  kindFromKnowledgeType,
  nameFromIdea,
  nextMonday,
  payMethodOf,
  planTasks,
  reachedAfter,
  readinessChecklist,
  readinessProblems,
  rulesForMethod,
  stepInput,
  taskTexts,
  tasksMatchSpans,
  type WizardAnswers,
} from "@/lib/creators/wizard-steps";
import { handleMention, hashtagOf, sanitizeSuggestion, stepFromSuggestion, templateSuggestion, type SuggestContext } from "@/lib/creators/wizard-suggest";

// The company side of the campaign wizard (docs/CREATOR_CAMPAIGN_WIZARD.md): each step's check, the tasks made from
// step 5, pay helpers, folder names, the go-live list, and the suggestions (templates and the AI's answer made safe).

const ctx = (over: Partial<SuggestContext> = {}): SuggestContext => ({
  businessName: "LEAF",
  industry: "Juice bar",
  country: "Rwanda",
  contentLanguage: "English",
  instagramHandle: "leafjuice",
  currency: "RWF",
  networks: ["instagram", "facebook"],
  productNames: ["Mango juice"],
  creatorsPerCampaign: 20,
  idea: "Get people to film our new juice",
  name: "",
  kind: "PRODUCT_REVIEW",
  ...over,
});

const answers = (over: Partial<WizardAnswers> = {}): WizardAnswers => ({
  idea: "Film our juice",
  name: "Juice week",
  kind: "PRODUCT_REVIEW",
  knowledgeCampaignId: null,
  productIds: [],
  goal: "SALES",
  requirements: { niches: [], locations: [], languages: [] },
  platforms: ["instagram"],
  platformMode: "ANY",
  formats: ["REEL"],
  mentions: ["@leafjuice"],
  startsOn: "2026-11-02",
  endsOn: "2026-12-01",
  briefEvery: "WEEK",
  postsPerDay: 1,
  mediaKind: "VIDEO",
  brief: "Show our juice on a hot day.",
  tasks: [],
  dos: ["Tag us"],
  donts: ["No other brands"],
  rules: null,
  currency: "RWF",
  payRules: { ratePerThousand: 1_500, rateViews: 1_000 },
  viewTargetPerCreator: null,
  viewTargetCampaign: null,
  budget: null,
  applicationForm: defaultForm(),
  files: { exampleLinks: [] },
  look: {},
  listed: true,
  acceptingApplications: true,
  ...over,
});

describe("each step checks its own answers", () => {
  it("needs a line or a name on step 1", () => {
    expect(checkStep("idea", { idea: "", name: "", kind: null, knowledgeCampaignId: null, productIds: [] })).toEqual({ ok: false, error: "Write one line about the campaign." });
    expect(checkStep("idea", { idea: "Film our juice", name: "", kind: "CHALLENGE", knowledgeCampaignId: null, productIds: [] }).ok).toBe(true);
  });

  it("keeps the pay floor and says what a milestone misses", () => {
    const pay = (payRules: object) => checkStep("pay", { currency: "RWF", payRules, viewTargetPerCreator: null, viewTargetCampaign: null, budget: null });
    expect(pay({ ratePerThousand: 5_000, rateViews: 10_000 })).toEqual({ ok: false, error: expect.stringMatching(/at least 10,000 RWF for every 10,000 views/) });
    expect(pay({})).toEqual({ ok: false, error: expect.stringMatching(/^Set how creators earn/) });
    expect(pay({ milestones: [{ views: 10_000, amount: 0 }] })).toEqual({ ok: false, error: "Give each milestone both its views and what it pays, or remove it." });
    expect(pay({ ratePerThousand: 15_000, rateViews: 10_000 }).ok).toBe(true);
  });

  it("refuses a caption mention that is not one, and a daily brief for too long", () => {
    expect(checkStep("where", { platforms: ["instagram"], platformMode: "ANY", formats: [], mentions: ["leaf"] })).toEqual({ ok: false, error: expect.stringMatching(/"leaf" is not a mention/) });
    expect(checkStep("where", { platforms: [], platformMode: "ANY", formats: [], mentions: [] })).toEqual({ ok: false, error: "Pick at least one network." });
    expect(checkStep("when", { startsOn: "2026-11-02", endsOn: "2027-04-01", briefEvery: "DAY", postsPerDay: 1, mediaKind: "VIDEO" })).toEqual({ ok: false, error: expect.stringMatching(/every day works for up to 120 days/) });
  });

  it("checks every task on Content, and sends what each step needs", () => {
    const task = { title: "Hi", instructions: "Film it", startsOn: "2026-11-02", endsOn: "2026-11-01", postsPerDay: 1, platforms: ["instagram"], platformMode: "ANY", mediaKind: "VIDEO" };
    expect(checkStep("content", { brief: "x", tasks: [task] })).toEqual({ ok: false, error: "The last day must be on or after the first day." });
    const sent = stepInput("content", answers({ tasks: [{ ...task, endsOn: "2026-11-08", id: "t1", submissions: 3 } as WizardAnswers["tasks"][number]] })) as { tasks: object[] };
    expect(sent.tasks[0]).not.toHaveProperty("submissions");
    const checked = checkStep("content", sent);
    expect(checked.ok && checked.data.tasks[0].id).toBe("t1");
    const form = stepInput("form", answers({ applicationForm: { ...defaultForm(), fields: [{ id: "f1", type: "SINGLE_CHOICE", label: "Your size?", options: ["S", " ", ""], required: true }] } }));
    expect(checkStep("form", form)).toEqual({ ok: false, error: '"Your size?": give at least 2 answers to pick from.' });
  });
});

describe("tasks from step 5", () => {
  const base = { startsOn: "2026-11-02", endsOn: "2026-12-01", postsPerDay: 2, mediaKind: "VIDEO" as const, platforms: ["instagram" as const], platformMode: "ANY" as const };

  it("makes one task, one a week or one a day, with the texts in order", () => {
    expect(planTasks({ ...base, briefEvery: "MONTH", texts: [{ title: "Review", instructions: "Film a review" }] })).toEqual([{ title: "Review", instructions: "Film a review", startsOn: "2026-11-02", endsOn: "2026-12-01", postsPerDay: 2, platforms: ["instagram"], platformMode: "ANY", mediaKind: "VIDEO" }]);
    const weeks = planTasks({ ...base, briefEvery: "WEEK", texts: [{ title: "Start", instructions: "Do the challenge" }, { title: "Friend", instructions: "Challenge a friend" }] });
    expect(weeks.map((t) => [t.title, t.startsOn, t.endsOn])).toEqual([
      ["Start (week 1)", "2026-11-02", "2026-11-08"],
      ["Friend (week 2)", "2026-11-09", "2026-11-15"],
      ["Start (week 3)", "2026-11-16", "2026-11-22"],
      ["Friend (week 4)", "2026-11-23", "2026-11-29"],
      ["Start (week 5)", "2026-11-30", "2026-12-01"],
    ]);
    expect(planTasks({ ...base, endsOn: "2026-11-03", briefEvery: "DAY", texts: [{ title: "Daily", instructions: "Post today" }] }).map((t) => t.title)).toEqual(["Daily (2 Nov)", "Daily (3 Nov)"]);
  });

  it("knows when the tasks still fit the days, and plans them again from their texts", () => {
    const weeks = planTasks({ ...base, briefEvery: "WEEK", texts: [{ title: "Start", instructions: "Do it" }] });
    expect(tasksMatchSpans(weeks, base.startsOn, base.endsOn, "WEEK")).toBe(true);
    expect(tasksMatchSpans(weeks, base.startsOn, "2026-12-15", "WEEK")).toBe(false);
    expect(taskTexts(weeks)).toEqual([{ title: "Start", instructions: "Do it" }]);
  });
});

describe("small helpers", () => {
  it("starts drafts next Monday and names them from the idea", () => {
    expect(nextMonday("2026-10-22")).toBe("2026-10-26");
    expect(nextMonday("2026-10-26")).toBe("2026-11-02");
    expect(nameFromIdea("get people to film our new juice at the beach this weekend!")).toBe("Get people to film our new juice");
  });

  it("reads and switches the pay method", () => {
    expect(payMethodOf({})).toBe("VIEWS");
    expect(payMethodOf({ feePerPost: 500 })).toBe("POST");
    expect(payMethodOf({ ratePerThousand: 1_000, milestones: [{ views: 10_000, amount: 5_000 }] })).toBe("MIX");
    expect(rulesForMethod({ ratePerThousand: 1_000, feePerPost: 500, capPerPost: 9_000 }, "POST")).toEqual({ ratePerThousand: null, feePerPost: 500, milestones: [], capPerPost: 9_000 });
  });

  it("estimates the cost with the real pay maths, budget included", () => {
    const rules = { ratePerThousand: 1_500, rateViews: 1_000 as const };
    expect(costEstimate({ rules, creators: 5, viewsEach: 10_000, postsEach: 30 })).toEqual({ perCreator: 15_000, total: 75_000 });
    expect(costEstimate({ rules, creators: 5, viewsEach: 10_000, postsEach: 1, budget: 50_000 }).total).toBe(50_000);
  });

  it("names the Photos folders, unique in any case", () => {
    expect(campaignFolderName("Juice week", "Images", [])).toBe("Juice week – Images");
    expect(campaignFolderName("Juice week", "Images", ["juice week – images", "Juice week – Images (2)"])).toBe("Juice week – Images (3)");
    expect(campaignFolderName("x".repeat(80), "Documents", []).length).toBeLessThanOrEqual(60);
  });

  it("counts the steps reached", () => {
    expect(reachedAfter(3, 5)).toBe(6);
    expect(reachedAfter(8, 2)).toBe(8);
    expect(reachedAfter(12, 12)).toBe(12);
    expect(reachedAfter(null, 4)).toBeNull();
  });

  it("starts from a Business info campaign", () => {
    expect(ideaFromKnowledge({ type: "EVENT", name: "Saturday open day", highlights: ["Free tasting"] })).toBe("Get people to come to Saturday open day: Free tasting");
    expect(kindFromKnowledgeType("LAUNCH")).toBe("LAUNCH");
    expect(kindFromKnowledgeType("OFFER")).toBe("OTHER");
  });
});

describe("before going live", () => {
  const facts = { brief: "Show our juice on a hot day.", dos: ["Tag us"], donts: ["No other brands"], tasks: 2, images: 1, videos: 0, exampleLinks: 1 };
  const input = { name: "Juice week", brief: facts.brief, platforms: ["instagram" as const], startsOn: "2026-11-02", endsOn: "2026-12-01", mentions: [], currency: "RWF", payRules: { ratePerThousand: 1_500 }, questions: [] };

  it("is ready with everything, and names the step of each problem", () => {
    expect(readinessProblems(input, facts)).toEqual([]);
    expect(readinessProblems({ ...input, platforms: [], payRules: {} }, { ...facts, images: 0 })).toEqual([
      "Add your logo and product photos to the Images folder (step Files).",
      "Pick at least one platform (step Where).",
      "Set how creators earn: a rate per views, a fee per post or a milestone (step Pay).",
    ]);
    expect(readinessChecklist({ ...facts, videos: 0, exampleLinks: 0 }).filter((c) => !c.done).map((c) => c.step)).toEqual(["files"]);
  });
});

describe("suggestions", () => {
  it("has a template for every kind that could go live", () => {
    for (const k of CAMPAIGN_KINDS) {
      const s = templateSuggestion(ctx({ kind: k.value }));
      expect(s.brief.length).toBeGreaterThanOrEqual(10);
      expect(s.tasks.length).toBeGreaterThan(0);
      expect(s.pay.ratePerThousand).toBeGreaterThanOrEqual(minRate("RWF"));
      expect(applicationFormSchema.safeParse({ ...defaultForm(), fields: s.fields }).success).toBe(true);
      expect(s.platforms.every((p) => ["instagram", "facebook"].includes(p))).toBe(true);
    }
    const s = templateSuggestion(ctx());
    expect(s).toMatchObject({ name: "Get people to film our new juice", niches: ["Food and drinks"], places: ["Kigali"], languages: ["Kinyarwanda", "English"], mentions: ["@leafjuice", "#LEAF"], source: "template" });
  });

  it("keeps the good parts of the AI's answer and never pays below the floor", () => {
    const fallback = templateSuggestion(ctx());
    const s = sanitizeSuggestion(
      {
        name: "Mango Madness",
        kind: "challenge",
        goal: "VIEWS",
        niches: ["food and drinks", "Knitting"],
        places: ["kigali, gasabo", "Paris"],
        languages: ["kinyarwanda"],
        minFollowers: 2_100,
        platforms: ["tiktok", "instagram"],
        formats: ["REEL", "BILLBOARD"],
        hashtag: "#Mango Madness!",
        days: 400,
        briefEvery: "WEEK",
        postsPerDay: 9,
        mediaKind: "VIDEO",
        brief: "Do the mango dance with our juice in hand.",
        tasks: [{ title: "Dance", instructions: "Film the mango dance" }, { title: "", instructions: "" }],
        dos: ["Smile"],
        donts: [],
        ratePerThousand: 10,
        feePerPost: 0,
        fields: [
          { label: "Can you dance?", type: "YES_NO", options: [], required: true },
          { label: "Your size?", type: "SINGLE_CHOICE", options: ["S"], required: false },
          { label: "How many dances a week?", type: "NUMBER", options: [], required: false },
        ],
      },
      ctx(),
      fallback,
    );
    expect(s).toMatchObject({ name: "Mango Madness", kind: "CHALLENGE", niches: ["Food and drinks"], places: ["Kigali, Gasabo"], languages: ["Kinyarwanda"], minFollowers: 2_500, platforms: ["instagram"], formats: ["REEL"], mentions: ["@leafjuice", "#MangoMadness"], days: 90, postsPerDay: 3, donts: fallback.donts, source: "ai" });
    expect(s.tasks).toEqual([{ title: "Dance", instructions: "Film the mango dance" }]);
    expect(s.pay.ratePerThousand).toBe(suggestedRate("RWF"));
    expect(s.fields.map((f) => f.label)).toEqual(["Can you dance?", "How many dances a week?"]);
    expect(s.fields.every((f) => fieldSchema.safeParse(f).success)).toBe(true);
    expect(sanitizeSuggestion("not json", ctx(), fallback)).toBe(fallback);
  });

  it("fills one step from a suggestion", () => {
    const s = templateSuggestion(ctx({ kind: "CHALLENGE" }));
    const content = stepFromSuggestion("content", s, answers(), { creatorsPerCampaign: 20, today: "2026-10-22" });
    expect(content.tasks?.map((t) => t.title)).toEqual(["Start the challenge (week 1)", "Challenge a friend (week 2)", "Your best take (week 3)", "The final round (week 4)", "Start the challenge (week 5)"]);
    expect(content.tasks).toHaveLength(5);
    expect(content.tasks?.[0]).toMatchObject({ startsOn: "2026-11-02", endsOn: "2026-11-08", platforms: ["instagram"] });
    const when = stepFromSuggestion("when", s, answers({ startsOn: "2026-10-01" }), { creatorsPerCampaign: 20, today: "2026-10-22" });
    expect(when).toMatchObject({ startsOn: "2026-10-22", endsOn: "2026-11-20", briefEvery: "WEEK" });
    expect(stepFromSuggestion("creators", s, answers(), { creatorsPerCampaign: 3, today: "2026-10-22" }).requirements?.creatorsWanted).toBe(3);
  });

  it("makes mentions from a handle and a name", () => {
    expect(handleMention("https://instagram.com/leaf.juice/")).toBe("@leaf.juice");
    expect(handleMention("not a handle!")).toBeNull();
    expect(hashtagOf("Kigali juice week")).toBe("#KigaliJuiceWeek");
  });
});
