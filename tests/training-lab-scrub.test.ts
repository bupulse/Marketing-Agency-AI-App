import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const createSignedUploadUrl = vi.fn(async (path: string) => ({ data: { signedUrl: `https://s/${path}`, token: "tok", path }, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } }) }));

import { describeEdit } from "@/lib/editor/describe";
import { addSticker, setCaptionText, textSticker } from "@/lib/editor/ops";
import { labLines, rankExamples, type ExampleRow } from "@/lib/training-lab/match";
import { reelHowMade } from "@/lib/training-lab/from-result";
import { parseScheduleNotes } from "@/lib/training-lab/schedule";
import { scrubContact, scrubText } from "@/lib/training-lab/scrub";
import { createUploadSlot } from "@/lib/training-lab/storage";
import type { MotionSpec } from "@/lib/video-engine/spec";

describe("scrubText", () => {
  it("swaps Rwandan phone numbers", () => {
    expect(scrubText("Call 0788 123 456 now")).toBe("Call {phone} now");
    expect(scrubText("WhatsApp +250 788 123 456")).toBe("WhatsApp {phone}");
    expect(scrubText("+250788123456 or 0788123456")).toBe("{phone} or {phone}");
    expect(scrubText("07 88 12 34 56")).toBe("{phone}");
  });
  it("swaps links and emails", () => {
    expect(scrubText("Visit https://leaf.rw/shop?x=1 or www.leaf.rw")).toBe("Visit {website} or {website}");
    expect(scrubText("Write to info@leaf.rw")).toBe("Write to {email}");
  });
  it("swaps prices in the ways they are written", () => {
    expect(scrubText("Only 45,000 RWF today")).toBe("Only {price} today");
    expect(scrubText("RWF 45k, Frw 45,000 or 45 000 frw")).toBe("{price}, {price} or {price}");
    expect(scrubText("1.2M francs and 450k RWF")).toBe("{price} and {price}");
    expect(scrubText("1 200 000 RWF")).toBe("{price}");
  });
  it("keeps ordinary words and small numbers", () => {
    expect(scrubText("3 cuts a second, 30 seconds, shot 4 of 12")).toBe("3 cuts a second, 30 seconds, shot 4 of 12");
    expect(scrubContact("Only 45,000 RWF")).toBe("Only 45,000 RWF");
  });
});

let n = 0;
const ex = (over: Partial<ExampleRow> = {}): ExampleRow => ({
  id: `e${++n}`, kind: "reel", title: "Car seller", howMade: "Phone. The sticker says 45,000 RWF and 0788 123 456.", whatIsGood: "Visit www.cars.rw first.", neverThis: "Never show 45k RWF big.", notes: { hook: "Call +250 788 123 456" }, tags: [], sector: null, language: null,
  technique: [], rating: null, consentGiven: false, engines: ["reel"], transcript: null, createdAt: new Date("2026-10-01"), ...over,
});

describe("what goes into another business's prompt", () => {
  it("is scrubbed in the example lines, the never lines and the phrases", () => {
    const lines = labLines(rankExamples([ex(), ex({ rating: 1, neverThis: null, howMade: "Ring 0788 999 000" }), ex({ kind: "voice", engines: ["reel"], transcript: "Duhamagare 0788 123 456. Ntucikwe 45,000 RWF" })], { engine: "reel", kinds: ["reel", "voice"] }));
    const all = JSON.stringify(lines);
    for (const bad of ["0788", "+250", "45,000", "45k", "www.cars.rw", "999 000"]) expect(all).not.toContain(bad);
    expect(lines.examples[0]).toContain("{price}");
    expect(lines.examples[0]).toContain("{phone}");
    expect(lines.avoid.some((l) => l.includes("Never show {price} big."))).toBe(true);
    expect(lines.phrases).toEqual(expect.arrayContaining(["Duhamagare {phone}", "Ntucikwe {price}"]));
  });
});

describe("scrubbed at the source", () => {
  const scene = (words: string, i: number) => ({ seconds: 3, background: { kind: "solid" as const, colors: ["#000"] }, layers: [{ kind: "video" as const, url: `c${i}.mp4`, fit: "cover" as const, start: 0, x: 0.5, y: 0.5, w: 1, h: 1 }, { kind: "text" as const, text: words, font: "inter" as const, size: 0.07, color: "#fff", x: 0.5, y: 0.7, w: 0.8, h: 0.1, box: { color: "#000" } }] });
  const spec = (): MotionSpec => ({ version: 1, title: "R", ratio: "9:16", fps: 30, palette: { background: "#000", primary: "#f00", accent: "#f00", text: "#fff" }, scenes: [scene("Call 0788 123 456", 1), scene("Price 45,000 RWF", 2)], music: null, caption: "", hashtags: [] });
  it("describeEdit does not quote phone numbers or prices", () => {
    const edited = addSticker(setCaptionText(spec(), 0, 1, "WhatsApp +250 788 111 222"), 1, textSticker("Now RWF 40k"));
    const lines = describeEdit(spec(), edited);
    expect(lines).toEqual(['Shot 1 words changed: "Call {phone}" -> "WhatsApp {phone}".', 'Shot 2: text added "Now {price}".']);
  });
  it("reelHowMade does not carry the hook's or the setting's numbers", () => {
    const how = reelHowMade({ title: "T", hook: "Only 45,000 RWF", setting: "shop at 0788 123 456", clips: [] });
    expect(how).not.toMatch(/45,000|0788/);
    expect(how).toContain("{price}");
  });
});

describe("posting times written the way people write them", () => {
  it("reads 7 am, 12:30 pm and 7 pm, and 19 h", () => {
    expect(parseScheduleNotes({ hours: "7 am, 12:30 pm and 7 pm" })?.hours).toEqual([7, 12, 19]);
    expect(parseScheduleNotes({ hours: "12 am, 19 h" })?.hours).toEqual([0, 19]);
    expect(parseScheduleNotes({ hours: "7 pm tomorrow" })).toBeNull();
  });
});

describe("the upload slot", () => {
  it("lets a file of the same name replace the old one", async () => {
    const slot = await createUploadSlot("admin/ex1/reel.mp4");
    expect(createSignedUploadUrl).toHaveBeenCalledWith("admin/ex1/reel.mp4", { upsert: true });
    expect(slot.token).toBe("tok");
  });
});
