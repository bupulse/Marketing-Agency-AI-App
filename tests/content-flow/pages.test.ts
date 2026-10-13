import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Content flow v3: product and campaign pages keep their details and album, and link to the Content page; every
// content tool (content card, versions, design studio) is gone from them.
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("product and campaign pages", () => {
  for (const [file, href, label] of [
    ["app/dashboard/knowledge/products/[id]/page.tsx", "/dashboard/content/products/${product.id}", "See this product's content"],
    ["app/dashboard/knowledge/campaigns/[id]/page.tsx", "/dashboard/content/campaigns/${campaign.id}", "See this campaign's content"],
  ]) {
    it(`${file} has no content tools, only the link to its content`, () => {
      const src = read(file);
      for (const gone of ["ContentCard", "WriteContentCta", "DesignStudio", "loadSubjectStudio", "ContentVisual", "Write it again", "Your designs", "latestContentPosts"]) expect(src).not.toContain(gone);
      expect(src).toContain("AlbumCard");
      expect(src).toContain("SubjectContentLink");
      expect(src).toContain(href);
      expect(src).toContain(label);
    });
  }
});

describe("the subject content page", () => {
  it("is a day view with the date bar and Create today's content", () => {
    const src = read("components/content-board/subject-page.tsx");
    expect(src).toContain("<DayBar");
    expect(src).toContain("<CreateDayContent");
    expect(src).toContain("loadDayPosts");
    expect(src).toContain("ScheduleAllButton");
  });
});
