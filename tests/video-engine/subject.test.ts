import { describe, expect, it } from "vitest";
import { SAFE_AREAS as BRAIN_SAFE_AREAS } from "@/lib/video-engine/brain/score";
import { STRICT_AREA, safeAreaFor } from "@/lib/video-engine/validate";
import { DEFAULT_SUBJECT, keepOffSubject, sceneSubject, subjectOnCanvas, textHeight } from "@/lib/video-engine/subject";
import { MIN_READ_SECONDS, validateSpec } from "@/lib/video-engine/validate";
import type { Layer, TextLayer } from "@/lib/video-engine/spec";

const text = (over: Record<string, unknown> = {}) => ({ kind: "text", text: "420,000 RWF", font: "poppins", size: 0.08, color: "#ffffff", x: 0.5, y: 0.5, w: 0.8, h: 0.12, ...over });
const square = { width: 1024, height: 1024 };
const overlapShare = (t: Layer, s: { x: number; y: number; w: number; h: number }) => {
  const ox = Math.max(0, Math.min(t.x + t.w / 2, s.x + s.w) - Math.max(t.x - t.w / 2, s.x));
  const oy = Math.max(0, Math.min(t.y + t.h / 2, s.y + s.h) - Math.max(t.y - t.h / 2, s.y));
  return (ox * oy) / (t.w * t.h);
};

describe("where the product is on the canvas", () => {
  it("a square photo filling a 9:16 frame: its centre 60% covers the middle of the frame, cut at the sides", () => {
    const s = subjectOnCanvas({ x: 0, y: 0, w: 1, h: 1 }, "9:16", square)!;
    expect(s.y).toBeCloseTo(0.2, 2);
    expect(s.h).toBeCloseTo(0.6, 2);
    expect(s.x).toBe(0);
    expect(s.w).toBe(1);
  });

  it("a contained photo in a box; the cut-out's own box when known", () => {
    const s = subjectOnCanvas({ x: 0.1, y: 0.25, w: 0.8, h: 0.4 }, "9:16", square, "contain")!;
    // 1024² contained in 864x768 px: 768 px square, centred; its centre 60%.
    expect(s.x * 1080).toBeCloseTo(108 + 48 + 0.2 * 768, 0);
    expect(s.y * 1920).toBeCloseTo(480 + 0.2 * 768, 0);
    const cut = subjectOnCanvas({ x: 0.1, y: 0.25, w: 0.8, h: 0.4 }, "9:16", { ...square, subject: { x: 0.4, y: 0.1, w: 0.2, h: 0.8 } }, "contain")!;
    expect(cut.w * 1080).toBeCloseTo(0.2 * 768, 0);
    expect(cut.h * 1920).toBeCloseTo(0.8 * 768, 0);
  });

  it("the scene's subject: the biggest photo layer, a turntable's product with its shadow (its whole box when the photo is unknown), or an unblurred background photo", () => {
    const bg = { kind: "photo" as const, colors: ["#000"], photo: 1 };
    expect(sceneSubject({ background: bg, layers: [] }, "9:16", [square])).not.toBeNull();
    expect(sceneSubject({ background: { ...bg, blur: 20 }, layers: [] }, "9:16", [square])).toBeNull();
    const tt = { kind: "photo" as const, photo: 1, x: 0.5, y: 0.5, w: 0.7, h: 0.5, turntable: { spin: 1 } };
    const t = sceneSubject({ background: { kind: "solid", colors: ["#000"] }, layers: [tt] }, "9:16", [square])!;
    // The product on its turntable, inside the box, with the shadow under it but not the whole reflection.
    expect(t.y).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(t.y + t.h).toBeLessThan(0.75);
    expect(t.x).toBeGreaterThanOrEqual(0.15 - 1e-9);
    const unknown = sceneSubject({ background: { kind: "solid", colors: ["#000"] }, layers: [tt] }, "9:16", [])!;
    for (const [k, v] of Object.entries({ x: 0.15, y: 0.25, w: 0.7, h: 0.5 })) expect(unknown[k as "x"]).toBeCloseTo(v, 9);
    expect(DEFAULT_SUBJECT).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  });
});

describe("text is kept off the product", () => {
  const check = (layers: unknown[], background: unknown = { kind: "solid", colors: ["#000"] }, photos = [square]) =>
    validateSpec({ palette: {}, scenes: [{ seconds: 4, background, layers }, { seconds: 4, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 1, seconds: 8, photos }).scenes[0].layers;

  it("tiktok-3-reasons scene 1: text over a full-frame product photo goes to the top and bottom bands, type stays large", () => {
    const layers = check(
      [
        text({ text: "3 REASONS", font: "anton", size: 0.19, y: 0.25, h: 0.2, w: 0.86 }),
        text({ text: "to buy the Samsung Galaxy A56", size: 0.06, y: 0.42, h: 0.14 }),
        text({ text: "420,000 RWF", font: "anton", size: 0.12, y: 0.58, h: 0.12, box: { color: "#f4b400" }, color: "#0a1a3f" }),
        { kind: "shape", shape: "rect", color: "#2f6bff", x: 0.5, y: 0.76, w: 0.86, h: 0.06, radius: 0.5 },
        text({ text: "Call / WhatsApp 0788 300 400", size: 0.045, y: 0.76, h: 0.05 }),
      ],
      { kind: "photo", colors: ["#000"], photo: 1, blur: 6, dim: 0.55 },
    );
    const texts = layers.filter((l): l is TextLayer => l.kind === "text");
    // Nothing sits across the middle of the product any more.
    for (const t of texts) expect(t.y < 0.36 || t.y > 0.62).toBe(true);
    expect(texts.map((t) => t.text)).toEqual(["3 REASONS", "to buy the Samsung Galaxy A56", "420,000 RWF", "Call / WhatsApp 0788 300 400"]);
    expect(texts[0].size).toBeGreaterThanOrEqual(0.19 * 0.7 - 1e-9);
    expect(texts[1].size).toBeGreaterThanOrEqual(0.06 * 0.7 - 1e-9);
    // The phone bar moved with its number.
    const bar = layers.find((l) => l.kind === "shape")!;
    expect(Math.abs(bar.y - texts[3].y)).toBeLessThan(0.01);
    // Texts in a band do not overlap each other.
    for (let i = 1; i < texts.length; i++) if ((texts[i].y < 0.5) === (texts[i - 1].y < 0.5)) expect(texts[i].y - texts[i].h / 2).toBeGreaterThanOrEqual(texts[i - 1].y + texts[i - 1].h / 2 - 1e-9);
  });

  it("text over a framed photo moves above or below the frame; text beside it, a giant backdrop word and blurred backgrounds stay", () => {
    const frame = { kind: "photo", photo: 1, x: 0.5, y: 0.45, w: 0.8, h: 0.4, fit: "contain" };
    const [, over, beside, giant] = check([frame, text({ y: 0.5 }), text({ y: 0.8, h: 0.06 }), text({ text: "GALAXY", font: "anton", size: 0.36, depth: 0.2, y: 0.4, w: 1.4, h: 0.25 })]);
    const s = subjectOnCanvas({ x: 0.1, y: 0.25, w: 0.8, h: 0.4 }, "9:16", square, "contain")!;
    expect(overlapShare(over, s)).toBeLessThanOrEqual(0.15);
    // The text already below the frame shares the band with the moved one: restacked, still clear of the product.
    expect(overlapShare(beside, s)).toBe(0);
    expect(beside.y).toBeGreaterThan(s.y + s.h);
    expect(giant).toMatchObject({ y: 0.4, size: 0.36 });
    expect(check([text({ y: 0.5 })], { kind: "photo", colors: ["#000"], photo: 1, blur: 20 })[0]).toMatchObject({ y: 0.5 });
  });

  it("is stable: a repaired scene repairs to itself", () => {
    const layers = check([text({ text: "3 REASONS", font: "anton", size: 0.19, y: 0.25, h: 0.2 }), text({ y: 0.58 })], { kind: "photo", colors: ["#000"], photo: 1 });
    const subject = subjectOnCanvas({ x: 0, y: 0, w: 1, h: 1 }, "9:16", square);
    expect(keepOffSubject(layers, subject, safeAreaFor(null))).toEqual(layers);
  });

  it("measures text by its lines, not by an oversized box", () => {
    const t = { ...text({ text: "3 REASONS", font: "anton", size: 0.19, h: 0.4, w: 0.86 }), kind: "text" as const } as TextLayer;
    expect(textHeight(t, "9:16")).toBeLessThan(0.15);
  });
});

describe("safe areas per platform and reading time", () => {
  it("the safe areas are the brain's (YouTube Shorts is 'shorts' there); no platform: the strictest common box", () => {
    expect(safeAreaFor("youtube")).toEqual(BRAIN_SAFE_AREAS.shorts);
    for (const k of ["tiktok", "instagram", "facebook"] as const) expect(safeAreaFor(k)).toEqual(BRAIN_SAFE_AREAS[k]);
    expect(safeAreaFor(null)).toEqual(STRICT_AREA);
    expect(STRICT_AREA).toEqual({ top: 0.12, bottom: 0.78, left: 0.07, right: 0.85 });
  });

  it("on YouTube Shorts the price, the phone and the call to action sit in the middle band; other text in the Shorts area", () => {
    const spec = validateSpec(
      { palette: {}, scenes: [{ seconds: 4, background: {}, layers: [text({ text: "WhatsApp 0788 300 400", y: 0.85, h: 0.06 }), text({ text: "Made for Kigali", y: 0.8, h: 0.06 })] }, { seconds: 4, background: {}, layers: [] }] },
      { ratio: "9:16", photoCount: 0, seconds: 8, platform: "youtube" },
    );
    const [phone, line] = spec.scenes[0].layers;
    expect(phone.y + phone.h / 2).toBeLessThanOrEqual(0.7 + 1e-9);
    expect(line.y + line.h / 2).toBeLessThanOrEqual(0.75 + 1e-9);
    expect(line.x + line.w / 2).toBeLessThanOrEqual(0.85 + 1e-9);
  });

  it("a text that would arrive too late to read comes in earlier; thin display serifs are at least 0.065", () => {
    const spec = validateSpec(
      { palette: {}, scenes: [{ seconds: 2, background: {}, layers: [text({ text: "Instalments available", font: "dm-serif", size: 0.04, from: 0.55, animate: "blurIn" }), text({ from: 0.1 })] }, { seconds: 4, background: {}, layers: [] }] },
      { ratio: "9:16", photoCount: 0, seconds: 6 },
    );
    const [late, early] = spec.scenes[0].layers as TextLayer[];
    const seconds = spec.scenes[0].seconds;
    expect(((late.to ?? 1) - (late.from ?? 0)) * seconds).toBeGreaterThanOrEqual(MIN_READ_SECONDS + 0.6 - 1e-6);
    expect(late.size).toBe(0.065);
    expect(early.from).toBe(0.1);
  });
});

describe("loop 6: other products", () => {
  const check = (layers: unknown[], background: unknown = { kind: "solid", colors: ["#000"] }, photos = [square, square]) =>
    validateSpec({ palette: {}, scenes: [{ seconds: 4, background, layers }, { seconds: 4, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 2, seconds: 8, photos }).scenes[0].layers;

  it("a price is never a giant backdrop word: at most 0.22 and kept inside the safe area", () => {
    const [price, word] = check([text({ text: "25,000 RWF", font: "anton", size: 0.36, depth: 0.2, w: 1.2, y: 0.2, h: 0.2 }), text({ text: "KITENGE", font: "anton", size: 0.36, depth: 0.2, w: 1.4, y: 0.4, h: 0.25 })]);
    expect(price).toMatchObject({ size: 0.22 });
    expect(price.x - price.w / 2).toBeGreaterThanOrEqual(0.07 - 1e-9);
    expect(price.x + price.w / 2).toBeLessThanOrEqual(0.85 + 1e-9);
    expect(word).toMatchObject({ size: 0.36, w: 1.4 });
  });

  it("text on a badge fits inside it", () => {
    const [, onBurst] = check([{ kind: "shape", shape: "burst", color: "#ffd200", x: 0.5, y: 0.3, w: 0.5, h: 0.25 }, text({ text: "25,000 RWF", color: "#7a0010", x: 0.45, y: 0.3, w: 0.8, h: 0.1 })]);
    expect(onBurst).toMatchObject({ w: 0.4, x: 0.5 });
  });

  it("with two products side by side, text keeps off both", () => {
    const layers = check([
      { kind: "photo", photo: 1, x: 0.3, y: 0.5, w: 0.35, h: 0.3, fit: "contain" },
      { kind: "photo", photo: 2, x: 0.7, y: 0.5, w: 0.35, h: 0.3, fit: "contain" },
      text({ text: "New every week", x: 0.5, y: 0.55, w: 0.8, h: 0.06 }),
    ]);
    const caption = layers.find((l) => l.kind === "text")!;
    expect(caption.y + caption.h / 2 <= 0.35 + 0.01 || caption.y - caption.h / 2 >= 0.65 - 0.01).toBe(true);
  });

  it("text that must stay over a full-frame product gets a caption box, and the scene repairs to itself", () => {
    const bg = { kind: "photo", colors: ["#000"], photo: 1 };
    const layers = check([{ kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 1, h: 1 }, text({ text: "Ikanzu y'icyi", y: 0.5, color: "#ffffff" })], bg);
    const caption = layers.find((l) => l.kind === "text") as TextLayer;
    expect(caption.box).toMatchObject({ color: "rgba(0,0,0,0.55)" });
    const subject = sceneSubject({ background: bg as never, layers }, "9:16", [square, square]);
    expect(keepOffSubject(layers, subject, safeAreaFor(null))).toEqual(layers);
  });
});

describe("a badge moves with its text off the product", () => {
  it("a big burst holding the price leaves the house with the price, cut down to its size", () => {
    const layers = validateSpec(
      {
        palette: {},
        scenes: [
          { seconds: 4, background: { kind: "photo", photo: 1 }, layers: [{ kind: "shape", shape: "burst", color: "#ffd200", x: 0.5, y: 0.45, w: 0.8, h: 0.4 }, text({ text: "120,000,000 RWF", color: "#111111", y: 0.45, w: 0.7, h: 0.08 })] },
          { seconds: 4, background: {}, layers: [] },
        ],
      },
      { ratio: "9:16", photoCount: 1, seconds: 8, photos: [square] },
    ).scenes[0].layers;
    const [burst, price] = layers;
    expect(price.y < 0.36 || price.y > 0.62).toBe(true);
    expect(Math.abs(burst.y - price.y)).toBeLessThan(1e-9);
    expect(burst.h).toBeLessThan(0.4);
    expect(burst.w).toBeLessThanOrEqual(0.7 * 1.15 + 1e-9);
  });
});

describe("a stray badge over the product", () => {
  it("moves behind the price when there is one, and is dropped when there is none", () => {
    const run = (layers: unknown[]) =>
      validateSpec({ palette: {}, scenes: [{ seconds: 4, background: { kind: "photo", photo: 1 }, layers }, { seconds: 4, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 1, seconds: 8, photos: [square] }).scenes[0].layers;
    const burst = { kind: "shape", shape: "burst", color: "#ffd200", x: 0.5, y: 0.5, w: 0.8, h: 0.4 };
    const moved = run([burst, text({ text: "120,000,000 RWF", color: "#111111", y: 0.15, w: 0.7, h: 0.08 })]);
    const [b, price] = moved;
    expect(b.kind).toBe("shape");
    expect(Math.abs(b.y - price.y)).toBeLessThan(0.02);
    expect(b.h).toBeLessThan(0.4);
    expect(run([burst, text({ text: "Ready to move in", y: 0.15, h: 0.08 })]).some((l) => l.kind === "shape")).toBe(false);
  });
});
