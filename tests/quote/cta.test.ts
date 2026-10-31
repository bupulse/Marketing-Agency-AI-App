import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The quote form's server action is not needed to render the buttons.
vi.mock("@/components/marketing/quote/quote-action", () => ({ submitQuoteForm: vi.fn() }));

import { CtaButton, CtaProvider, ForCta } from "@/components/marketing/quote/cta";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { ctaModeForRegion, type CtaMode } from "@/lib/quote/cta";

const render = (mode: CtaMode | null, node: ReactNode) => renderToStaticMarkup(mode ? createElement(CtaProvider, { mode } as Parameters<typeof CtaProvider>[0], node) : createElement("div", null, node));

describe("which call to action a visitor gets", () => {
  it("Rwanda gets the free quote, every other region the free trial", () => {
    expect(ctaModeForRegion("RW")).toBe("quote");
    expect(ctaModeForRegion("rw")).toBe("quote");
    for (const key of ["EAC", "GLOBAL", "", null, undefined]) expect(ctaModeForRegion(key)).toBe("trial");
  });
});

describe("the main button", () => {
  it("in Rwanda opens the quote pop-up and has no trial link at all", () => {
    const html = render("quote", createElement(CtaButton, {}));
    expect(html).toContain("Get a free quote");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("/signup");
    expect(html).not.toMatch(/free trial/i);
    // The pop-up is there, closed until the button is pressed.
    expect(html).toContain("<dialog");
  });

  it("elsewhere is the free trial link, as before", () => {
    const html = render("trial", createElement(CtaButton, {}));
    expect(html).toContain('href="/signup"');
    expect(html).toContain("Start your free trial");
    expect(html).not.toContain("Get a free quote");
    expect(html).not.toContain("<dialog");
  });

  it("is the free trial outside the marketing layout (no provider)", () => {
    expect(render(null, createElement(CtaButton, {}))).toContain('href="/signup"');
  });

  it("keeps a page's own trial link and label (the custom plan) outside Rwanda", () => {
    const props = { trialHref: "/signup?next=%2Fcustom-plan", trialLabel: "Request a custom plan" };
    expect(render("trial", createElement(CtaButton, props))).toContain('href="/signup?next=%2Fcustom-plan"');
    const rw = render("quote", createElement(CtaButton, props));
    expect(rw).toContain("Get a free quote");
    expect(rw).not.toContain("custom-plan");
  });

  it("switches the lines that talk about the trial", () => {
    const el = createElement(ForCta, { trial: "Free trial, no card needed", quote: "We call you back" });
    // The provider adds its (closed) pop-up after the page.
    expect(render("quote", el).startsWith("We call you back<dialog")).toBe(true);
    expect(render("quote", el)).not.toContain("Free trial");
    expect(render("trial", el)).toBe("Free trial, no card needed");
  });

  it("the home page's closing banner follows the region", () => {
    expect(render("quote", createElement(FinalCta))).not.toContain("/signup");
    expect(render("quote", createElement(FinalCta))).toContain("Get a free quote");
    expect(render("trial", createElement(FinalCta))).toContain('href="/signup"');
  });
});
