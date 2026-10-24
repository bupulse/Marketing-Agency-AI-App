import { describe, expect, it } from "vitest";
import { fixSpellings, polishReelTexts } from "@/lib/training-lab/fix-spelling";

const extra = { wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "murakoze cyane", fix: "murakoze cane" }, { word: "bad" }] };

describe("fixSpellings", () => {
  it("replaces whole words and keeps the case of the first letter", () => {
    expect(fixSpellings("Igiciro kiri hasi, igiciro", extra)).toEqual({ text: "Igiciro: kiri hasi, igiciro:", changes: [{ from: "Igiciro", to: "Igiciro:" }, { from: "igiciro", to: "igiciro:" }] });
  });
  it("replaces a phrase, and not part of a longer word", () => {
    expect(fixSpellings("Murakoze cyane! igiciros", extra).text).toBe("Murakoze cane! igiciros");
  });
  it("leaves a wrong word with no fix alone, and a text with nothing to fix", () => {
    expect(fixSpellings("this is bad", extra)).toEqual({ text: "this is bad", changes: [] });
    expect(fixSpellings("Muraho", extra)).toEqual({ text: "Muraho", changes: [] });
    expect(fixSpellings("igiciro", {})).toEqual({ text: "igiciro", changes: [] });
    expect(fixSpellings("igiciro", null)).toEqual({ text: "igiciro", changes: [] });
    expect(fixSpellings("", extra)).toEqual({ text: "", changes: [] });
  });
  it("does not fix a fix again, and takes regex characters literally", () => {
    expect(fixSpellings("igiciro", { wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "igiciro:", fix: "x" }] }).text).toBe("igiciro:");
    expect(fixSpellings("a.b a-b", { wrong: [{ word: "a.b", fix: "ab" }] }).text).toBe("ab a-b");
  });
});

describe("polishReelTexts", () => {
  const plan = { title: "Igiciro nziza", caption: "Murakaza neza", clips: [{ line: "Murakaza neza", beat: "hook" }, { line: "igiciro kiri hasi", beat: "cta" }], price: "x" };
  it("fixes the title, caption and lines, and says where", () => {
    const out = polishReelTexts(plan, "Kinyarwanda", extra);
    expect(out.plan.title).toBe("Igiciro: nziza");
    expect(out.plan.clips.map((c) => c.line)).toEqual(["Murakaza neza", "igiciro: kiri hasi"]);
    expect(out.plan.clips[1]).toMatchObject({ beat: "cta" });
    expect(out.plan.price).toBe("x");
    expect(out.fixes).toEqual([{ where: "title", from: "Igiciro", to: "Igiciro:" }, { where: "clip 2 line", from: "igiciro", to: "igiciro:" }]);
    expect(plan.title).toBe("Igiciro nziza");
  });
  it("reports what remains: a wrong spelling with no fix, and the built-in rules", () => {
    const out = polishReelTexts({ title: "t", caption: "Call now", clips: [{ line: "this is bad" }] }, "Kinyarwanda", extra);
    expect(out.issues.map((i) => [i.where, i.found])).toEqual(expect.arrayContaining([["clip 1 line", "bad"], ["caption", "Call now"]]));
    expect(out.fixes).toEqual([]);
  });
  it("is the same plan, with no changes and no issues, for clean text and an empty Lab", () => {
    const clean = { title: "Hydro Tower", caption: "Murakaza neza", clips: [{ line: "Muraho" }] };
    for (const e of [undefined, null, {}]) {
      const out = polishReelTexts(clean, "Kinyarwanda", e);
      expect(out.plan).toEqual(clean);
      expect(out.fixes).toEqual([]);
      expect(out.issues).toEqual([]);
    }
  });
});
