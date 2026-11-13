import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// QA round 2 (14 Nov): the opened post on a phone, select mode, and lines that said the same thing twice.
const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

describe("opened post buttons", () => {
  const detail = read("components/publishing/post-detail.tsx");

  it("fold the less-used ones under More on a phone and show them all from md up", () => {
    expect(detail).toMatch(/className="md:hidden" aria-expanded=\{more\}/);
    expect(detail).toContain('{more ? "Less" : "More"}');
    expect(detail).toContain('cn("flex-wrap items-start gap-2 md:contents", more ? "flex w-full" : "hidden")');
    // A delete waiting for its "Yes" keeps them open.
    expect(detail).toContain("const more = ui.more || ui.confirmDelete;");
    // Approve, Retry, Mark as posted, Publish automatically and Edit come before the fold.
    const fold = detail.indexOf('{more ? "Less" : "More"}');
    for (const label of ["Approve", "Retry", "Mark as posted", "Publish automatically", "Edit"]) expect(detail.lastIndexOf(`${label}\n`, fold)).toBeGreaterThan(-1);
    expect(detail.indexOf("Duplicate\n")).toBeGreaterThan(fold);
  });

  it("never show Copy caption and the video twice next to the trending-sound card", () => {
    expect(detail).toContain("const soundTip = showsSoundTip(post);");
    expect(detail).toContain('{!soundTip && (post.remindOnly || post.notify || post.status === "NEEDS_ACTION") && (');
    expect(detail).toContain('{!soundTip && (post.remindOnly || post.status === "NEEDS_ACTION") &&');
  });
});

describe("select mode", () => {
  it("a tap on a card's media picks it (a video without a poster used to play)", () => {
    expect(read("components/content-board/post-card.tsx")).toMatch(/selection && hasMedia \? \(\s*<button type="button" tabIndex=\{-1\} aria-hidden onClick=\{selection\.onToggle\}/);
  });
});

describe("no line said twice", () => {
  it("Home's top bar shows only the company (its title already says Welcome)", () => {
    expect(read("components/app/app-shell.tsx")).toMatch(/pathname === "\/dashboard" \? \(\s*<span[^>]*>\{businessName\}<\/span>/);
  });

  it("Today with nothing to review keeps only the 'all caught up' card", () => {
    const today = read("components/content-board/today-review.tsx");
    expect(today).not.toContain("Nothing new to review today.");
    expect(today).toContain("You are all caught up.");
  });
});
