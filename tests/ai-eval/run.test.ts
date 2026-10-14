import { describe, expect, it } from "vitest";
import { evalCases } from "./businesses";
import { checkContent } from "./checks";

// Quality check: generates for 20 example businesses against the real model and checks the
// output. Runs only with AI_EVAL=1 and a real GEMINI_API_KEY (npm run ai:eval); skipped otherwise,
// so normal test runs and CI without the secret never call the API.
const key = process.env.GEMINI_API_KEY;
const enabled = process.env.AI_EVAL === "1" && !!key && key !== "placeholder";

describe.skipIf(!enabled)("AI content quality (20 example businesses)", () => {
  it.each(evalCases.map((c) => [c.id, c] as const))(
    "%s",
    async (_id, c) => {
      const { getTextProvider } = await import("@/lib/ai");
      const { withLedger } = await import("@/lib/ai/ledger");
      const { generateMarketingContent } = await import("@/lib/ai/marketing");

      const provider = getTextProvider();
      const result = await withLedger(
        { feature: "eval" },
        { provider: provider.name, model: "unknown" },
        () => generateMarketingContent(provider, c.brand, c.project),
        (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
      );
      expect(checkContent(c, result.content)).toEqual([]);
    },
    90_000,
  );
});

// These run always: they keep the checker itself honest without any API call.
describe("eval checks", () => {
  const c = evalCases.find((x) => x.id === "phone-shop")!;
  const good = {
    caption: "TechHub Kigali brings you the Galaxy A55 128GB for the price of 420,000 RWF. Visit us today and get yours.",
    hashtags: ["#a","#b","#c","#d","#e","#f","#g","#h"],
    videoScript: "0-5s: Open on the phone. Voiceover: for you and your friends.",
    adHeadlines: ["Galaxy A55 is here", "Upgrade with TechHub", "Your new phone awaits"],
  };

  it("has 20 cases with unique ids", () => {
    expect(evalCases).toHaveLength(20);
    expect(new Set(evalCases.map((x) => x.id)).size).toBe(20);
  });

  it("accepts good content", () => {
    expect(checkContent(c, good)).toEqual([]);
  });

  it("flags invented numbers, long headlines and too few hashtags", () => {
    const problems = checkContent(c, {
      ...good,
      caption: "TechHub Kigali: only 99,000 RWF for the Galaxy A55 and the best for you.",
      hashtags: ["#a"],
      adHeadlines: ["x".repeat(41), "ok"],
    });
    expect(problems.join("|")).toMatch(/99000/);
    expect(problems.join("|")).toMatch(/headline over 40/);
    expect(problems.join("|")).toMatch(/2 headlines \(want exactly 3\)/);
    expect(problems.join("|")).toMatch(/hashtags/);
  });

  it("flags content in the wrong language", () => {
    const fr = evalCases.find((x) => x.id === "school")!;
    const problems = checkContent(fr, { ...good, caption: "Come to Lycée Les Cèdres open day.", hashtags: good.hashtags });
    expect(problems.join("|")).toMatch(/does not look like French/);
  });
});
