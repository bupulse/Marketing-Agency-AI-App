import { describe, expect, it } from "vitest";
import { scoreDesign } from "@/lib/video-engine/brain/score";
import type { PhotoLayer } from "@/lib/video-engine/spec";
import { cutoutBox, sceneSubject } from "@/lib/video-engine/subject";
import { productMinHeight } from "@/lib/video-engine/templates";
import { validateSpec, type ValidateOptions } from "@/lib/video-engine/validate";

// A dress photographed upright: 1000 x 1500, the dress in the middle 40% wide and 80% tall.
const DRESS = { width: 1000, height: 1500, subject: { x: 0.3, y: 0.1, w: 0.4, h: 0.8 } };
const cut = (over: Record<string, unknown> = {}) => ({ kind: "photo", photo: 1, fit: "contain", cutout: true, x: 0.5, y: 0.5, w: 0.4, h: 0.25, ...over });
const text = (over: Record<string, unknown> = {}) => ({ kind: "text", text: "Kitenge summer dress", font: "poppins", size: 0.05, color: "#ffffff", x: 0.5, y: 0.2, w: 0.8, h: 0.07, ...over });
const opts = (over: Partial<ValidateOptions> = {}): ValidateOptions => ({ ratio: "9:16", photoCount: 1, seconds: 6, photos: [DRESS], productMin: 0.45, ...over });
const design = (layers: unknown[], o: Partial<ValidateOptions> = {}) => validateSpec({ palette: { background: "#7a1f3d" }, scenes: [{ seconds: 3, background: {}, layers }, { seconds: 3, background: {}, layers: [text({ text: "Order on WhatsApp" })] }] }, opts(o));
const productOf = (spec: ReturnType<typeof design>) => cutoutBox(spec.scenes[0].layers.find((l) => l.kind === "photo") as PhotoLayer, "9:16", DRESS);

describe("cut-out products fill the frame (loop 8)", () => {
  it("measures where a cut-out is drawn: the product alone, fitted into its box", () => {
    const b = cutoutBox(cut() as PhotoLayer, "9:16", DRESS);
    expect(b?.h).toBeCloseTo(0.25, 3);
    expect(cutoutBox({ ...(cut() as PhotoLayer), cutout: false }, "9:16", DRESS)).toBeNull();
    expect(cutoutBox(cut() as PhotoLayer, "9:16", { width: 1000, height: 1500 })).toBeNull();
    // The scene's subject is the drawn product, not its place in the whole photo.
    expect(sceneSubject({ layers: [cut() as PhotoLayer], background: { kind: "solid", colors: ["#000"] } }, "9:16", [DRESS])?.h).toBeCloseTo(0.25, 2);
  });

  it("a quarter-height dress grows to at least 45% of the frame around its centre, and the text moves off it", () => {
    const spec = design([cut(), text({ y: 0.5 })]);
    const p = productOf(spec);
    expect(p!.h).toBeGreaterThanOrEqual(0.45 * 0.95);
    expect(p!.y).toBeGreaterThanOrEqual(0.04 - 1e-9);
    expect(p!.y + p!.h).toBeLessThanOrEqual(0.96 + 1e-9);
    const t = spec.scenes[0].layers.find((l) => l.kind === "text" && l.text.startsWith("Kitenge"))!;
    expect(t.y + t.h / 2 <= p!.y + 0.02 || t.y - t.h / 2 >= p!.y + p!.h - 0.02).toBe(true);
  });

  it("55% on product templates, as designed on text-led ones and when no minimum is given", () => {
    expect(productMinHeight("product-hero")).toBe(0.55);
    expect(productMinHeight("showroom-turntable")).toBe(0.55);
    expect(productMinHeight("kigali-price-first")).toBe(0.45);
    expect(productMinHeight("typography-poster")).toBe(0);
    expect(productOf(design([cut()], { productMin: 0.55 }))!.h).toBeGreaterThanOrEqual(0.55 * 0.95);
    expect(productOf(design([cut()], { productMin: 0 }))!.h).toBeCloseTo(0.25, 2);
    expect(productOf(design([cut()], { productMin: undefined }))!.h).toBeCloseTo(0.25, 2);
  });

  it("a wide product stops at 90% of the frame width; two cut-outs side by side are left as designed", () => {
    const shoe = { width: 1500, height: 1000, subject: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 } };
    const spec = design([cut({ w: 0.5, h: 0.2 })], { photos: [shoe] });
    const p = cutoutBox(spec.scenes[0].layers[0] as PhotoLayer, "9:16", shoe)!;
    expect(p.w).toBeLessThanOrEqual(0.9 + 1e-3);
    expect(p.w).toBeGreaterThan(0.85);
    const two = design([cut({ x: 0.28 }), cut({ x: 0.72 })], { photos: [DRESS] });
    expect(two.scenes[0].layers.filter((l) => l.kind === "photo").map((l) => l.h)).toEqual([0.25, 0.25]);
  });

  it("a cut-out on a turntable grows too, and the repair is stable on a second pass", () => {
    const spec = design([cut({ turntable: { spin: 1 }, w: 0.5, h: 0.3 }), text()]);
    expect(productOf(spec)!.h).toBeGreaterThanOrEqual(0.45 * 0.95);
    expect(validateSpec(spec, opts())).toEqual(spec);
    const flat = design([cut(), text({ y: 0.5 })]);
    expect(validateSpec(flat, opts())).toEqual(flat);
  });
});

describe("the number says what it is for (number-labelled)", () => {
  it("the end card's bare number is labelled, and the scorer counts the repair", () => {
    const spec = validateSpec(
      { palette: {}, scenes: [{ seconds: 3, background: {}, layers: [text({ text: "Galaxy A56" }), text({ text: "0788 300 400", y: 0.7, size: 0.03 })] }, { seconds: 3, background: {}, layers: [text({ text: "Order today", y: 0.3 }), text({ text: "0788 300 400", y: 0.6 })] }] },
      { ratio: "9:16", photoCount: 0, seconds: 6, phone: "+250 788 300 400" },
    );
    // The quiet number in scene 1 stays bare; the end card is labelled.
    expect(spec.scenes[0].layers.some((l) => l.kind === "text" && l.text === "0788 300 400")).toBe(true);
    expect(spec.scenes[1].layers.some((l) => l.kind === "text" && l.text === "WhatsApp 0788 300 400")).toBe(true);
    const score = scoreDesign(spec, { business: { name: "Nova Phones", phone: "+250 788 300 400" }, product: { name: "Galaxy A56", price: null }, styleId: "kigali-price-first", ratio: "9:16" } as never, { platform: "tiktok" });
    expect(score.passed.map((i) => i.id)).toContain("number-labelled");
  });
});

describe("a cut-out too big for its text", () => {
  it("shrinks to the room the text leaves (not below 35%), the text clears it, and a second pass changes nothing", () => {
    const layers = [
      cut({ w: 0.62, h: 0.465 }),
      text({ text: "IMPAMVU 3", font: "anton", size: 0.112, y: 0.16, h: 0.078 }),
      text({ text: "zo kugura iyi kanzu", size: 0.039, y: 0.234, h: 0.032 }),
      text({ text: "25,000 RWF", size: 0.049, y: 0.289, h: 0.038 }),
      text({ text: "Hamagara 0788 123 456", size: 0.034, y: 0.759, h: 0.035 }),
    ];
    const spec = design(layers, { phone: "+250 788 123 456" });
    const p = productOf(spec)!;
    expect(p.h).toBeLessThan(0.465);
    expect(p.h).toBeGreaterThanOrEqual(0.35);
    const price = spec.scenes[0].layers.find((l) => l.kind === "text" && l.text === "25,000 RWF")!;
    expect(price.y + price.h / 2).toBeLessThanOrEqual(p.y + 0.01);
    expect(validateSpec(spec, opts({ phone: "+250 788 123 456" }))).toEqual(spec);
  });
});

describe("a badge moved off the product keeps its shape", () => {
  it("a burst shrinks evenly, and the price it can no longer hold gets a box in the burst's colour", () => {
    const spec = design([{ kind: "shape", shape: "burst", color: "#f2b705", x: 0.46, y: 0.3, w: 0.78, h: 0.25 }, text({ text: "25,000 RWF", font: "anton", color: "#8a0f3d", size: 0.12, x: 0.46, y: 0.3, h: 0.14, w: 0.78 }), cut({ w: 0.46, h: 0.36, y: 0.54 })]);
    const [burst, price] = spec.scenes[0].layers as unknown as [{ w: number; h: number }, { box?: { color: string } }];
    expect(burst.w / burst.h).toBeCloseTo(0.78 / 0.25, 1);
    expect(price.box?.color).toBe("#f2b705");
    expect(validateSpec(spec, opts())).toEqual(spec);
  });
});

describe("no invented ratings, and the template's line limit", () => {
  const base = (layers: unknown[], say?: string) => ({ palette: {}, caption: "Kitenge summer dress, 25,000 RWF. Rated 5 stars by our customers!\nWhatsApp 0788 123 456", scenes: [{ seconds: 3, background: {}, say, layers }, { seconds: 3, background: {}, layers: [text({ text: "Order on WhatsApp" })] }] });
  const o = { ratio: "9:16" as const, photoCount: 0, seconds: 6 };

  it("a star rating or review count the facts do not give is dropped, with its pill, its spoken sentence and its caption sentence", () => {
    const spec = validateSpec(base([text({ text: "Kitenge summer dress", y: 0.3 }), { kind: "shape", shape: "rect", color: "#ffd200", x: 0.5, y: 0.6, w: 0.6, h: 0.06 }, text({ text: "★★★★★ 5 stars", y: 0.6, h: 0.05 })], "A light summer dress. Our customers love it."), { ...o, facts: "Kitenge summer dress. Light cotton." });
    const s = spec.scenes[0];
    expect(s.layers.some((l) => l.kind === "text" && /star/i.test(l.text))).toBe(false);
    expect(s.layers.some((l) => l.kind === "shape")).toBe(false);
    expect(s.say).toBe("A light summer dress.");
    expect(spec.caption).toBe("Kitenge summer dress, 25,000 RWF.\nWhatsApp 0788 123 456");
    // When the facts give the rating, it stays; without facts (an owner's edit), nothing is checked.
    expect(validateSpec(base([text({ text: "Rated 4.8 stars" })]), { ...o, facts: "Rated 4.8 stars on Google" }).scenes[0].layers).toHaveLength(1);
    expect(validateSpec(base([text({ text: "5 stars" })]), o).scenes[0].layers).toHaveLength(1);
  });

  it("a scene over the line limit sends its smallest line to a scene with room; the price and the number do not count", () => {
    const spec = validateSpec(
      {
        palette: {},
        scenes: [
          { seconds: 3, background: {}, layers: [text({ text: "Lunch offer", size: 0.08, y: 0.2 }), text({ text: "Grilled tilapia", size: 0.05, y: 0.35 }), text({ text: "Chips and kachumbari", size: 0.035, y: 0.45 }), text({ text: "8,500 RWF", size: 0.07, y: 0.55 }), text({ text: "WhatsApp 0788 123 456", size: 0.04, y: 0.7 })] },
          { seconds: 3, background: {}, layers: [text({ text: "Kigali Grill House", y: 0.3 })] },
        ],
      },
      { ...o, maxLines: 2 },
    );
    const lines = (i: number) => spec.scenes[i].layers.filter((l) => l.kind === "text").map((l) => (l as { text: string }).text);
    expect(lines(0)).toEqual(["Lunch offer", "Grilled tilapia", "8,500 RWF", "WhatsApp 0788 123 456"]);
    expect(lines(1)).toContain("Chips and kachumbari");
  });
});

describe("page posts (purpose post)", () => {
  const raw = {
    palette: {},
    scenes: [
      { seconds: 3, background: {}, layers: [text({ text: "New kitenge prints", y: 0.3 }), text({ text: "WhatsApp 0788 123 456", y: 0.7, size: 0.035 })] },
      { seconds: 3, background: {}, layers: [text({ text: "Made in Kigali", y: 0.3 })] },
      { seconds: 3, background: {}, layers: [text({ text: "E2E Starter Test", y: 0.4 }), text({ text: "0788 123 456", y: 0.6 })] },
    ],
  };
  const o = { ratio: "9:16" as const, photoCount: 0, seconds: 9, phone: "+250788123456" };
  const texts = (spec: ReturnType<typeof validateSpec>, i: number) => spec.scenes[i].layers.filter((l) => l.kind === "text").map((l) => (l as { text: string }).text);

  it("a post shows the number on the end card only: no quiet line added, earlier number lines removed, no 'Call or WhatsApp' push", () => {
    const post = validateSpec(raw, { ...o, purpose: "post" });
    expect(texts(post, 0)).toEqual(["New kitenge prints"]);
    expect(texts(post, 1)).toEqual(["Made in Kigali"]);
    expect(texts(post, 2)).toEqual(["E2E Starter Test", "0788 123 456"]);
  });

  it("an ad is unchanged: the quiet line in every scene and the labelled number at the end", () => {
    const ad = validateSpec(raw, o);
    expect(texts(ad, 1).some((t) => t.includes("0788 123 456"))).toBe(true);
    expect(texts(ad, 2)).toContain("Call or WhatsApp 0788 123 456");
  });
});

describe("drawn star ratings and badges off their price", () => {
  const o = { ratio: "9:16" as const, photoCount: 0, seconds: 6 };
  const star = (x: number) => ({ kind: "shape", shape: "burst", color: "#f5b301", x, y: 0.255, w: 0.07, h: 0.04 });
  const two = (layers: unknown[]) => ({ palette: {}, scenes: [{ seconds: 3, background: {}, layers }, { seconds: 3, background: {}, layers: [text({ text: "Visit us in Kibagabaga" })] }] });

  it("a row of five small identical stars is dropped like a rating when the facts give none; one star or a facts rating stays", () => {
    const row = [0.3, 0.4, 0.5, 0.6, 0.7].map(star);
    const dropped = validateSpec(two([text({ text: "120,000,000 RWF", y: 0.18 }), ...row]), { ...o, facts: "3-bedroom house in Kibagabaga" });
    expect(dropped.scenes[0].layers.some((l) => l.kind === "shape")).toBe(false);
    expect(validateSpec(two([text({ text: "120,000,000 RWF", y: 0.18 }), ...row]), { ...o, facts: "Rated 5 stars by our tenants" }).scenes[0].layers.filter((l) => l.kind === "shape")).toHaveLength(5);
    expect(validateSpec(two([text({ text: "New", y: 0.18 }), star(0.5)]), { ...o, facts: "house" }).scenes[0].layers.filter((l) => l.kind === "shape")).toHaveLength(1);
  });

  it("a burst centred below its price is centred on it, fits the frame, and arrives with it", () => {
    const spec = validateSpec(two([{ kind: "shape", shape: "burst", color: "#ffd400", x: 0.5, y: 0.33, w: 0.92, h: 0.42 }, text({ text: "120,000,000 RWF", color: "#111111", y: 0.155, w: 0.7, h: 0.07, from: 0.1 })]), o);
    const [burst, price] = spec.scenes[0].layers as unknown as [{ x: number; y: number; w: number; h: number; from: number }, { y: number; from: number; box?: { color: string } }];
    expect(Math.abs(burst.y - price.y)).toBeLessThan(0.03);
    expect(burst.y - burst.h / 2).toBeGreaterThanOrEqual(-0.001);
    expect(burst.from).toBe(price.from);
    // Cut down to fit the frame, it can no longer hold the whole line: the price gets a box in the burst's colour.
    expect(price.box?.color).toBe("#ffd400");
    expect(validateSpec(spec, o)).toEqual(spec);
  });
});

describe("sweep fixes (loop 10)", () => {
  const o = { ratio: "9:16" as const, photoCount: 0, seconds: 6 };
  it("a feature amount ('5,000 mAh battery') counts as a line, a price ('420,000 RWF') does not", () => {
    const spec = validateSpec(
      {
        palette: {},
        scenes: [
          { seconds: 3, background: {}, layers: [text({ text: "8 GB RAM", size: 0.13, y: 0.2 }), text({ text: "256 GB", size: 0.13, y: 0.32 }), text({ text: "5,000 mAh battery", size: 0.08, y: 0.45 }), text({ text: "In black, light blue and pink", size: 0.055, y: 0.55 }), text({ text: "420,000 RWF", size: 0.08, y: 0.65 })] },
          { seconds: 3, background: {}, layers: [text({ text: "Nova Phones Kigali", y: 0.3 })] },
        ],
      },
      { ...o, maxLines: 3 },
    );
    expect(spec.scenes[0].layers.filter((l) => l.kind === "text").map((l) => (l as { text: string }).text)).toEqual(["8 GB RAM", "256 GB", "5,000 mAh battery", "420,000 RWF"]);
  });

  it("the quiet phone line finds room above the lowest line when the top and bottom of the safe area are taken", () => {
    const spec = validateSpec(
      { palette: {}, scenes: [{ seconds: 3, background: {}, layers: [text({ text: "50 MP camera", size: 0.095, y: 0.162, h: 0.1 }), text({ text: "Sharp. Bright. 5G.", size: 0.055, y: 0.751, h: 0.06 })] }, { seconds: 3, background: {}, layers: [text({ text: "Order on WhatsApp" })] }] },
      { ...o, phone: "+250 788 300 400" },
    );
    expect(spec.scenes[0].layers.some((l) => l.kind === "text" && l.text === "WhatsApp 0788 300 400")).toBe(true);
  });
});

describe("the quiet line over a full-frame photo", () => {
  it("goes on the photo in a dark caption box when the frame has no free spot off the product", () => {
    const square = { width: 1024, height: 1024 };
    const spec = validateSpec(
      { palette: {}, scenes: [{ seconds: 3, background: {}, layers: [{ kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 1, h: 1 }, text({ text: "50 MP camera", size: 0.095, y: 0.162, h: 0.083 }), text({ text: "Sharp. Bright. 5G.", size: 0.055, y: 0.751, h: 0.058 })] }, { seconds: 3, background: {}, layers: [text({ text: "Order on WhatsApp" })] }] },
      { ratio: "9:16", photoCount: 1, seconds: 6, photos: [square], phone: "+250 788 300 400" },
    );
    const line = spec.scenes[0].layers.find((l) => l.kind === "text" && l.text === "WhatsApp 0788 300 400") as { box?: { color: string }; color: string } | undefined;
    expect(line?.box?.color).toBe("rgba(0,0,0,0.55)");
    expect(line?.color).toBe("#ffffff");
  });
});
