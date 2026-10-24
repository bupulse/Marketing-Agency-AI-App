import { describe, expect, it } from "vitest";
import type { ExampleRow } from "@/lib/training-lab/match";
import { viralRowFromExample, viralRowsFrom } from "@/lib/training-lab/viral-rows";

const ex = (over: Partial<ExampleRow> = {}): ExampleRow => ({
  id: "abc", kind: "reel", title: "Kigali car seller", howMade: "Phone.", whatIsGood: "Price sticker first.", neverThis: null, notes: null, tags: [], sector: "car-rental", language: "Kinyarwanda",
  technique: [], rating: 5, consentGiven: false, engines: ["reel"], transcript: null, createdAt: new Date("2026-10-01"), ...over,
});

describe("viralRowFromExample", () => {
  it("fills only what is said and keeps neutral defaults", () => {
    const row = viralRowFromExample(ex())!;
    expect(row).toMatchObject({ id: "lab:abc", sector: "car-rental", language: "Kinyarwanda", country: "RW", region: "east-africa", platform: "instagram", format: "product-reveal", hookType: "curiosity", strength: 0.6, priceShown: false, phoneShown: false, needs: ["filmed"], group: "lab:abc", why: "Price sticker first." });
    expect(row.beats).toEqual([{ from: 0, to: 3, role: "hook", beat: "Hook", what: "Price sticker first." }, { from: 3, to: 15, role: "show", beat: "Show", what: "Price sticker first." }]);
    expect(row.reach).toContain("5 of 5");
  });
  it("reads the notes the analysis drafts", () => {
    const row = viralRowFromExample(
      ex({ technique: ["price-banner", "offer"], notes: { Hook: "45,000 RWF today", "first 3s": "Price banner over the car", cuts_per_second: 0.8, camera: "handheld, punch-in", music: ["amapiano", "120 bpm"], price_shown: true, duration: 20, on_screen_text: ["Call +250 788 123 456", "Visit www.example.com", "Best price"], beats: [{ from: 0, to: 4, role: "hook", beat: "Banner", what: "Price" }, { from: 4, to: 20, role: "cta", what: "Call" }, { from: 9, to: 2, what: "bad" }] } }),
    )!;
    expect(row).toMatchObject({ hookType: "price-banner", format: "offer", hook: "45,000 RWF today", first3s: "Price banner over the car", cutsPer10s: 8, camera: "handheld, punch-in", music: "amapiano, 120 bpm", priceShown: true, seconds: 20 });
    expect(row.beats.map((b) => b.role)).toEqual(["hook", "cta"]);
    expect(row.textPatterns).toEqual(["Call {phone}", "Visit {website}", "Best price"]);
  });
  it("scores by the owner's rating and drops 1 and 2 stars", () => {
    expect(viralRowFromExample(ex({ rating: 4 }))!.strength).toBe(0.45);
    expect(viralRowFromExample(ex({ rating: null }))!.strength).toBe(0.3);
    expect(viralRowFromExample(ex({ rating: 2 }))).toBeNull();
    expect(viralRowFromExample(ex({ rating: 1 }))).toBeNull();
  });
  it("takes only reels and videos", () => {
    expect(viralRowFromExample(ex({ kind: "image" }))).toBeNull();
    expect(viralRowFromExample(ex({ kind: "voice" }))).toBeNull();
    expect(viralRowsFrom([ex(), ex({ id: "b", kind: "video" }), ex({ id: "c", kind: "actor" }), ex({ id: "d", rating: 1 })]).map((r) => r.id)).toEqual(["lab:abc", "lab:b"]);
  });
  it("does not change the example", () => {
    const e = Object.freeze(ex({ notes: Object.freeze({ hook: "x" }) }));
    expect(() => viralRowFromExample(e)).not.toThrow();
  });
});
