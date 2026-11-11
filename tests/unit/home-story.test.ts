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

// Round 3 (owner, 11 November 2026): no placeholder visuals. Every picture is a real image: posts from BuPulse's
// design engine, stills from BuPulse's own ads, or AI photos made with the app's image model.
describe("real images, no placeholders", () => {
  const size = (rel: string) => {
    const file = path.join(process.cwd(), "public/marketing", rel);
    expect(existsSync(file), file).toBe(true);
    return statSync(file).size;
  };

  it("the salon's week has a finished post for every day, in two sizes, and a logo instead of a letter", () => {
    let phone = 0;
    for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      size(`week/${d}-300.webp`);
      phone += size(`week/${d}-600.webp`);
    }
    // A 2x phone loads the 600 px files: the whole week stays small.
    expect(phone).toBeLessThan(200_000);
    expect(size("week/salon-logo.webp")).toBeLessThan(6_000);
  });

  it("industry cards, feature cards, AI ad steps, the agency section and blog covers have their photos", () => {
    for (const slug of ["beauty", "restaurants", "retail", "construction", "electronics"]) {
      expect(size(`photos/industry-${slug}-480.webp`)).toBeLessThan(40_000);
      size(`photos/industry-${slug}-720.webp`);
    }
    for (const f of ["feature-business", "feature-chat", "blog-photo", "blog-chat", "blog-plan"]) {
      expect(size(`photos/${f}-480.webp`)).toBeLessThan(40_000);
      size(`photos/${f}-720.webp`);
    }
    size("photos/agency-480.webp");
    size("photos/agency-880.webp");
    for (const n of [1, 2, 3, 4]) expect(size(`avatar/step-${n}.webp`)).toBeLessThan(12_000);
    size("posts/hardware-thumb.webp");
    size("posts/hardware-logo.webp");
  });
});

describe("the week of posts", () => {
  it("shows seven real posts with alt text and the salon's logo, not icons on gradients or a letter avatar", async () => {
    const { WeekOfPosts } = await import("@/components/marketing/home/week-of-posts");
    const html = renderToStaticMarkup(createElement(WeekOfPosts));
    const posts = html.match(/<img[^>]*class="wk-post"[^>]*>/g) ?? [];
    expect(posts).toHaveLength(7);
    for (const img of posts) {
      expect(img).toMatch(/srcSet="[^"]*-300\.webp 300w, [^"]*-600\.webp 600w"/);
      expect(img).toMatch(/alt="[^"]{20,}"/);
      expect(img).toContain('loading="lazy"');
    }
    expect((html.match(/salon-logo\.webp/g) ?? []).length).toBe(7);
    expect(html).not.toMatch(/linear-gradient|wk-icon|lucide/);
  });
});
