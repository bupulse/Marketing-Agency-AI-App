import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENCY_WAITLIST_HREF } from "@/components/marketing/home/agency";
import { Numbers, PlansTeaser } from "@/components/marketing/home/sections";
import { cleanReturn } from "@/lib/auth/return-path";
import type { RegionalPlan } from "@/lib/region-prices";

// The home page tells a story; prices live on /pricing (owner, 11 November 2026). Also: AI presenter ads are in the
// Business plans (2 a month), BuPulse Agency is "coming soon" with a waiting list, and the designs wall uses posts made
// by BuPulse's own design engine.

const plan = (over: Partial<RegionalPlan>): RegionalPlan =>
  ({
    key: "BUSINESS",
    name: "Business",
    description: "",
    isTrial: false,
    trialDays: null,
    highlight: false,
    monthlyPriceCents: 50_000,
    yearlyPriceCents: 500_000,
    currency: "RWF",
    limits: { chat: 500 },
    highlights: [],
    features: ["dailyPosts", "websiteChat"],
    regionKey: "RW",
    paymentMethods: ["momo", "card"],
    card: null,
    ...over,
  }) as unknown as RegionalPlan;

const plans = [plan({ key: "STARTER", name: "Starter", monthlyPriceCents: 15_000 }), plan({}), plan({ key: "BUSINESS_PRO", name: "Business Pro", monthlyPriceCents: 80_000 })];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("home page: no prices", () => {
  it("the numbers never show a price or a currency", () => {
    for (const mode of ["quote", "trial"] as const) {
      const out = text(renderToStaticMarkup(createElement(Numbers, { plans, mode })));
      expect(out).not.toMatch(/RWF|\$|15,000|50,000|80,000|a month to start/);
      expect(out).toContain("post a day");
    }
  });

  it("Rwanda's numbers say the Business plans include 2 AI presenter ads a month; elsewhere they don't", () => {
    expect(text(renderToStaticMarkup(createElement(Numbers, { plans, mode: "quote" })))).toMatch(/2 AI presenter ads a month with the Business and Business Pro plans/);
    expect(text(renderToStaticMarkup(createElement(Numbers, { plans, mode: "trial" })))).not.toMatch(/AI presenter/);
  });

  it("the plans card sends people to /pricing instead", () => {
    const html = renderToStaticMarkup(createElement(PlansTeaser));
    expect(html).toContain('href="/pricing"');
    expect(text(html)).toContain("See plans and prices");
    expect(text(html)).not.toMatch(/RWF|\$\d/);
  });

  it("never promises talking skits a week (coming soon until they are switched on)", () => {
    const out = text(renderToStaticMarkup(createElement(Numbers, { plans: plans.map((p) => ({ ...p, limits: { ...p.limits, skitsPerWeek: 3 } })), mode: "quote" })));
    expect(out).not.toMatch(/skits/i);
  });
});

describe("BuPulse Agency, coming soon", () => {
  it("'Tell me when it's ready' signs up, then opens the service pick with Agency ticked", () => {
    const url = new URL(AGENCY_WAITLIST_HREF, "https://bupulse.com");
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("next")).toBe("/apps/start?want=agency");
    // The sign-up keeps it as the place to go next (a same-site path).
    expect(cleanReturn(url.searchParams.get("next"))).toBe("/apps/start?want=agency");
  });
});

describe("designs wall", () => {
  const ids = ["salon", "cafe", "hardware", "school", "construction", "phones", "tips", "music", "features", "clinic", "sunday", "gym"];
  it("ships every post and story, small enough for phones", () => {
    let bytes = 0;
    for (const id of [...ids, "salon-story", "phones-story", "cafe-story", "hardware-story"]) {
      const file = path.join(process.cwd(), "public/marketing/posts", `${id}.webp`);
      expect(existsSync(file), file).toBe(true);
      bytes += statSync(file).size;
    }
    expect(bytes).toBeLessThan(400_000);
  });
});
