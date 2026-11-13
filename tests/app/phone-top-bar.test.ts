import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceSwitcher } from "@/components/platform/service-switcher";

// The Marketing top bar keeps to one row on a 390 px phone (QA 13 Nov: with the service switcher it wrapped onto two
// rows): menu, logo, switcher, theme, bell, Add product and the account menu, all 44 px icon buttons below sm.
describe("phone top bar", () => {
  it("the service switcher is a 44 px icon button on a phone", () => {
    const html = renderToStaticMarkup(createElement(ServiceSwitcher, { chooser: "https://bupulse.com/apps?all=1", agencyPicked: false }));
    expect(html).toMatch(/aria-label="Switch BuPulse service[^"]*"[^>]*class="[^"]*max-sm:w-11 max-sm:px-0/);
    expect(html).toMatch(/<span class="hidden sm:inline">Marketing<\/span>/);
    expect(html).toMatch(/lucide-chevron-down[^"]*max-sm:hidden|max-sm:hidden[^"]*lucide-chevron-down/);
  });

  it("the account menu hides its chevron and the actions use small gaps below sm", () => {
    const shell = readFileSync(join(__dirname, "..", "..", "components", "app", "app-shell.tsx"), "utf8");
    const account = shell.slice(shell.indexOf('aria-label="Account menu"'), shell.indexOf('aria-label="Account menu"') + 600);
    expect(account).toContain("pr-1 sm:pr-2.5");
    expect(account).toContain("max-sm:hidden");
    expect(shell).toContain('<div className="flex items-center gap-1.5 sm:gap-2.5">');
  });
});
