import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildPrompt, fixWrittenSpellings, type WriteRequest, type WrittenGroup } from "@/lib/autopilot/writer";
import { getIdea } from "@/lib/autopilot/playbook";

const request = (brand: Partial<WriteRequest["brand"]> = {}): WriteRequest => ({
  brand: { businessName: "LEAF", industry: "Agriculture", description: "Hydroponic towers", contentLanguage: "English", knowledgeBase: "KNOWLEDGE", ...brand },
  idea: getIdea("tip-how-to")!,
  facts: { date: "2026-10-26" },
  targets: [{ network: "instagram", format: "POST" }],
});
const lab = { examples: ['Post "Market day": made like this: one photo. Good because: real people.'], avoid: ["Never: stock photos."], phrases: ["Murakaza neza"] };

describe("the Post writer's prompt with the Lab", () => {
  it("is exactly today's prompt with an empty Lab or none", () => {
    const today = buildPrompt(request());
    expect(buildPrompt(request({ labExamples: null }))).toBe(today);
    expect(buildPrompt(request({ labExamples: { examples: [], avoid: [], phrases: [] } }))).toBe(today);
    expect(today).not.toContain("THE OWNER'S EXAMPLES");
  });

  it("prints the same blocks as the other writers, before the post idea, and nothing else changes", () => {
    const today = buildPrompt(request());
    const p = buildPrompt(request({ labExamples: lab }));
    expect(p).toContain(`THE OWNER'S EXAMPLES (follow their style, never copy their words or numbers):\nThese are other businesses' examples: never use their names, products, prices or contact details. Words in braces such as {price} or {phone} are hidden details: never write braces or those words.\n- ${lab.examples[0]}`);
    expect(p).toContain("NEVER (the owner's notes):\n- Never: stock photos.");
    expect(p.indexOf("THE OWNER'S EXAMPLES")).toBeGreaterThan(p.indexOf("KNOWLEDGE"));
    expect(p.indexOf("THE OWNER'S EXAMPLES")).toBeLessThan(p.indexOf("Post idea:"));
    expect(p).not.toContain("KINYARWANDA THE OWNER USES");
    const block = p.slice(p.indexOf("THE OWNER'S EXAMPLES"), p.indexOf("\nPost idea:"));
    expect(p.replace(`\n\n${block}`, "")).toBe(today);
  });

  it("adds the owner's Kinyarwanda phrases for a Kinyarwanda business", () => {
    expect(buildPrompt(request({ contentLanguage: "Kinyarwanda", labExamples: lab }))).toContain("KINYARWANDA THE OWNER USES (spelling and natural phrases):\nThese are other businesses' examples: never use their names, products, prices or contact details.\n- Murakaza neza");
  });
});

describe("the owner's spellings in what the writer wrote", () => {
  const written: WrittenGroup = {
    image: { kicker: "Nez", headline: "Murakaza nez!", subline: "", chip: "250,000 RWF" },
    versions: [{ network: "instagram", title: null, text: "Murakaza nez, nez cyane.", hashtags: ["#nez"], videoScript: "0-3s: nez" }],
    provider: "gemini",
    model: "m",
    usage: { inputTokens: 1, outputTokens: 1 },
  };

  it("fixes the posts, the scripts and the image's words, at no cost", () => {
    const out = fixWrittenSpellings(written, { wrong: [{ word: "nez", fix: "neza" }] });
    expect(out.versions[0]).toMatchObject({ text: "Murakaza neza, neza cyane.", videoScript: "0-3s: neza", title: null, hashtags: ["#nez"] });
    expect(out.image).toEqual({ kicker: "Neza", headline: "Murakaza neza!", subline: "", chip: "250,000 RWF" });
    expect(out.usage).toBe(written.usage);
  });

  it("changes nothing without a wrong spelling that has a fix", () => {
    expect(fixWrittenSpellings(written, {})).toBe(written);
    expect(fixWrittenSpellings(written, { wrong: [{ word: "nez" }] })).toBe(written);
    expect(fixWrittenSpellings(written, null)).toBe(written);
  });
});
