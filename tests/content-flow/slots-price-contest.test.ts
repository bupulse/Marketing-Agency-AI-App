import { describe, expect, it } from "vitest";
import { applyContest, CONTEST_NOTE, contestBlocked, contestConfirmSchema, contestDraftText, hasContestPlaceholders, RULES_LINE } from "@/lib/content-flow/contest";
import { mentionsPrice, priceAngleAllowed, priceSlots, stripPrice, withoutPriceLines } from "@/lib/content-flow/price";
import { assignAngles, postsPerApp } from "@/lib/content-flow/slots";
import { validatePost } from "@/lib/publishing/validate";
import { postsPerAppLimit, SEED_PLANS } from "@/lib/plans";

describe("posts per app per day", () => {
  it("plans: trial and Standard 1, Pro 3; a plan saved before the limit gets 1; at most 10", () => {
    expect(postsPerAppLimit(SEED_PLANS.TRIAL.limits)).toBe(1);
    expect(postsPerAppLimit(SEED_PLANS.STANDARD.limits)).toBe(1);
    expect(postsPerAppLimit(SEED_PLANS.PRO.limits)).toBe(3);
    expect(postsPerAppLimit({})).toBe(1);
    expect(postsPerAppLimit({ postsPerAppPerDay: 40 })).toBe(10);
  });

  it("makes the owner's number per app within the limit, counting what the subject already has today", () => {
    const r = postsPerApp({ networks: ["instagram", "facebook", "linkedin"], perApp: 3, limit: 3, madeToday: { instagram: 1, linkedin: 3 } });
    expect(r.slots.filter((n) => n === "instagram")).toHaveLength(2);
    expect(r.slots.filter((n) => n === "facebook")).toHaveLength(3);
    expect(r.slots).not.toContain("linkedin");
    expect(r.skipped).toEqual([{ network: "linkedin", reason: "LinkedIn already has 3 posts for today (your plan allows 3 per app a day)." }]);
    // Every app once before any app twice.
    expect(r.slots.slice(0, 2).sort()).toEqual(["facebook", "instagram"]);
    expect(postsPerApp({ networks: ["instagram"], perApp: 5, limit: 1, madeToday: {} }).slots).toEqual(["instagram"]);
  });

  it("gives each post the idea that suits its app, ideas distinct", () => {
    const out = assignAngles(["playful", "myth-fact", "how-it-works"], ["linkedin", "tiktok", "instagram"]);
    expect(out.find((o) => o.network === "linkedin")!.angle).toBe("myth-fact");
    expect(out.find((o) => o.network === "tiktok")).toMatchObject({ angle: "how-it-works", format: "video" });
    expect(new Set(out.map((o) => o.angle)).size).toBe(3);
  });
});

describe("price choice", () => {
  it("AI decides: at most one price post, only when none of the last 3 showed the price", () => {
    expect(priceSlots("auto", ["price", "tips", "poll"], [false, false, false, true], true)).toEqual([true, false, false]);
    expect(priceSlots("auto", ["price", "tips"], [false, true], true)).toEqual([false, false]);
    expect(priceAngleAllowed("auto", [true], true)).toBe(false);
    expect(priceAngleAllowed("auto", [false, false, false, true], true)).toBe(true);
  });

  it("With price: every post; No price: none; never without a price", () => {
    expect(priceSlots("with", ["tips", "poll"], [true], true)).toEqual([true, true]);
    expect(priceSlots("none", ["price", "poll"], [], true)).toEqual([false, false]);
    expect(priceSlots("with", ["tips"], [], false)).toEqual([false]);
    expect(priceAngleAllowed("none", [], true)).toBe(false);
  });

  it("finds and strips the price from captions and product blocks", () => {
    expect(mentionsPrice("Only 15,000 RWF this week!", "15,000 RWF")).toBe(true);
    expect(mentionsPrice("Only 15000 RWF", "15 000 RWF")).toBe(true);
    expect(mentionsPrice("Open 7 days a week", "15,000 RWF")).toBe(false);
    expect(stripPrice("Grow greens at school. Only 15,000 RWF! Ask us today.", "15,000 RWF")).toBe("Grow greens at school. Ask us today.");
    expect(withoutPriceLines("Name: Tower\nPrice: 15,000 RWF\nFeatures: 40 plants")).toBe("Name: Tower\nFeatures: 40 plants");
  });
});

describe("contests need the owner's prize and rules", () => {
  const draft = contestDraftText("Make the best 30 s video about our tower and win [PRIZE]!");

  it("keeps placeholders and adds a short rules line; never a prize of its own", () => {
    expect(draft).toContain(RULES_LINE);
    expect(hasContestPlaceholders(draft)).toBe(true);
    expect(contestDraftText(`Win [PRIZE]. ${RULES_LINE}`)).toBe(`Win [PRIZE]. ${RULES_LINE}`);
  });

  it("cannot be scheduled, approved or published while placeholders remain or it is unconfirmed", () => {
    expect(validatePost({ network: "facebook", label: "Facebook", maxText: 5000, requiresMedia: false, maxImages: 10, formats: ["POST"], videoOnly: false } as never, { format: "POST", text: draft, hashtags: [], mediaCount: 0 }).errors).toContain(CONTEST_NOTE);
    expect(contestBlocked({ text: draft, contest: {} })).toBe(true);
    expect(contestBlocked({ text: "Win 50,000 RWF", contest: {} })).toBe(true);
    expect(contestBlocked({ text: "Win 50,000 RWF", contest: { confirmedAt: "2026-10-13T10:00:00Z" } })).toBe(false);
    expect(contestBlocked({ text: "A normal post", contest: null })).toBe(false);
  });

  it("the owner's prize, end date and rule replace the placeholders; the owner must confirm paying", () => {
    const text = applyContest(draft, { prize: "50,000 RWF", endsOn: "2026-10-16", howChosen: "Most likes by Friday 18:00" });
    expect(text).toContain("win 50,000 RWF!");
    expect(text).toContain("Rules: Most likes by Friday 18:00. Ends Friday 16 October. Prize: 50,000 RWF.");
    expect(hasContestPlaceholders(text)).toBe(false);
    expect(contestConfirmSchema.safeParse({ prize: "50,000 RWF", endsOn: "2026-10-16", howChosen: "Most likes", willPay: false }).success).toBe(false);
    expect(contestConfirmSchema.safeParse({ prize: "[PRIZE]", endsOn: "2026-10-16", howChosen: "Most likes", willPay: true }).success).toBe(false);
  });
});
