import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { currentPeriod, viewsPerDay } from "@/lib/creators/analytics";
import { campaignSchema, inviteMessage, isMention, limitsInWords, mentionsFrom, payRulesInWords, taskSpans, whatsappLink, type CampaignInput } from "@/lib/creators/company-forms";
import { isSlug, slugify, uniqueSlug } from "@/lib/creators/slug";

const campaign = (over: Partial<CampaignInput> = {}): CampaignInput => ({
  name: "Kigali summer",
  brief: "Show our juice on a hot day.",
  platforms: ["instagram", "tiktok"],
  startsOn: "2026-11-01",
  endsOn: "2026-11-30",
  mentions: ["@leaf", "#leafsummer"],
  currency: "RWF",
  payRules: { ratePerThousand: 2000 },
  questions: [],
  ...over,
});
const problem = (input: CampaignInput) => {
  const r = campaignSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].message;
};

describe("the campaign form", () => {
  it("takes a campaign that pays and refuses rules that pay nothing", () => {
    expect(problem(campaign())).toBeNull();
    expect(problem(campaign({ payRules: { capPerCreator: 1000 } }))).toMatch(/Set how creators earn/);
    expect(problem(campaign({ payRules: { feePerPost: 500 } }))).toBeNull();
    expect(problem(campaign({ payRules: { milestones: [{ views: 1000, amount: 10 }, { views: 1000, amount: 20 }] } }))).toMatch(/same number of views/);
  });

  it("checks the dates, the platforms and the mentions", () => {
    expect(problem(campaign({ endsOn: "2026-10-31" }))).toMatch(/on or after the first day/);
    expect(problem(campaign({ endsOn: "2027-12-31" }))).toMatch(/a year at most/);
    expect(problem(campaign({ platforms: [] }))).toMatch(/at least one platform/);
    expect(problem(campaign({ mentions: ["leaf"] }))).toMatch(/"leaf" is not a mention/);
    expect(isMention("https://leaf.rw/summer")).toBe(true);
    expect(isMention("#ImpesheKigali")).toBe(true);
    expect(mentionsFrom("@leaf, #summer  @LEAF\n#summer")).toEqual(["@leaf", "#summer"]);
  });
});

describe("task spans (one for the whole month, one per week, one per day)", () => {
  it("splits the span", () => {
    expect(taskSpans("2026-11-01", "2026-11-30", "none")).toEqual([{ startsOn: "2026-11-01", endsOn: "2026-11-30" }]);
    const weeks = taskSpans("2026-11-01", "2026-11-30", "week");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual({ startsOn: "2026-11-01", endsOn: "2026-11-07" });
    expect(weeks.at(-1)).toEqual({ startsOn: "2026-11-29", endsOn: "2026-11-30" });
    expect(taskSpans("2026-11-01", "2026-11-03", "day").map((s) => s.startsOn)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(taskSpans("2026-11-03", "2026-11-01", "day")).toEqual([]);
  });
});

describe("slugs of the public page /c/<slug>", () => {
  it("are lowercase words with dashes, made unique when taken", async () => {
    expect(slugify("Kigali Summer Challenge!")).toBe("kigali-summer-challenge");
    expect(slugify("Café  Ndéjé -- 2026")).toBe("cafe-ndeje-2026");
    expect(isSlug("cafe-ndeje-2026")).toBe(true);
    expect(isSlug("Cafe--x")).toBe(false);
    expect(await uniqueSlug("Kigali Summer", async () => false)).toBe("kigali-summer");
    const taken = new Set(["kigali-summer"]);
    expect(await uniqueSlug("Kigali Summer", async (s) => taken.has(s))).toMatch(/^kigali-summer-[a-z0-9]{5}$/);
    expect(await uniqueSlug("!!", async () => false)).toBe("campaign");
    expect(await uniqueSlug("Go", async () => false)).toMatch(/^go-[a-z0-9]{5}$/);
  });
});

describe("plain words", () => {
  it("say the pay rules and the limits that cut pay", () => {
    expect(payRulesInWords({ ratePerThousand: 2000, milestones: [{ views: 10000, amount: 5000 }], feePerPost: 500, capPerCreator: 100000 }, "RWF")).toEqual([
      "2,000 RWF for every 1,000 views",
      "5,000 RWF once, when a post reaches 10,000 views",
      "500 RWF for every post handed in",
      "At most 100,000 RWF per creator in a pay period",
    ]);
    expect(limitsInWords(["budget"])[0]).toMatch(/budget is reached/);
  });

  it("builds the WhatsApp link of an invite", () => {
    const text = inviteMessage("Aline Uwase", "Summer", "LEAF", "https://bupulse.com/creator/join/abc");
    expect(text).toMatch(/^Hi Aline, LEAF picked you for "Summer"\./);
    expect(whatsappLink("+250 780 000 001", text)).toBe(`https://wa.me/250780000001?text=${encodeURIComponent(text)}`);
    expect(whatsappLink(null, text)).toBeNull();
  });
});

describe("analytics helpers", () => {
  it("counts views gained per day in the company's timezone, carrying the last reading", () => {
    const at = (iso: string) => new Date(iso);
    const snaps = [
      { postId: "a", capturedAt: at("2026-10-31T20:00:00Z"), views: 100 }, // before the chart: its start
      { postId: "a", capturedAt: at("2026-10-31T23:00:00Z"), views: 300 }, // 1 Nov in Kigali
      { postId: "b", capturedAt: at("2026-11-01T10:00:00Z"), views: 50 },
      { postId: "a", capturedAt: at("2026-11-03T10:00:00Z"), views: 400 },
    ];
    expect(viewsPerDay(snaps, "2026-11-01", "2026-11-03", "Africa/Kigali")).toEqual([
      { start: "2026-11-01", views: 250 },
      { start: "2026-11-02", views: 0 },
      { start: "2026-11-03", views: 100 },
    ]);
  });

  it("picks the period running now, else the first before the campaign and the last after it", () => {
    const p = (i: number) => ({ i, startsAt: new Date(Date.UTC(2026, 10, 1 + 30 * (i - 1))), endsAt: new Date(Date.UTC(2026, 10, 1 + 30 * i)) });
    const periods = [p(2), p(1)];
    expect(currentPeriod(periods, new Date("2026-12-05T00:00:00Z"))?.i).toBe(2);
    expect(currentPeriod(periods, new Date("2026-10-01T00:00:00Z"))?.i).toBe(1);
    expect(currentPeriod(periods, new Date("2027-06-01T00:00:00Z"))?.i).toBe(2);
    expect(currentPeriod([], new Date())).toBeNull();
  });
});
