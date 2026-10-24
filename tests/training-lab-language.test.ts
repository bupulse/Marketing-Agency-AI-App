import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { trainingExample: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { buildVoiceExtras, describeExtras, extrasText, languageExtraFrom, parseApprovedWords, parseWrongSpellings, readVoiceExtras, withVoiceExtras } from "@/lib/training-lab/language";
import { labLanguage } from "@/lib/training-lab/language-reader";
import { exampleInputProblem, exampleInputSchema } from "@/lib/training-lab/types";
import { checkLanguage } from "@/lib/video-engine/brain/language";
import { planSeries } from "@/lib/video-engine/brain/series";
import { suggestHooks } from "@/lib/video-engine/brain/suggest";
import { designVideo, type DesignBrief } from "@/lib/video-engine/designer";

beforeEach(() => {
  findMany.mockReset();
});

const voice = (over: Record<string, unknown> = {}) => ({ kind: "voice", rating: null as number | null, transcript: null as string | null, notes: null as unknown, engines: ["language"], ...over });

describe("the owner's two boxes", () => {
  it("reads wrong -> right, or only the wrong one", () => {
    expect(parseWrongSpellings("igiciro -> igiciro:\n  murakoze   cyane \n\nIGICIRO → x")).toEqual({ wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "murakoze cyane" }], problem: null });
    expect(parseWrongSpellings("")).toEqual({ wrong: [], problem: null });
  });
  it("explains a bad line in plain English", () => {
    expect(parseWrongSpellings("-> right").problem).toMatch(/write the wrong spelling first/);
    expect(parseWrongSpellings("wrong ->").problem).toMatch(/write the right spelling after the arrow/);
    expect(parseWrongSpellings("x".repeat(80)).problem).toMatch(/too long/);
    expect(parseWrongSpellings(Array.from({ length: 201 }, (_, i) => `w${i}`).join("\n")).problem).toMatch(/200 lines/);
  });
  it("reads the right words", () => {
    expect(parseApprovedWords("LEAF, Hydro Tower,\nleaf")).toEqual({ words: ["LEAF", "Hydro Tower"], problem: null });
    expect(parseApprovedWords("x".repeat(70)).problem).toMatch(/short/);
  });
  it("builds both, or says the first problem", () => {
    expect(buildVoiceExtras({ wrong: "a -> b", words: "c" })).toEqual({ extras: { wrong: [{ word: "a", fix: "b" }], words: ["c"] }, problem: null });
    expect(buildVoiceExtras({ wrong: "-> b" }).problem).toMatch(/wrong spelling first/);
    expect(buildVoiceExtras(null)).toEqual({ extras: { wrong: [], words: [] }, problem: null });
  });
});

describe("the notes", () => {
  it("keeps the AI-drafted fields and replaces only the extras", () => {
    const notes = { hook: "fast", wrong: [{ word: "old" }], words: ["old"] };
    expect(withVoiceExtras(notes, { wrong: [{ word: "a", fix: "b" }], words: [] })).toEqual({ hook: "fast", wrong: [{ word: "a", fix: "b" }] });
    expect(withVoiceExtras({ wrong: [{ word: "a" }] }, { wrong: [], words: [] })).toBeNull();
    expect(withVoiceExtras(null, { wrong: [], words: ["x"] })).toEqual({ words: ["x"] });
    expect(notes.wrong).toHaveLength(1);
  });
  it("reads, shows and edits them", () => {
    const notes = { wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "bad" }, 5, { nope: 1 }], words: ["LEAF", 7, "Hydro Tower"] };
    expect(readVoiceExtras(notes)).toEqual({ wrong: [{ word: "igiciro", fix: "igiciro:" }, { word: "bad" }], words: ["LEAF", "Hydro Tower"] });
    expect(extrasText(notes)).toEqual({ wrong: "igiciro -> igiciro:\nbad", words: "LEAF, Hydro Tower" });
    expect(describeExtras(notes)).toEqual({ wrong: "igiciro → igiciro:; bad", words: "LEAF, Hydro Tower" });
    expect(describeExtras(null)).toEqual({ wrong: null, words: null });
    expect(readVoiceExtras("x")).toEqual({ wrong: [], words: [] });
  });
  it("is checked with the example form", () => {
    const base = { kind: "voice", title: "Greeting", hasFile: true, howMade: "x", whatIsGood: "y", transcript: "Murakaza neza" };
    const v = exampleInputSchema.parse({ ...base, voice: { wrong: "igiciro -> igiciro:", words: "LEAF" } });
    expect(v.voiceExtras).toEqual({ wrong: [{ word: "igiciro", fix: "igiciro:" }], words: ["LEAF"] });
    expect(exampleInputSchema.parse({ ...base }).voiceExtras).toEqual({ wrong: [], words: [] });
    expect(exampleInputProblem({ ...base, voice: { wrong: "-> x" } })).toMatch(/wrong spelling first/);
    expect(exampleInputSchema.parse({ kind: "reel", title: "r", hasFile: true, howMade: "x", whatIsGood: "y" }).voiceExtras).toBeNull();
  });
});

describe("languageExtraFrom", () => {
  it("takes approved words and the words of good transcripts, lower case, no short ones, no repeats", () => {
    const out = languageExtraFrom([
      voice({ transcript: "Murakaza neza, ni mwiza! Muraho", notes: { words: ["LEAF"] } }),
      voice({ rating: 4, transcript: "Murakaza cyane" }),
      voice({ rating: 2, transcript: "ikibi cyane gusa" }),
    ]);
    expect(out.words).toEqual(["leaf", "murakaza", "neza", "mwiza", "muraho", "cyane"]);
    expect(out.wrong).toBeUndefined();
  });
  it("collects every spelling to avoid, from low-rated examples too, and never approves them", () => {
    const out = languageExtraFrom([
      voice({ rating: 1, transcript: "igiciro kiri hasi", notes: { wrong: [{ word: "igiciro", fix: "igiciro:" }] } }),
      voice({ notes: { wrong: [{ word: "IGICIRO" }, { word: "bad" }] } }),
    ]);
    expect(out.wrong).toEqual([{ word: "igiciro", fix: "igiciro:" }, { word: "bad" }]);
    expect(out.words ?? []).not.toContain("igiciro");
  });
  it("uses only voice examples switched on for the language engine", () => {
    expect(languageExtraFrom([voice({ engines: ["reel"], transcript: "murakaza neza" }), { ...voice({ transcript: "murakaza" }), kind: "reel" }])).toEqual({});
    expect(languageExtraFrom([])).toEqual({});
  });
});

describe("labLanguage", () => {
  it("queries voice examples for the language engine and keeps the business's language", async () => {
    findMany.mockResolvedValue([{ ...voice({ transcript: "murakaza neza" }), language: "Kinyarwanda" }, { ...voice({ transcript: "welcome home" }), language: "English" }, { ...voice({ transcript: "muraho" }), language: null }]);
    const out = await labLanguage("kinyarwanda");
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { kind: "voice", engines: { has: "language" } }, take: 200 });
    expect(out.words).toEqual(["murakaza", "neza", "muraho"]);
  });
  it("is empty on an error", async () => {
    findMany.mockRejectedValue(new Error("down"));
    expect(await labLanguage()).toEqual({});
  });
});

describe("the checks use it", () => {
  it("checkLanguage flags a spelling the owner marked wrong", () => {
    const extra = languageExtraFrom([voice({ notes: { wrong: [{ word: "igiciro", fix: "igiciro:" }] } })]);
    const issues = checkLanguage([{ where: "scene 1 text", text: "Murakaza neza, igiciro kiri hasi", kind: "screen" }], "Kinyarwanda", extra);
    expect(issues.map((i) => i.code)).toContain("owner-spelling");
  });
  it("suggestHooks passes the extra to its language check without changing today's lines", () => {
    const brief = { business: { name: "Shop", language: "Kinyarwanda" }, product: { name: "Phone", summary: "A phone", description: "A phone" }, styleId: null, seconds: 15 } as never;
    const today = suggestHooks(brief, { count: 5 });
    expect(suggestHooks(brief, { count: 5, languageExtra: {} })).toEqual(today);
    expect(suggestHooks(brief, { count: 5, languageExtra: { words: ["x"] } })).toEqual(today);
  });
});

describe("the designer and the series pass the extras", () => {
  const brief: DesignBrief = { business: { name: "Shop", language: "Kinyarwanda", phone: "+250 788 123 456" }, product: { name: "Kitenge dress", price: "25,000 RWF" }, photos: [], styleId: "kigali-price-first", ratio: "9:16", seconds: 6 } as unknown as DesignBrief;
  const raw = {
    palette: {},
    caption: "Ikanzu nziza ya kitenge",
    scenes: [
      { seconds: 3, background: {}, layers: [{ kind: "text", text: "Ikanzu nziza, igiciro kiri hasi", font: "inter", size: 0.06, color: "#fff", x: 0.5, y: 0.5, w: 0.8, h: 0.1 }] },
      { seconds: 3, background: {}, layers: [{ kind: "text", text: "Murakaza neza", font: "inter", size: 0.06, color: "#fff", x: 0.5, y: 0.3, w: 0.8, h: 0.1 }] },
    ],
  };
  const fetchImpl = () => vi.fn(async () => new Response(JSON.stringify({ model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(raw) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })) as unknown as typeof fetch;
  it("designVideo adds the owner's spelling warnings and is unchanged without them", async () => {
    const plain = await designVideo(brief, { apiKey: "k", fetchImpl: fetchImpl() });
    const empty = await designVideo(brief, { apiKey: "k", fetchImpl: fetchImpl(), languageExtra: {} });
    expect(empty.warnings).toEqual(plain.warnings);
    const taught = await designVideo(brief, { apiKey: "k", fetchImpl: fetchImpl(), languageExtra: { wrong: [{ word: "igiciro", fix: "igiciro:" }] } });
    const extra = taught.warnings.filter((w) => !plain.warnings.some((p) => p.where === w.where && p.found === w.found));
    expect(extra).toEqual([expect.objectContaining({ where: "scene 1 text", found: "igiciro", problem: "language", suggestion: "igiciro:" })]);
  });
  it("planSeries gives its openings the same extras and is unchanged without them", () => {
    const phone = { business: { name: "Nova", language: "Kinyarwanda", phone: "+250 788 300 400" }, product: { name: "Galaxy A56", summary: "A phone", price: "420,000 RWF" }, styleId: null, seconds: 15 } as never;
    const today = planSeries(phone, { platform: "any" });
    expect(planSeries(phone, { platform: "any", languageExtra: {} })).toEqual(today);
  });
});
