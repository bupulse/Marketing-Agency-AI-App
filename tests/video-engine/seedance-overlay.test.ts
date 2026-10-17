import { describe, expect, it } from "vitest";
import { safeAreaFor } from "@/lib/video-engine/brain";
import { hasKinyarwanda } from "@/lib/video-engine/brain/score";
import { overlayHook, overlayTimings, seedanceOverlayCaption, seedanceOverlaySpec } from "@/lib/video-engine/seedance-overlay";
import type { PromptBrief } from "@/lib/video-engine/seedance-prompt";
import { YOUTUBE_MIDDLE_BAND, type MotionSpec, type TextLayer, type VideoLayer } from "@/lib/video-engine/spec";
import { validateSpec } from "@/lib/video-engine/validate";

const brief = (over: Partial<PromptBrief> = {}, business: Partial<PromptBrief["business"]> = {}): PromptBrief => ({
  business: { name: "Nova Phones Kigali", description: "New and refurbished phones in Kigali, with delivery", language: "English", country: "Rwanda", phone: "+250 788 300 400", ...business },
  product: { name: "Samsung Galaxy A56", price: "420,000 RWF", usps: ["Genuine with 12-month warranty"] },
  references: ["Image 1: the phone"],
  templateId: "phone-unboxing",
  seconds: 10,
  ratio: "9:16",
  audio: true,
  platform: "tiktok",
  ...over,
});
const URL = "/videos/seedance/sd-0123456789ab.mp4";
const texts = (spec: MotionSpec, i: number) => spec.scenes[i].layers.filter((l): l is TextLayer => l.kind === "text");
const all = (spec: MotionSpec) => spec.scenes.flatMap((s) => s.layers.filter((l): l is TextLayer => l.kind === "text"));
const digits = (s: string) => s.replace(/\D/g, "");
const hasPhone = (l: TextLayer) => digits(l.text).includes("788300400");

describe("Seedance overlay spec", () => {
  it("plays the clip straight through: one scene per shot, cuts, the clip's own sound, its full length", () => {
    const spec = seedanceOverlaySpec({ brief: brief(), clipUrl: URL });
    const total = spec.scenes.reduce((a, s) => a + s.seconds, 0);
    expect(total).toBeCloseTo(10, 5);
    let at = 0;
    for (const s of spec.scenes) {
      const v = s.layers[0] as VideoLayer;
      expect(v).toMatchObject({ kind: "video", url: URL, fit: "cover", sound: true, x: 0.5, y: 0.5, w: 1, h: 1 });
      expect(v.start).toBeCloseTo(at, 5);
      expect(s.transition).toBe("cut");
      at += s.seconds;
    }
    expect(spec.look?.grade).toBe("none");
    expect(spec.music).toBeNull();
  });

  it("hook in the first 3 s, price on the product shot, number on every scene, call to action on the last", () => {
    const b = brief();
    const spec = seedanceOverlaySpec({ brief: b, clipUrl: URL });
    const hook = overlayHook(b);
    let start = 0;
    spec.scenes.forEach((s, i) => {
      const t = texts(spec, i);
      const h = t.find((l) => l.text === hook);
      if (h) expect(start + (h.from ?? 0) * s.seconds).toBeLessThan(3);
      if (start >= 3) expect(h).toBeUndefined();
      expect(t.some(hasPhone), `scene ${i} has the number`).toBe(true);
      expect(t.some((l) => /to order/i.test(l.text))).toBe(i === spec.scenes.length - 1);
      start += s.seconds;
    });
    expect(texts(spec, 0).some((l) => l.text === hook)).toBe(true);
    expect(hook).not.toMatch(/RWF RWF/); // a pattern's own "RWF" after a price that has it
    const priced = spec.scenes.map((_, i) => texts(spec, i).some((l) => l.text === "420,000 RWF"));
    expect(priced.filter(Boolean)).toHaveLength(1);
    expect(priced[0]).toBe(false); // on the product shot, after the opening one
  });

  it("keeps every text inside the platform's safe area, at readable sizes; Shorts' contact sits in the middle band", () => {
    for (const platform of ["tiktok", "instagram", "facebook", "youtube", null]) {
      const spec = seedanceOverlaySpec({ brief: brief({ platform }), clipUrl: URL });
      const area = safeAreaFor(platform);
      for (const l of all(spec)) {
        const contact = platform === "youtube" && (hasPhone(l) || /RWF|order/i.test(l.text));
        const a = contact ? { ...area, ...YOUTUBE_MIDDLE_BAND } : area;
        expect(l.y - l.h / 2, `${platform} "${l.text}" top`).toBeGreaterThanOrEqual(a.top - 1e-9);
        expect(l.y + l.h / 2, `${platform} "${l.text}" bottom`).toBeLessThanOrEqual(a.bottom + 1e-9);
        expect(l.x - l.w / 2).toBeGreaterThanOrEqual(a.left - 1e-9);
        expect(l.x + l.w / 2).toBeLessThanOrEqual(a.right + 1e-9);
        expect(l.size).toBeGreaterThanOrEqual(0.03);
      }
      // No two texts of a scene overlap.
      for (const s of spec.scenes) {
        const t = s.layers.filter((l): l is TextLayer => l.kind === "text");
        for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) expect(Math.abs(t[i].y - t[j].y), `${platform} "${t[i].text}" / "${t[j].text}"`).toBeGreaterThanOrEqual((t[i].h + t[j].h) / 2 - 1e-9);
      }
    }
  });

  it("is already what the validator would make: it moves, resizes and adds nothing", () => {
    for (const platform of ["tiktok", "facebook", "youtube"]) {
      const spec = seedanceOverlaySpec({ brief: brief({ platform, seconds: 12 }), clipUrl: URL });
      const withoutVideo = { ...spec, scenes: spec.scenes.map((s) => ({ ...s, layers: s.layers.filter((l) => l.kind !== "video") })) };
      const checked: MotionSpec = validateSpec(JSON.parse(JSON.stringify(withoutVideo)), { ratio: "9:16", photoCount: 0, seconds: 12, platform, phone: "+250 788 300 400" });
      checked.scenes.forEach((s, i) => {
        const before = withoutVideo.scenes[i].layers as TextLayer[];
        expect(s.seconds).toBeCloseTo(spec.scenes[i].seconds, 2);
        expect(s.layers.map((l) => [(l as TextLayer).text, l.x, l.y, l.w, l.h, (l as TextLayer).size])).toEqual(before.map((l) => [l.text, l.x, l.y, l.w, l.h, l.size]));
      });
      expect(checked.hashtags).toEqual(spec.hashtags);
    }
  });

  it("joins shots shorter than a scene can be (a 4 s before/after has 1 s shots)", () => {
    const b = brief({ templateId: "services-before-after", seconds: 4 });
    const t = overlayTimings({ brief: b, clipUrl: URL });
    expect(t.every((s) => s.to - s.from >= 1.2)).toBe(true);
    expect(t[0].from).toBe(0);
    expect(t.at(-1)?.to).toBe(4);
    // A prompt's own time codes win over the plan; a real clip length rescales them.
    expect(overlayTimings({ brief: b, clipUrl: URL, prompt: "0-3s: a. 3-6s: b. 6-8s: c.", seconds: 8 }).map((s) => [s.from, s.to])).toEqual([[0, 3], [3, 6], [6, 8]]);
    expect(overlayTimings({ brief: b, clipUrl: URL, shots: [{ from: 0, to: 2 }, { from: 2, to: 4 }], seconds: 6 }).map((s) => [s.from, s.to])).toEqual([[0, 3], [3, 6]]);
  });

  it("a calm template keeps the number small on its first shot, then the bar", () => {
    const spec = seedanceOverlaySpec({ brief: brief({ templateId: "phone-hero", seconds: 8 }), clipUrl: URL });
    const first = texts(spec, 0).find(hasPhone)!;
    expect(first).toMatchObject({ size: 0.03, box: null });
    const later = texts(spec, 1).find(hasPhone)!;
    expect(later.box).not.toBeNull();
    expect(later.text).toMatch(/^Call\/WhatsApp/);
  });

  it("without a number: 'DM to order' and no number; without a price: no price", () => {
    const spec = seedanceOverlaySpec({ brief: { ...brief({}, { phone: null }), product: { name: "Samsung Galaxy A56" } }, clipUrl: URL });
    expect(all(spec).some(hasPhone)).toBe(false);
    expect(all(spec).some((l) => /RWF/.test(l.text))).toBe(false);
    expect(texts(spec, spec.scenes.length - 1).some((l) => l.text === "DM to order")).toBe(true);
  });

  it("wide shapes keep text small enough and inside the frame margin", () => {
    const spec = seedanceOverlaySpec({ brief: brief({ ratio: "16:9" }), clipUrl: URL });
    expect(spec.ratio).toBe("16:9");
    for (const l of all(spec)) {
      expect(l.size).toBeGreaterThanOrEqual(0.03);
      expect(l.size).toBeLessThanOrEqual(0.03);
      expect(l.y - l.h / 2).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(l.y + l.h / 2).toBeLessThanOrEqual(0.95 + 1e-9);
    }
    expect(seedanceOverlaySpec({ brief: brief({ ratio: "adaptive" }), clipUrl: URL }).ratio).toBe("9:16");
  });
});

describe("Kinyarwanda business", () => {
  const rw = brief({ platform: "facebook" }, { language: "Kinyarwanda" });

  it("writes the price, the number and the call to action in Kinyarwanda", () => {
    const spec = seedanceOverlaySpec({ brief: rw, clipUrl: URL });
    const words = all(spec).map((l) => l.text);
    expect(words).toContain("Kuri 420,000 RWF gusa");
    expect(words.some((w) => /^Duhamagare: 0788 300 400$/.test(w))).toBe(true);
    expect(words).toContain("Duhamagare cyangwa utwandikire");
    expect(overlayHook(rw)).toBe("Kuri 420,000 RWF tuguha Samsung Galaxy A56");
    expect(words.join(" ")).not.toMatch(/\b(Call|order)\b/);
  });

  it("the caption speaks Kinyarwanda and passes the Brain's caption check", () => {
    const c = seedanceOverlayCaption(rw);
    expect(hasKinyarwanda(c.caption)).toBe(true);
    expect(c.score.missed).toEqual([]);
  });
});

describe("caption", () => {
  it("passes scoreCaption on every platform and language", () => {
    for (const platform of ["tiktok", "instagram", "facebook", "youtube", null]) {
      for (const language of ["English", "French", "Kinyarwanda"]) {
        const c = seedanceOverlayCaption(brief({ platform }, { language }));
        expect(c.score.missed, `${platform} ${language}: ${c.caption}`).toEqual([]);
        expect(c.caption.slice(0, platform === "youtube" ? 40 : 60)).toMatch(/Galaxy A56/);
      }
    }
  });

  it("uses only the brief's facts: no number or price it does not give", () => {
    const c = seedanceOverlayCaption({ ...brief({}, { phone: null }), product: { name: "Kitenge summer dress" } });
    expect(c.caption).not.toMatch(/\d{3}/);
    expect(c.score.missed).toEqual([]);
    expect(c.hashtags.some((t) => /kigali|rwanda/i.test(t))).toBe(true);
  });
});
