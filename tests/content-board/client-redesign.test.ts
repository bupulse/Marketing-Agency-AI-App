import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChoiceCards, ChoiceChips } from "@/components/app/kit/a-choice-cards";

// The client dashboard redesign (12 Nov 2026): Posts split into Today + All posts, choice chips instead of selects,
// and the dev-only preview of the redesigned pages.
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Posts split", () => {
  it("sends any link with filters or a period to All posts, keeping its query", () => {
    const src = read("app/dashboard/content/page.tsx");
    for (const key of ["app", "status", "auto", "view", "day", "q", "sort", "range"]) expect(src).toContain(`"${key}"`);
    expect(src).toContain("redirect(`/dashboard/content/all?${keep.toString()}`)");
    expect(src).toContain("<TodayReview");
  });

  it("All posts has the period bar, the filters, Schedule all and the grid, on its own path", () => {
    const src = read("app/dashboard/content/all/page.tsx");
    expect(src).toContain('<PeriodBar path="/dashboard/content/all"');
    expect(src).toContain("<FilterBar");
    expect(src).toContain("<ScheduleAllButton");
    expect(src).toContain("<SubjectGrid");
    expect(src).toContain('featureGate("content")');
  });

  it("Create today's content has no selects left", () => {
    const src = read("components/content-flow/create-day-dialog.tsx");
    expect(src).not.toContain("<Select");
    expect(src).toContain("<ChoiceChips");
    expect(src).toContain("<ChoiceCards");
  });
});

describe("dev preview", () => {
  it("is not found in production", () => {
    const src = read("app/dashboard-preview/[[...screen]]/page.tsx");
    expect(src).toContain("if (!previewAllowed()) notFound();");
  });
});

describe("choice cards and chips", () => {
  const noop = () => {};
  it("are a radio group with the chosen one checked", () => {
    const html = renderToStaticMarkup(createElement(ChoiceChips<"auto" | "with">, { label: "Price", value: "with", onChange: noop, items: [{ value: "auto", label: "AI decides" }, { value: "with", label: "With price" }] }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Price"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/i);
  });

  it("disable an option that cannot be chosen", () => {
    const html = renderToStaticMarkup(createElement(ChoiceCards<"ai" | "free">, { label: "Pictures", value: "free", onChange: noop, items: [{ value: "ai", label: "Unique AI pictures", disabled: true }, { value: "free", label: "Your own photos" }] }));
    expect(html).toContain("disabled");
    expect(html).toContain("Your own photos");
  });
});
