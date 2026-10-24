import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { trainingExample: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { exampleIdsOf, labLines, notesText, phrasesOf, rankExamples, usable, type ExampleRow } from "@/lib/training-lab/match";
import { labFor } from "@/lib/training-lab/reader";

const now = new Date("2026-10-24T12:00:00Z");
let n = 0;
const ex = (over: Partial<ExampleRow> = {}): ExampleRow => ({
  id: `e${++n}`, kind: "reel", title: `Example ${n}`, howMade: "Filmed on a phone.", whatIsGood: "Fast cuts.", neverThis: null, notes: null, tags: [], sector: null, language: null, technique: [], rating: null,
  consentGiven: false, engines: ["reel"], transcript: null, createdAt: new Date("2026-10-01T00:00:00Z"), ...over,
});
const ids = (r: ReturnType<typeof rankExamples>) => r.examples.map((s) => s.example.id);

beforeEach(() => {
  findMany.mockReset();
});

describe("rankExamples", () => {
  it("matches the language by its aliases (rw, Ikinyarwanda, Kinyarwanda (Rwanda))", () => {
    const rw = ex({ language: "rw" });
    const fr = ex({ language: "fr" });
    const r = rankExamples([fr, rw], { engine: "reel", language: "Kinyarwanda (Rwanda)" }, now);
    expect(r.examples[0].example.id).toBe(rw.id);
    expect(r.examples[0].score).toBeGreaterThan(r.examples[1].score);
  });
  it("uses only examples switched on for the engine and the wanted kinds", () => {
    const a = ex();
    const b = ex({ engines: ["image"] });
    const c = ex({ kind: "video" });
    expect(ids(rankExamples([a, b, c], { engine: "reel" }, now)).sort()).toEqual([a.id, c.id].sort());
    expect(ids(rankExamples([a, c], { engine: "reel", kinds: ["video"] }, now))).toEqual([c.id]);
  });
  it("prefers the same sector, then a neighbouring one, then none", () => {
    const same = ex({ sector: "agriculture" });
    const near = ex({ sector: "shop" });
    const far = ex({ sector: "clinic" });
    const none = ex({ sector: null });
    expect(ids(rankExamples([far, none, near, same], { engine: "reel", sector: "agriculture" }, now))).toEqual([same.id, near.id, none.id, far.id]);
  });
  it("rewards the language, shared techniques and tags", () => {
    const lang = ex({ language: "Kinyarwanda" });
    const wrong = ex({ language: "English" });
    const tech = ex({ technique: ["Punch-in", "whip"], tags: ["beat"] });
    const out = rankExamples([wrong, lang, tech], { engine: "reel", language: "kinyarwanda", techniques: ["punch-in", "whip", "beat"] }, now);
    expect(ids(out)).toEqual([lang.id, tech.id, wrong.id]);
  });
  it("counts 5 stars strongly and recency only as a tie-breaker", () => {
    const five = ex({ rating: 5, createdAt: new Date("2025-01-01") });
    const fresh = ex({ createdAt: new Date("2026-10-24") });
    const older = ex({ createdAt: new Date("2026-06-01") });
    expect(ids(rankExamples([fresh, older, five], { engine: "reel" }, now))).toEqual([five.id, fresh.id, older.id]);
  });
  it("sends 1 and 2 star examples to the avoid side", () => {
    const good = ex({ rating: 4 });
    const bad = ex({ rating: 1, sector: "agriculture" });
    const meh = ex({ rating: 2 });
    const out = rankExamples([good, bad, meh], { engine: "reel", sector: "agriculture" }, now);
    expect(ids(out)).toEqual([good.id]);
    expect(out.avoid.map((e) => e.id).sort()).toEqual([bad.id, meh.id].sort());
  });
  it("applies the limit and does not change its input", () => {
    const list = Array.from({ length: 9 }, () => ex());
    const copy = [...list];
    expect(rankExamples(list, { engine: "reel", limit: 3 }, now).examples).toHaveLength(3);
    expect(rankExamples(list, { engine: "reel" }, now).examples).toHaveLength(5);
    expect(list).toEqual(copy);
  });
  it("gives nothing for an empty Lab", () => {
    expect(rankExamples([], { engine: "reel" }, now)).toEqual({ examples: [], avoid: [] });
  });
});

describe("consent", () => {
  it("never uses an actor without consent, for any engine", () => {
    const no = ex({ kind: "actor", engines: ["reel", "presenter"], consentGiven: false });
    const yes = ex({ kind: "actor", engines: ["reel", "presenter"], consentGiven: true });
    expect(usable(no, { engine: "reel" })).toBe(false);
    expect(ids(rankExamples([no, yes], { engine: "presenter" }, now))).toEqual([yes.id]);
    expect(ids(rankExamples([no, yes], { engine: "reel" }, now))).toEqual([yes.id]);
  });
  it("gives the presenter only actors", () => {
    const reel = ex({ engines: ["presenter"] });
    const actor = ex({ kind: "actor", engines: ["presenter"], consentGiven: true });
    expect(ids(rankExamples([reel, actor], { engine: "presenter" }, now))).toEqual([actor.id]);
  });
});

describe("labLines", () => {
  it("writes one plain line per example with its notes", () => {
    const e = ex({ title: "Kigali car seller", howMade: "Phone, three shots.", whatIsGood: "The price sticker comes first.", notes: { cuts_per_second: 0.8, hook: "price sticker", music: ["amapiano", "120 bpm"], nested: { a: 1 } } });
    const lines = labLines(rankExamples([e], { engine: "reel" }, now));
    expect(lines.examples).toHaveLength(1);
    expect(lines.examples[0]).toContain('Reel "Kigali car seller"');
    expect(lines.examples[0]).toContain("Phone, three shots.");
    expect(lines.examples[0]).toContain("cuts per second: 0.8");
    expect(lines.examples[0]).toContain("music: amapiano, 120 bpm");
    expect(lines.examples[0]).not.toContain("nested");
  });
  it("collects every never-this note and the low-rated ones", () => {
    const a = ex({ title: "A", neverThis: "Stock music." });
    const b = ex({ title: "B", rating: 1, neverThis: "Text over the face." });
    const c = ex({ title: "C", rating: 2, howMade: "Slideshow of photos." });
    const lines = labLines(rankExamples([a, b, c], { engine: "reel" }, now));
    expect(lines.avoid).toEqual(['Never (from "A"): Stock music.', 'Rated 1 of 5 by the owner, do not copy "B": Text over the face.', expect.stringContaining("how it was made: Slideshow of photos.")]);
  });
  it("splits voice transcripts into short phrases in their spelling", () => {
    const v = ex({ kind: "voice", engines: ["language"], transcript: "Murakaza neza!\nDuhamagare kuri WhatsApp. Murakaza neza! x" });
    const r = rankExamples([v], { engine: "language" }, now);
    expect(phrasesOf(r)).toEqual(["Murakaza neza", "Duhamagare kuri WhatsApp"]);
    expect(labLines(r).phrases).toEqual(["Murakaza neza", "Duhamagare kuri WhatsApp"]);
    expect(phrasesOf(rankExamples([ex({ transcript: "Not a voice example." })], { engine: "reel" }, now))).toEqual([]);
  });
  it("keeps every section within the character cap", () => {
    const many = Array.from({ length: 5 }, (_, i) => ex({ title: `T${i}`, howMade: "h".repeat(300), whatIsGood: "g".repeat(300), neverThis: "n".repeat(200) }));
    const out = labLines(rankExamples(many, { engine: "reel" }, now), { maxChars: 1000 });
    const size = (l: string[]) => l.reduce((s, x) => s + x.length, 0);
    expect(size(out.examples) + size(out.avoid) + size(out.phrases)).toBeLessThanOrEqual(1000);
    expect(out.examples.every((l) => l.length <= 420)).toBe(true);
    expect(labLines(rankExamples(many, { engine: "reel" }, now), { maxChars: 0 })).toEqual({ examples: [], avoid: [], phrases: [] });
  });
  it("is empty for an empty Lab", () => {
    expect(labLines({ examples: [], avoid: [] })).toEqual({ examples: [], avoid: [], phrases: [] });
    expect(notesText(null)).toBe("");
    expect(notesText([1, 2])).toBe("");
  });
});

describe("exampleIdsOf", () => {
  it("lists the matched and the avoided ids once", () => {
    const a = ex();
    const b = ex({ rating: 1 });
    expect(exampleIdsOf(rankExamples([a, b], { engine: "reel" }, now)).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("labFor", () => {
  it("queries by engine and kind, and returns ranked lines and ids", async () => {
    const a = ex({ title: "Good one", sector: "shop" });
    findMany.mockResolvedValue([a]);
    const lab = await labFor({ engine: "reel", kinds: ["reel", "video"], sector: "shop" });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { engines: { has: "reel" }, kind: { in: ["reel", "video"] } }, orderBy: { createdAt: "desc" }, take: 300 });
    expect(lab.exampleIds).toEqual([a.id]);
    expect(lab.examples[0]).toContain("Good one");
  });
  it("gives empty lists for an empty Lab and on a database error", async () => {
    findMany.mockResolvedValue([]);
    expect(await labFor({ engine: "reel" })).toEqual({ examples: [], avoid: [], phrases: [], exampleIds: [] });
    findMany.mockRejectedValue(new Error("down"));
    expect(await labFor({ engine: "reel" })).toEqual({ examples: [], avoid: [], phrases: [], exampleIds: [] });
  });
});
