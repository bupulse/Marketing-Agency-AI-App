import { describe, expect, it } from "vitest";
import { campaignSchema, payRulesInWords } from "@/lib/creators/company-forms";
import { applicationFormSchema, answerInWords, newField, PRESET_FIELDS, readAnswer, readApplicationForm } from "@/lib/creators/form-fields";
import { campaignNetworks } from "@/lib/creators/networks";
import { computePeriodPay, ratePerThousandViews } from "@/lib/creators/pay";
import { minRate, rateLevel, rateProblem, suggestedRate } from "@/lib/creators/pay-floor";
import { matchApplicant, readRequirements } from "@/lib/creators/requirements";
import { goLiveProblems, readFiles, stepAt, STEP_COUNT, stepNumber } from "@/lib/creators/wizard";

describe("pay floor", () => {
  it("is 1,000 RWF per 1,000 views, scaled to the views picked", () => {
    expect(minRate("RWF")).toBe(1_000);
    expect(minRate("RWF", 10_000)).toBe(10_000);
    expect(minRate("USD", 100_000)).toBe(100);
    expect(suggestedRate("RWF")).toBe(1_500);
  });

  it("rates the price for the meter", () => {
    expect(rateLevel(999, 1_000, "RWF")).toBe("LOW");
    expect(rateLevel(1_000, 1_000, "RWF")).toBe("FAIR");
    expect(rateLevel(30_000, 10_000, "RWF")).toBe("GENEROUS");
    expect(rateLevel(25_000, 1_000, "RWF")).toBe("TOO_HIGH");
  });

  it("refuses a low rate in the campaign form, and lets fees alone through", () => {
    expect(rateProblem({ ratePerThousand: 5_000, rateViews: 10_000 }, "RWF")).toMatch(/at least 10,000 RWF for every 10,000 views/);
    expect(rateProblem({ feePerPost: 100 }, "RWF")).toBeNull();
    const base = { name: "Summer", brief: "Show our juice on a hot day.", platforms: ["instagram"], startsOn: "2026-11-01", endsOn: "2026-11-30", mentions: [], currency: "RWF", questions: [] };
    expect(campaignSchema.safeParse({ ...base, payRules: { ratePerThousand: 500 } }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, payRules: { ratePerThousand: 15_000, rateViews: 10_000 } }).success).toBe(true);
  });
});

describe("rate per any number of views", () => {
  it("pays the rate for each rateViews views and says it in words", () => {
    const pay = computePeriodPay({ ratePerThousand: 15_000, rateViews: 10_000 }, {}, [{ postId: "p", creatorId: "c", status: "TRACKING", postedInPeriod: true, viewsAtStart: 0, viewsAtEnd: 25_000 }]);
    expect(pay.creators[0].amount).toBe(37_500);
    expect(payRulesInWords({ ratePerThousand: 15_000, rateViews: 10_000 }, "RWF")).toEqual(["15,000 RWF for every 10,000 views"]);
    expect(ratePerThousandViews({ ratePerThousand: 15_000, rateViews: 10_000 })).toBe(1_500);
    expect(ratePerThousandViews({ ratePerThousand: 2_000 })).toBe(2_000);
  });
});

describe("application form", () => {
  it("falls back to the default form with old questions as fields", () => {
    const form = readApplicationForm(null, [{ id: "q1", label: "Why us?", required: true }]);
    expect(form).toMatchObject({ phone: "REQUIRED", samples: "OPTIONAL", fields: [{ id: "q1", type: "LONG_TEXT", label: "Why us?", required: true }] });
  });

  it("accepts the presets and refuses a choice field without answers", () => {
    expect(applicationFormSchema.safeParse({ phone: "OPTIONAL", samples: "HIDDEN", fields: PRESET_FIELDS }).success).toBe(true);
    const bad = { ...newField("SINGLE_CHOICE", "f1"), label: "Your size?" };
    expect(applicationFormSchema.safeParse({ phone: "REQUIRED", samples: "OPTIONAL", fields: [bad] }).success).toBe(false);
  });

  it("reads each kind of answer", () => {
    const f = (over: object) => ({ id: "f", label: "Q?", required: true, ...over }) as Parameters<typeof readAnswer>[0];
    expect(readAnswer(f({ type: "SHORT_TEXT" }), [""])).toEqual({ ok: false, error: "Please answer this." });
    expect(readAnswer(f({ type: "SHORT_TEXT", required: false }), [""])).toEqual({ ok: true, value: null });
    expect(readAnswer(f({ type: "SINGLE_CHOICE", options: ["S", "M"] }), ["L"]).ok).toBe(false);
    expect(readAnswer(f({ type: "MULTI_CHOICE", options: ["A", "B", "C"] }), ["A", "C"])).toEqual({ ok: true, value: ["A", "C"] });
    expect(readAnswer(f({ type: "SCALE", min: 1, max: 5 }), ["6"]).ok).toBe(false);
    expect(readAnswer(f({ type: "NUMBER" }), ["12,000"])).toEqual({ ok: true, value: 12_000 });
    expect(readAnswer(f({ type: "MONEY_RANGE" }), [], { a: "5000", b: "20000" })).toEqual({ ok: true, value: { min: 5_000, max: 20_000 } });
    expect(readAnswer(f({ type: "DATE_RANGE" }), [], { a: "2026-11-05", b: "2026-11-01" }).ok).toBe(false);
    expect(readAnswer(f({ type: "DATE" }), ["2026-02-30"]).ok).toBe(false);
    expect(readAnswer(f({ type: "LINK" }), ["instagram.com/x"]).ok).toBe(false);
    expect(answerInWords(f({ type: "SCALE", max: 5 }), 4)).toBe("4 out of 5");
    expect(answerInWords(f({ type: "YES_NO" }), "yes")).toBe("Yes");
  });
});

describe("requirements", () => {
  const req = readRequirements({ minFollowers: 1_000, locations: ["Kigali"], languages: ["Kinyarwanda"], niches: [] });

  it("lists what doesn't fit, and what wasn't given separately", () => {
    expect(matchApplicant(req, { followers: [800, 1_200], location: "Kigali, Gasabo", languages: ["kinyarwanda"] })).toEqual({ misses: [], unknown: [] });
    expect(matchApplicant(req, { followers: [300], location: "Musanze", languages: ["English"] }).misses).toEqual(["Fewer than 1,000 followers", "Not in Kigali", "Doesn't post in Kinyarwanda"]);
    expect(matchApplicant(req, { followers: [] }).unknown).toEqual(["Followers not given", "Location not given", "Languages not given"]);
  });
});

describe("wizard", () => {
  it("has 12 steps", () => {
    expect(STEP_COUNT).toBe(12);
    expect(stepNumber("pay")).toBe(8);
    expect(stepAt(99).id).toBe("review");
  });

  it("lists what is missing before going live", () => {
    const ready = { brief: "Show our juice on a hot day.", dos: ["Tag us"], donts: ["No other brands"], tasks: 1, images: 2, videos: 0, exampleLinks: 1 };
    expect(goLiveProblems(ready)).toEqual([]);
    expect(goLiveProblems({ ...ready, tasks: 0, donts: [], images: 0, exampleLinks: 0 })).toHaveLength(4);
  });

  it("only takes a Google Drive folder link", () => {
    expect(readFiles({ driveUrl: "https://example.com/x" })).toEqual({ exampleLinks: [] });
    expect(readFiles({ driveUrl: "https://drive.google.com/drive/folders/abc" }).driveUrl).toBe("https://drive.google.com/drive/folders/abc");
  });

  it("shows every network, the untracked ones coming soon", () => {
    const list = campaignNetworks(false);
    expect(list.filter((n) => !n.soon).map((n) => n.network)).toEqual(["instagram", "facebook"]);
    expect(campaignNetworks(true).find((n) => n.network === "tiktok")?.soon).toBe(false);
    expect(list.find((n) => n.network === "x")).toMatchObject({ label: "X (Twitter)", soon: true });
  });
});

describe("places", () => {
  it("has Rwanda's 30 districts and finds them by any word", async () => {
    const { PLACES, searchPlaces } = await import("@/lib/creators/places");
    expect(PLACES.filter((p) => p.includes(", ") && !/Kenya|Uganda|Tanzania|Burundi|Congo/.test(p))).toHaveLength(30);
    expect(searchPlaces("gasabo")).toEqual(["Kigali, Gasabo"]);
    expect(searchPlaces("western rub")).toEqual(["Western Province, Rubavu"]);
  });
});
