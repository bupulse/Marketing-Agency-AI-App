import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MomoSteps } from "@/app/(marketing)/pricing/momo-steps";
import { PlanQuiz } from "@/app/(marketing)/pricing/plan-quiz";
import type { FeatureKey } from "@/lib/features";
import { QUIZ_QUESTIONS, parseAnswers, pickedPlanKey, recommendPlan, type QuizAnswers } from "@/lib/plan-quiz";
import type { RegionalPlan } from "@/lib/region-prices";

// Plans shaped like the Rwanda ones, with prices no code knows: the quiz and the steps must read them from the plans.
function plan(key: string, monthly: number, features: FeatureKey[], limits: { text: number; image: number; seats: number }, extra: Partial<RegionalPlan> = {}): RegionalPlan {
  return {
    key,
    name: key[0] + key.slice(1).toLowerCase(),
    description: "",
    isTrial: false,
    trialDays: null,
    highlight: false,
    monthlyPriceCents: monthly,
    yearlyPriceCents: monthly * 10,
    currency: "RWF",
    limits: { ...limits, videos: 0, voiceCharacters: 0, chat: 0 },
    highlights: [],
    features,
    regionKey: "RW",
    paymentMethods: ["momo", "card"],
    card: null,
    ...extra,
  };
}

const CORE: FeatureKey[] = ["content", "designs", "calendar", "gallery"];
const starter = plan("STARTER", 15_123, CORE, { text: 60, image: 30, seats: 1 });
const business = plan("BUSINESS", 50_456, [...CORE, "aiPhotos", "websiteChat", "video", "voice"], { text: 200, image: 100, seats: 3 });
const trial = plan("TRIAL", 0, [...CORE, "video", "websiteChat"], { text: 999, image: 999, seats: 99 }, { isTrial: true });
const PLANS = [business, starter, trial];

const ask = (goal: QuizAnswers["goal"], volume: QuizAnswers["volume"], team: QuizAnswers["team"]) => recommendPlan({ goal, volume, team }, PLANS);

describe("plan quiz: the recommendation", () => {
  it("picks the cheapest plan that fits a small shop that wants posts", () => {
    const r = ask("posts", "few", "solo");
    expect(r.kind).toBe("plan");
    expect(r.kind === "plan" && r.plan.key).toBe("STARTER");
  });

  it("moves up when the posts or the users do not fit the cheaper plan", () => {
    const daily = ask("posts", "daily", "solo"); // 60 posts > 30 designs
    expect(daily.kind === "plan" && daily.plan.key).toBe("BUSINESS");
    const team = ask("posts", "few", "small"); // 3 users > 1 seat
    expect(team.kind === "plan" && team.plan.key).toBe("BUSINESS");
  });

  it("needs the goal's feature: videos and replies go to the plan that has them", () => {
    for (const goal of ["videos", "replies"] as const) {
      const r = ask(goal, "few", "solo");
      expect(r.kind === "plan" && r.plan.key).toBe("BUSINESS");
    }
    const v = ask("videos", "few", "solo");
    expect(v.reasons.join(" ")).toMatch(/videos/);
  });

  it("never recommends the trial, even when it is the only plan that fits", () => {
    const r = recommendPlan({ goal: "posts", volume: "few", team: "large" }, PLANS);
    expect(r.kind).toBe("custom");
  });

  it("sends 'do it all for me' to Managed by BuPulse, whatever the plans", () => {
    expect(ask("done_for_you", "daily", "large").kind).toBe("managed");
    expect(recommendPlan({ goal: "done_for_you", volume: "few", team: "solo" }, []).kind).toBe("managed");
  });

  it("follows the catalog: a cheaper plan with video wins once it exists", () => {
    const videoStarter = plan("VIDEO_STARTER", 20_000, [...CORE, "video"], { text: 60, image: 30, seats: 1 });
    const r = recommendPlan({ goal: "videos", volume: "few", team: "solo" }, [...PLANS, videoStarter]);
    expect(r.kind === "plan" && r.plan.key).toBe("VIDEO_STARTER");
  });

  it("breaks a price tie by key, so the answer never changes between renders", () => {
    const a = plan("AAA", 15_123, CORE, { text: 60, image: 30, seats: 1 });
    const r = recommendPlan({ goal: "posts", volume: "few", team: "solo" }, [starter, a]);
    expect(r.kind === "plan" && r.plan.key).toBe("AAA");
  });
});

describe("plan quiz: answers and the remembered pick", () => {
  it("accepts only known answers", () => {
    expect(parseAnswers({ goal: "posts", volume: "few", team: "solo" })).toEqual({ goal: "posts", volume: "few", team: "solo" });
    expect(parseAnswers({ goal: "posts", volume: "few" })).toBeNull();
    expect(parseAnswers({ goal: "hack", volume: "few", team: "solo" })).toBeNull();
    expect(QUIZ_QUESTIONS.map((q) => q.key)).toEqual(["goal", "volume", "team"]);
  });

  it("keeps a plan key from the cookie and nothing else", () => {
    expect(pickedPlanKey("BUSINESS")).toBe("BUSINESS");
    expect(pickedPlanKey("CUSTOM-ab12")).toBeNull(); // lower case: never a sellable key
    for (const bad of [null, undefined, "", "business", "<script>", "A".repeat(60), "BUSINESS; path=/"]) expect(pickedPlanKey(bad)).toBeNull();
  });
});

describe("pricing page pieces", () => {
  it("the quiz starts on its first question with the region's plans", () => {
    const html = renderToStaticMarkup(createElement(PlanQuiz, { plans: PLANS }));
    expect(html).toContain("Pick your plan in 30 seconds");
    expect(html).toContain("What do you want most?");
    expect(html).not.toContain("Our suggestion");
  });

  it("the Mobile Money steps show the region's own prices and only where Mobile Money is taken", () => {
    const html = renderToStaticMarkup(createElement(MomoSteps, { plans: [starter, business], paymentMethods: ["momo", "card"] }));
    expect(html).toContain("Pay with MTN MoMo or Airtel Money");
    expect(html).toContain("15,123 RWF");
    expect(html).toContain("50,456 RWF");
    expect(html).toContain("Choose Card at step 2");
    expect(renderToStaticMarkup(createElement(MomoSteps, { plans: [starter], paymentMethods: ["momo"] }))).not.toContain("Choose Card");
    expect(renderToStaticMarkup(createElement(MomoSteps, { plans: [starter], paymentMethods: ["card"] }))).toBe("");
  });

  it("hard-codes no price: the quiz, the steps and the page read the plans", () => {
    for (const f of ["app/(marketing)/pricing/plan-quiz.tsx", "app/(marketing)/pricing/momo-steps.tsx", "app/(marketing)/pricing/page.tsx", "lib/plan-quiz.ts"]) {
      const src = readFileSync(join(__dirname, "..", "..", f), "utf8");
      expect(src, f).not.toMatch(/\b(15|35|50)[,_]?000\b/);
    }
  });
});
