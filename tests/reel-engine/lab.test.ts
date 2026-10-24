import { describe, expect, it, vi } from "vitest";
import { clipCheckPrompt, CLIP_CHECK_PROMPT } from "@/lib/reel-engine/checker";
import { directMontage } from "@/lib/reel-engine/story";
import { labBlock, reelPrompt, type ReelInput } from "@/lib/reel-engine/writer";

vi.mock("server-only", () => ({}));

const input = (over: Partial<ReelInput> = {}): ReelInput => ({
  business: { name: "LEAF", industry: "agriculture", description: "Hydroponic towers", audience: null, place: "Kigali", language: "English", voice: null, colors: [] },
  subject: null,
  brief: null,
  language: "English",
  presenter: "a Black Rwandan woman",
  beats: directMontage([], "seed"),
  recent: [],
  sector: "agriculture",
  ...over,
});

describe("the Lab in the reel prompt", () => {
  it("prints nothing for an empty Lab: the prompt is exactly today's", () => {
    const today = reelPrompt(input());
    expect(reelPrompt(input({ lab: null }))).toBe(today);
    expect(reelPrompt(input({ lab: { examples: [], avoid: [], phrases: [] } }))).toBe(today);
    expect(today).not.toMatch(/OWNER'S EXAMPLES|NEVER \(|KINYARWANDA THE OWNER/);
  });
  it("prints the examples and the never-notes as short blocks", () => {
    const lab = { examples: ['Reel "Car seller": made like this: phone. Good because: price first.'], avoid: ['Never (from "A"): stock music.'], phrases: ["Murakaza neza"] };
    const block = labBlock(lab, "English");
    expect(block).toBe(
      [
        "THE OWNER'S EXAMPLES (follow their style, never copy their words or numbers):",
        '- Reel "Car seller": made like this: phone. Good because: price first.',
        "",
        "NEVER (the owner's notes):",
        '- Never (from "A"): stock music.',
      ].join("\n"),
    );
    expect(reelPrompt(input({ lab }))).toContain(block!);
  });
  it("adds the Kinyarwanda phrases only for a Kinyarwanda reel", () => {
    const lab = { examples: [], avoid: [], phrases: ["Murakaza neza", "Duhamagare kuri WhatsApp"] };
    expect(labBlock(lab, "English")).toBeNull();
    expect(labBlock(lab, "Kinyarwanda")).toBe("KINYARWANDA THE OWNER USES (spelling and natural phrases):\n- Murakaza neza\n- Duhamagare kuri WhatsApp");
  });
});

describe("the Lab in the clip check", () => {
  it("is today's prompt without notes", () => {
    expect(clipCheckPrompt()).toBe(CLIP_CHECK_PROMPT);
    expect(clipCheckPrompt([" ", ""])).toBe(CLIP_CHECK_PROMPT);
  });
  it("adds at most 6 notes of 160 letters as extra FAIL lines", () => {
    const out = clipCheckPrompt(Array.from({ length: 9 }, (_, i) => `${i} ${"x".repeat(300)}`));
    expect(out.startsWith(CLIP_CHECK_PROMPT)).toBe(true);
    const extra = out.slice(CLIP_CHECK_PROMPT.length).split("\n").filter((l) => l.startsWith("- "));
    expect(extra).toHaveLength(6);
    expect(extra.every((l) => l.length <= 162)).toBe(true);
    expect(out).toContain("Also FAIL the clip");
  });
});
