import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/publishing/time";
import { ANGLES, availableAngles, pickAngle, type AngleHistory } from "@/lib/content-flow/angles";

const allFacts = { hasPrice: true, hasNews: true, reviews: 2, faqs: 3 };

function simulate(days: number, facts = allFacts, subjectKey = "product:p1") {
  const history: AngleHistory = [];
  let day = "2026-10-01";
  for (let i = 0; i < days; i++) {
    const choice = pickAngle({ subjectKey, day, history, facts });
    history.push({ day, ...choice });
    day = addDays(day, 1);
  }
  return history;
}

describe("angle rotation", () => {
  it("never uses the same angle, hook or structure two days in a row", () => {
    const h = simulate(40);
    for (let i = 1; i < h.length; i++) {
      expect(h[i].angle).not.toBe(h[i - 1].angle);
      expect(h[i].hook).not.toBe(h[i - 1].hook);
      expect(h[i].structure).not.toBe(h[i - 1].structure);
    }
  });

  it("uses every allowed angle once before any comes back", () => {
    const h = simulate(ANGLES.length);
    expect(new Set(h.map((x) => x.angle)).size).toBe(ANGLES.length);
  });

  it("leaves out angles the facts cannot support (no price, no reviews, no FAQs, no news)", () => {
    const facts = { hasPrice: false, hasNews: false, reviews: 0, faqs: 0 };
    expect(availableAngles(facts)).not.toEqual(expect.arrayContaining(["offer"]));
    const used = new Set(simulate(30, facts).map((x) => x.angle));
    for (const a of ["offer", "story", "faq", "news"]) expect(used.has(a)).toBe(false);
  });

  it("is the same for the same subject and day (no randomness), and differs between subjects", () => {
    const a = pickAngle({ subjectKey: "product:p1", day: "2026-10-13", history: [], facts: allFacts });
    expect(pickAngle({ subjectKey: "product:p1", day: "2026-10-13", history: [], facts: allFacts })).toEqual(a);
    const others = ["product:p2", "product:p3", "campaign:c1", "general"].map((k) => pickAngle({ subjectKey: k, day: "2026-10-13", history: [], facts: allFacts }).angle);
    expect(new Set([a.angle, ...others]).size).toBeGreaterThan(1);
  });

  it("takes another angle when the day already has one (a second run today)", () => {
    const first = pickAngle({ subjectKey: "product:p1", day: "2026-10-13", history: [], facts: allFacts });
    const second = pickAngle({ subjectKey: "product:p1", day: "2026-10-13", history: [{ day: "2026-10-13", ...first }], facts: allFacts });
    expect(second.angle).not.toBe(first.angle);
  });

  it("ignores history after the day (a later scheduled day does not count)", () => {
    const later = [{ day: "2026-10-20", angle: "how", hook: "bold", structure: "list" }];
    expect(pickAngle({ subjectKey: "product:p1", day: "2026-10-13", history: later, facts: allFacts })).toEqual(pickAngle({ subjectKey: "product:p1", day: "2026-10-13", history: [], facts: allFacts }));
  });
});
