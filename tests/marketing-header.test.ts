import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "@/components/marketing/site-header";
import { ThemeProvider } from "@/components/theme";

// The header must sit on one line at every width from 320 to 1440 px: the full nav only from lg (1024 px, where the
// links and both buttons fit), the menu below it, and no label may wrap onto two lines.
describe("marketing header", () => {
  const html = renderToStaticMarkup(createElement(ThemeProvider, null, createElement(SiteHeader)));

  it("shows the links and Log in only from lg, and the menu below lg", () => {
    expect(html).toMatch(/<ul class="[^"]*hidden[^"]*lg:flex/);
    expect(html).toMatch(/class="[^"]*hidden[^"]*lg:inline-flex[^"]*"[^>]*>Log in|href="\/login"[^>]*class="[^"]*lg:inline-flex/);
    expect(html).toContain('class="lg:hidden"');
    expect(html).not.toMatch(/\bmd:(flex|inline-flex|hidden)\b/);
  });

  it("never wraps a nav label or button", () => {
    expect(html).toContain("Done-for-you");
    for (const m of html.matchAll(/<a [^>]*href="(\/#features|\/industries|\/pricing|\/done-for-you|\/blog)"[^>]*class="([^"]*)"|<a [^>]*class="([^"]*)"[^>]*href="(\/#features|\/industries|\/pricing|\/done-for-you|\/blog)"/g)) {
      const cls = m[2] ?? m[3];
      if (cls.includes("rounded-full")) expect(cls).toContain("whitespace-nowrap");
    }
  });

  it("keeps the theme toggle and the demo button outside the menu", () => {
    expect(html).toMatch(/Book a demo/);
    expect(html).toMatch(/Book a free demo/);
    expect(html).toMatch(/hidden whitespace-nowrap sm:inline-flex/); // phones (under 640 px): the demo button is in the menu, so the menu button always fits
  });
});
