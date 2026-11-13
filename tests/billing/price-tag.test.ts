import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriceTag } from "@/components/billing/price-tag";

// The plan price on the pricing and billing pages. Monthly shows only the monthly price; the crossed-out "Was" price
// and the "% off" badge belong to yearly. They used to stay in the page (faded out) in the monthly view, so the
// pricing page's text said "Was 180,000 RWF, 17% off" next to Starter's 15,000 RWF a month (owner, 11 Nov 2026).
const starter = { monthlyPriceCents: 15_000, yearlyPriceCents: 150_000, currency: "RWF" };

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("PriceTag", () => {
  it("monthly shows the monthly price and no yearly comparison", () => {
    const out = text(renderToStaticMarkup(createElement(PriceTag, { plan: starter, interval: "MONTH" })));
    expect(out).toContain("15,000 RWF");
    expect(out).toContain("/ month");
    expect(out).not.toMatch(/Was/);
    expect(out).not.toMatch(/% off/);
    expect(out).not.toContain("180,000");
  });

  it("yearly shows what 12 months would cost, the yearly price and the saving", () => {
    const out = text(renderToStaticMarkup(createElement(PriceTag, { plan: starter, interval: "YEAR" })));
    expect(out).toContain("Was 180,000 RWF");
    expect(out).toContain("17% off");
    expect(out).toContain("150,000 RWF");
    expect(out).toContain("/ year");
  });

  it("keeps the same height either way (the line is there, empty when monthly)", () => {
    const monthly = renderToStaticMarkup(createElement(PriceTag, { plan: starter, interval: "MONTH" }));
    expect(monthly).toContain("min-h-6");
  });

  it("never breaks the price itself: '/ month' wraps under it in narrow cards", () => {
    for (const size of ["lg", "md", "sm"] as const) {
      const html = renderToStaticMarkup(createElement(PriceTag, { plan: starter, interval: "MONTH", size }));
      expect(html).toMatch(/<p class="flex flex-wrap items-baseline[^"]*"><span class="[^"]*whitespace-nowrap/);
      expect(html).toMatch(/<span class="whitespace-nowrap text-muted[^"]*">\/ month/);
    }
  });
});
