import { describe, expect, it } from "vitest";
import { buildWeekPlan } from "@/lib/autopilot/planner";
import type { WriteRequest, WrittenVersion } from "@/lib/autopilot/writer";
import { getIdea } from "@/lib/autopilot/playbook";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { autopilotCases, planInputFor } from "./autopilot-cases";
import { checkGroup, checkImageText, checkVersion } from "./autopilot-checks";

// Quality check: plans a week for 5 varied businesses and writes every post with the real model,
// then checks each network's version against its rules. Runs only with AI_EVAL=1 and a real
// GEMINI_API_KEY (npm run ai:eval:autopilot); it costs a few cents.
const key = process.env.GEMINI_API_KEY;
const enabled = process.env.AI_EVAL === "1" && !!key && key !== "placeholder";

let totalCost = 0;
let totalGroups = 0;

describe.skipIf(!enabled)("Autopilot quality (5 businesses, one week each)", () => {
  it.each(autopilotCases.map((c) => [c.id, c] as const))(
    "%s",
    async (_id, c) => {
      const { getTextProvider } = await import("@/lib/ai");
      const { withLedger } = await import("@/lib/ai/ledger");
      const { writeGroup } = await import("@/lib/autopilot/writer");

      const plan = buildWeekPlan(planInputFor(c));
      expect(plan.groups.length).toBeGreaterThanOrEqual(3);

      const provider = getTextProvider();
      const problems: string[] = [];
      for (const g of plan.groups) {
        const targets = g.networks.map((network) => ({ network, format: g.posts.find((p) => p.network === network)!.format }));
        const request: WriteRequest = {
          brand: c.brand,
          idea: g.idea,
          facts: {
            project: g.project && { type: g.project.type, title: g.project.title, price: g.project.price, features: g.project.features, notes: g.project.notes },
            faq: g.faq,
            holiday: g.holiday && { name: g.holiday.name, date: g.holiday.date },
            date: g.day,
          },
          targets,
        };
        const written = await withLedger(
          { feature: "eval" },
          { provider: provider.name, model: "unknown" },
          () => writeGroup(provider, request),
          (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
        );
        totalCost += estimateCostUsd(written.model, written.usage);
        totalGroups += 1;
        for (const v of written.versions) problems.push(...checkVersion(v, targets.find((t) => t.network === v.network)!.format, request).map((p) => `[${g.idea.id}] ${p}`));
        problems.push(...checkGroup(written.versions).map((p) => `[${g.idea.id}] ${p}`));
        if (g.idea.template) problems.push(...checkImageText(written.image, request).map((p) => `[${g.idea.id}] ${p}`));
      }
      expect(problems).toEqual([]);
    },
    240_000,
  );

  it("reports the cost of a planned week", () => {
    const perGroup = totalGroups ? totalCost / totalGroups : 0;
    console.log(`Autopilot eval: ${totalGroups} post groups, $${totalCost.toFixed(4)} total, $${perGroup.toFixed(4)} per group, about $${(perGroup * 4).toFixed(4)} per 4-post week`);
    expect(totalGroups).toBeGreaterThan(0);
  });
});

// These run always: they keep the checker itself honest without any API call.
describe("autopilot eval checks", () => {
  const c = autopilotCases[0];
  const req: WriteRequest = {
    brand: c.brand,
    idea: getIdea("offer-promo")!,
    facts: { project: { type: "product", title: "Galaxy A55 128GB", price: "420,000 RWF", features: ["Dual SIM"] }, date: "2026-10-13" },
    targets: [],
  };
  const li = (text: string, hashtags: string[] = ["#a", "#b"]): WrittenVersion => ({ network: "linkedin", title: null, text, hashtags });

  it("has 5 cases with unique ids and a plan for each", () => {
    expect(autopilotCases).toHaveLength(5);
    expect(new Set(autopilotCases.map((x) => x.id)).size).toBe(5);
    for (const x of autopilotCases) expect(buildWeekPlan(planInputFor(x)).groups.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores list numbering but not other numbers", () => {
    const base = "Voici comment nous travaillons pour vous avec les familles et nous les aidons dans leur choix.\n\n";
    expect(checkVersion(li(`${base}1. Premier pas\n2) Deuxième pas\n3. Troisième pas ${"avec nous ".repeat(30)}`), "POST", req).join("|")).not.toMatch(/not in the facts/);
    expect(checkVersion(li(`${base}Premier pas en 3 jours ${"avec nous ".repeat(30)}`), "POST", req).join("|")).toMatch(/"3"/);
  });

  it("accepts a good LinkedIn post", () => {
    const text = "At TechHub Kigali we know the Galaxy A55 128GB is the phone many of you asked about. It has Dual SIM and costs 420,000 RWF. ".repeat(3) + "Drop in and see it for the price of your next lunch with the team, or message us to reserve one for you and your family today.";
    expect(checkVersion(li(text), "POST", req)).toEqual([]);
  });

  it("flags invented numbers, hashtags in the text, short LinkedIn posts and a missing network feel", () => {
    const problems = checkVersion(li("Only 99,000 RWF for the Galaxy A55! #deal", ["#a", "#b", "#c", "#d"]), "POST", req).join("|");
    expect(problems).toMatch(/99000/);
    expect(problems).toMatch(/text contains hashtags/);
    expect(problems).toMatch(/more than 3 hashtags/);
    expect(problems).toMatch(/only \d+ characters/);
  });

  it("flags scripts without timestamps and identical versions", () => {
    const script: WrittenVersion = { network: "tiktok", title: null, text: "Show the phone and talk about it for you.", hashtags: [] };
    expect(checkVersion(script, "SCRIPT", req).join("|")).toMatch(/without timestamps/);
    const same = "Come and see the new phone at our shop this week and tell your friends all about it";
    expect(checkGroup([li(same), { ...li(same), network: "facebook" }]).join("|")).toMatch(/read almost the same/);
    expect(checkGroup([li(same), { ...li("Bonjour tout le monde, nous ouvrons un nouveau rayon de coques colorées"), network: "facebook" }])).toEqual([]);
  });

  it("flags image text with numbers that are not in the facts", () => {
    expect(checkImageText({ kicker: "", headline: "Galaxy A55", subline: "", chip: "420,000 RWF" }, req)).toEqual([]);
    expect(checkImageText({ kicker: "", headline: "Galaxy A55", subline: "", chip: "-40%" }, req).join("|")).toMatch(/"40"/);
  });
});
