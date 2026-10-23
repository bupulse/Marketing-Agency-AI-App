import { describe, expect, it } from "vitest";
import { pillScrollLeft } from "@/components/quiz/frame";
import { localDay, quizBannerHere, quizBannerText } from "@/lib/knowledge/quiz-banner";

describe("the Business info quiz banner on every page", () => {
  it("shows on every dashboard page except Home, Business info and the quiz itself", () => {
    for (const path of ["/dashboard/content", "/dashboard/gallery", "/dashboard/knowledge/products", "/dashboard/billing/"]) expect(quizBannerHere(path)).toBe(true);
    for (const path of ["/dashboard", "/dashboard/", "/dashboard/knowledge", "/dashboard/knowledge/quiz", "/dashboard/knowledge/quiz/"]) expect(quizBannerHere(path)).toBe(false);
  });

  it("says how far along the owner is and which round opens", () => {
    expect(quizBannerText(0, { emoji: "🏠", title: "You" })).toBe("BuPulse doesn't know your business yet. Next: 🏠 You.");
    expect(quizBannerText(46, { emoji: "📸", title: "Photos" })).toBe("BuPulse knows your business 46%. Next: 📸 Photos.");
    expect(quizBannerText(46, null)).toBe("BuPulse knows your business 46%.");
  });

  it("hides for the viewer's local day", () => {
    expect(localDay(new Date(2026, 9, 3, 23, 59))).toBe("2026-10-03");
  });
});

describe("the round pills follow the quiz", () => {
  const row = { width: 300, scrollWidth: 900 };
  it("centres the current pill in the row", () => {
    expect(pillScrollLeft(row, { left: 500, width: 100 })).toBe(400);
  });
  it("never scrolls before the start or past the end", () => {
    expect(pillScrollLeft(row, { left: 20, width: 80 })).toBe(0);
    expect(pillScrollLeft(row, { left: 860, width: 40 })).toBe(600);
    expect(pillScrollLeft({ width: 600, scrollWidth: 600 }, { left: 500, width: 90 })).toBe(0);
  });
});
