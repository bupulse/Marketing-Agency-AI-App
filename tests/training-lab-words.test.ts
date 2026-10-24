import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { trainingExample: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { wordsOverview } from "@/lib/training-lab/language";
import { labWords } from "@/lib/training-lab/language-reader";

let n = 0;
const row = (over: Record<string, unknown> = {}) => ({
  id: `v${++n}`, title: `Recording ${n}`, kind: "voice", rating: null, transcript: null, notes: null, engines: ["language"], tags: [], sector: null, language: "Kinyarwanda", technique: [],
  howMade: "x", whatIsGood: "y", neverThis: null, consentGiven: false, createdAt: new Date("2026-10-01"), ...over,
});
const phrases = (r: { transcript: string | null }) => (r.transcript ?? "").split(/[\n.!?;]+/).map((p) => p.trim()).filter(Boolean);

beforeEach(() => {
  findMany.mockReset();
});

describe("wordsOverview", () => {
  it("collects spellings, words and phrases, each with its recording", () => {
    const a = row({ title: "Greeting", transcript: "Murakaza neza. Muraho", notes: { wrong: [{ word: "igiciro", fix: "igiciro:" }], words: ["LEAF"] } });
    const b = row({ title: "Price", engines: ["reel"], transcript: "Murakaza neza", notes: { wrong: [{ word: "IGICIRO" }, { word: "bad" }], words: ["leaf", "Hydro"] } });
    const out = wordsOverview([a, b, row({ kind: "reel", notes: { words: ["no"] } })], phrases);
    expect(out.recordings).toBe(2);
    expect(out.wrong).toEqual([{ word: "igiciro", fix: "igiciro:", id: a.id, title: "Greeting", on: true }, { word: "bad", id: b.id, title: "Price", on: false }]);
    expect(out.words.map((w) => [w.word, w.id])).toEqual([["LEAF", a.id], ["Hydro", b.id]]);
    expect(out.phrases.map((p) => [p.phrase, p.id])).toEqual([["Murakaza neza", a.id], ["Muraho", a.id]]);
  });
  it("is empty for no recordings", () => {
    expect(wordsOverview([], phrases)).toEqual({ wrong: [], words: [], phrases: [], recordings: 0 });
  });
});

describe("labWords", () => {
  it("reads the voice examples and splits their transcripts like the writers do", async () => {
    findMany.mockResolvedValue([row({ transcript: "Murakaza neza! Duhamagare kuri WhatsApp. x", notes: { wrong: [{ word: "a", fix: "b" }] } })]);
    const out = await labWords();
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { kind: "voice" }, take: 300 });
    expect(out.phrases.map((p) => p.phrase)).toEqual(["Murakaza neza", "Duhamagare kuri WhatsApp"]);
    expect(out.wrong).toHaveLength(1);
  });
  it("lets the page show a problem when the database fails", async () => {
    findMany.mockRejectedValue(new Error("down"));
    await expect(labWords()).rejects.toThrow("down");
  });
});
