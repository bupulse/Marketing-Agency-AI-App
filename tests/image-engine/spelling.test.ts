import { describe, expect, it } from "vitest";
import { fixImageWords, type Concept } from "@/lib/image-engine/prompter";

const concept = (over: Partial<Concept> = {}): Concept & { planner: "claude" } => ({ title: "Igiciro title", scene: "A greenhouse", headline: "Igiciro kiri hasi", subline: "Murakaza neza", cta: "Duhamagare", prompt: "A photo of igiciro", planner: "claude", ...over });
const extra = { wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "bad" }] };

describe("fixImageWords", () => {
  it("fixes the words on the picture and the captions, keeping the case of the first letter", () => {
    const out = fixImageWords([concept(), concept({ cta: "bad", subline: "x" })], ["Igiciro nziza", null, "Muraho"], extra);
    expect(out.concepts[0]).toMatchObject({ headline: "Igiciro: kiri hasi", subline: "Murakaza neza", cta: "Duhamagare", planner: "claude" });
    expect(out.captions).toEqual(["Igiciro: nziza", null, "Muraho"]);
    expect(out.fixes).toBe(3);
  });
  it("leaves the title, scene and image prompt alone, and a wrong word with no fix", () => {
    const out = fixImageWords([concept({ cta: "bad" })], [], extra);
    expect(out.concepts[0]).toMatchObject({ title: "Igiciro title", scene: "A greenhouse", prompt: "A photo of igiciro", cta: "bad" });
  });
  it("gives identical output with an empty Lab", () => {
    const concepts = [concept(), concept({ headline: "Hello" })];
    const captions = ["Igiciro nziza", null];
    for (const e of [undefined, null, {}, { wrong: [] }, { words: ["igiciro"] }]) {
      const out = fixImageWords(concepts, captions, e);
      expect(out.concepts).toEqual(concepts);
      expect(out.captions).toEqual(captions);
      expect(out.fixes).toBe(0);
    }
  });
  it("does not change its inputs", () => {
    const concepts = Object.freeze([Object.freeze(concept())]);
    const captions = Object.freeze(["Igiciro"]);
    expect(() => fixImageWords(concepts, captions, extra)).not.toThrow();
  });
});
