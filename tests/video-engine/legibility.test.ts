import { describe, expect, it } from "vitest";
import { factCheck } from "@/lib/video-engine/factcheck";
import { legible, validateSpec } from "@/lib/video-engine/validate";
import { drawnHeight } from "@/lib/video-engine/subject";
import type { Layer, TextLayer } from "@/lib/video-engine/spec";

const text = (over: Record<string, unknown> = {}) => ({ kind: "text", text: "Nova Phones Kigali", font: "inter", size: 0.06, color: "#f5b700", x: 0.5, y: 0.5, w: 0.8, h: 0.1, ...over });
const check = (layers: unknown[]) => validateSpec({ palette: {}, scenes: [{ seconds: 3, background: { kind: "photo", photo: 1, dim: 0.5 }, layers }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 1, seconds: 6 }).scenes[0].layers;

// The cases the template sweep of 17 October 2026 found (event-poster, price-drop, brand-story, studio-turntable).
describe("legible: the validator keeps text readable", () => {
  it("text the same colour as the shape behind it reads on it", () => {
    const [, onBurst] = check([{ kind: "shape", shape: "burst", color: "#ffc400", x: 0.5, y: 0.5, w: 0.9, h: 0.5 }, text()]);
    expect((onBurst as { color: string }).color).toBe("#111111");
    const [, onDark] = check([{ kind: "shape", shape: "rect", color: "#1d2b6f", x: 0.5, y: 0.5, w: 0.9, h: 0.5 }, text({ color: "#14235f" })]);
    expect((onDark as { color: string }).color).toBe("#ffffff");
    // Far apart colours, a glass panel, or text elsewhere: unchanged.
    expect((check([{ kind: "shape", shape: "burst", color: "#ffc400", x: 0.5, y: 0.5, w: 0.9, h: 0.5 }, text({ color: "#1a1a1a" })])[1] as { color: string }).color).toBe("#1a1a1a");
    expect((check([{ kind: "shape", shape: "rect", material: "glass", color: "#ffc400", x: 0.5, y: 0.5, w: 0.9, h: 0.5 }, text()])[1] as { color: string }).color).toBe("#f5b700");
    expect((check([{ kind: "shape", shape: "burst", color: "#ffc400", x: 0.5, y: 0.2, w: 0.4, h: 0.2 }, text({ y: 0.8 })])[1] as { color: string }).color).toBe("#f5b700");
  });

  it("text the same colour as its own box reads on it", () => {
    const [t] = check([text({ color: "#8a8f99", box: { color: "#7d828c" } })]);
    expect((t as { color: string }).color).toBe("#111111");
  });

  it("highlighted words in the shape's colour take a readable one; text partly over a clashing shape gets a shadow", () => {
    const [, hl] = check([{ kind: "shape", shape: "burst", color: "#ffc400", x: 0.5, y: 0.5, w: 0.9, h: 0.5 }, text({ color: "#111111", highlight: { words: ["nova"], color: "#ffcc00" } })]);
    expect(hl).toMatchObject({ color: "#111111", highlight: { color: "#111111" } });
    const [, partly] = check([{ kind: "shape", shape: "burst", color: "#ffc400", x: 0.85, y: 0.5, w: 0.3, h: 0.2 }, text({ shadow: false })]);
    expect(partly).toMatchObject({ color: "#f5b700", shadow: true });
  });

  it("a see-through box is left alone; a shape drawn over text goes under it", () => {
    const [t] = check([text({ color: "#ffffff", box: { color: "#ffffff33" } })]);
    expect((t as { color: string }).color).toBe("#ffffff");
    const layers = check([text({ color: "#ffffff" }), { kind: "shape", shape: "burst", color: "#ffc400", x: 0.6, y: 0.5, w: 0.3, h: 0.2 }, { kind: "shape", shape: "ring", color: "#ffc400", x: 0.5, y: 0.5, w: 0.3, h: 0.2 }]);
    expect(layers.map((l) => l.kind + ("shape" in l ? `:${l.shape}` : ""))).toEqual(["shape:burst", "text", "shape:ring"]);
  });

  it("a full-frame photo under light text gets a dark veil; under dark text or a box it does not", () => {
    const photo = { kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 1, h: 1 };
    expect(check([photo, text({ color: "#ffffff" })])[0]).toMatchObject({ dim: 0.4 });
    expect(check([{ ...photo, dim: 0.6 }, text({ color: "#ffffff" })])[0]).toMatchObject({ dim: 0.6 });
    expect((check([photo, text({ color: "#111111" })])[0] as { dim?: number }).dim).toBeUndefined();
    expect((check([photo, text({ color: "#ffffff", box: { color: "#000000" } })])[0] as { dim?: number }).dim).toBeUndefined();
    expect((check([{ ...photo, w: 0.5, h: 0.4 }, text({ color: "#ffffff" })])[0] as { dim?: number }).dim).toBeUndefined();
  });

  it("a turntable is at least about half the frame; text is at least 0.03 of the width", () => {
    expect(check([{ kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 0.35, h: 0.3, turntable: true }])[0]).toMatchObject({ w: 0.6, h: 0.42 });
    expect(check([text({ size: 0.018 })])[0]).toMatchObject({ size: 0.03 });
  });

  it("repairs are stable: a checked layer list checks the same again", () => {
    const once = check([{ kind: "photo", photo: 1, x: 0.5, y: 0.5, w: 1, h: 1 }, { kind: "shape", shape: "burst", color: "#ffc400", x: 0.5, y: 0.5, w: 0.9, h: 0.5 }, text(), text({ color: "#8a8f99", box: { color: "#7d828c" } })]);
    expect(legible(once as Layer[])).toEqual(once);
  });
});

describe("safe area", () => {
  it("text boxes move into the safe area of a vertical video; giant background words and wide videos are left alone", () => {
    // A plain background, so only the safe area moves text (a photo would also keep text off the product).
    const plain = (layers: unknown[]) => validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 0, seconds: 6 }).scenes[0].layers;
    const [low, wide, giant] = plain([text({ y: 0.9, h: 0.06 }), text({ x: 0.5, w: 1.2 }), text({ text: "NOVA", size: 0.4, depth: 0.2, y: 0.95, w: 1.4 })]);
    // No platform: the strictest common box (y 0.12 to 0.78, x 0.07 to 0.85).
    expect(low).toMatchObject({ y: 0.75 });
    expect(wide).toMatchObject({ w: 0.78, x: 0.46 });
    expect(giant).toMatchObject({ y: 0.95, w: 1.4 });
    const landscape = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers: [text({ y: 0.9, h: 0.06 })] }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "16:9", photoCount: 0, seconds: 6 });
    // Wide shapes only keep a small margin (y 0.05 to 0.95), measured on the letters as drawn, not the box.
    const onWide = landscape.scenes[0].layers[0] as TextLayer;
    expect(onWide.y + drawnHeight(onWide, "16:9") / 2).toBeLessThanOrEqual(0.95 + 1e-9);
    expect(onWide.y).toBeGreaterThan(0.8);
  });
});

describe("fact check: list markers", () => {
  const facts = { business: { name: "Nova Phones Kigali" }, product: { name: "Samsung Galaxy A56", usps: ["Genuine with 12-month warranty"] } };
  const said = (say: string) => factCheck({ caption: "", scenes: [{ seconds: 3, background: { kind: "solid", colors: ["#000"] }, layers: [], say }] }, facts);
  it("spoken and written list markers are not facts; a real count still is", () => {
    expect(said("One. Genuine, with a twelve-month warranty. Two. Pay with MoMo.")).toEqual([]);
    expect(said("Reason 3: it is genuine. Step 2, order.")).toEqual([]);
    expect(said("Comes with 2 chargers.").map((w) => w.found)).toEqual(["2"]);
  });
});

describe("phone line, voice lines and hashtags", () => {
  const scene = (layers: unknown[], say?: string, seconds = 3) => ({ seconds, background: {}, layers, say });
  const run = (scenes: unknown[], over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    validateSpec({ palette: { text: "#ffffff" }, scenes, ...extra }, { ratio: "9:16", photoCount: 0, seconds: 6, phone: "+250 788 300 400", ...over });

  it("a scene without the number gets a small quiet phone line; a scene with it, or a wide video, does not", () => {
    const spec = run([scene([text({ text: "Nova Phones Kigali", y: 0.3, h: 0.08 })]), scene([text({ text: "WhatsApp 0788 300 400", y: 0.5, h: 0.08 })])]);
    const added = spec.scenes[0].layers.find((l) => l.kind === "text" && l.text === "WhatsApp 0788 300 400");
    expect(added).toMatchObject({ size: 0.03, box: null, animate: "none", y: 0.76, color: "rgba(255,255,255,0.85)" });
    expect(spec.scenes[1].layers).toHaveLength(1);
    expect(validateSpec(JSON.parse(JSON.stringify(spec)), { ratio: "9:16", photoCount: 0, seconds: 6, phone: "+250 788 300 400" })).toEqual(spec);
    expect(run([scene([]), scene([])], { ratio: "16:9" }).scenes[0].layers).toHaveLength(0);
    expect(run([scene([]), scene([])], { phone: null }).scenes[0].layers).toHaveLength(0);
  });

  it("on Shorts the quiet line sits at the bottom of the middle band", () => {
    const [line] = run([scene([]), scene([])], { platform: "youtube" }).scenes[0].layers;
    expect(line).toMatchObject({ y: 0.68 });
  });

  it("a voice line far too long for its scene is cut back to its first clauses; a fitting one is kept", () => {
    const long = "The Galaxy A56 is here. It has a big screen, a great camera and a battery that lasts all day long for you.";
    const spec = run([scene([], long, 2), scene([], "Order on WhatsApp today.", 3)], { seconds: 5 });
    expect(spec.scenes[0].say).toBe("The Galaxy A56 is here.");
    expect(spec.scenes[1].say).toBe("Order on WhatsApp today.");
  });

  it("hashtags are capped per platform", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(run([scene([]), scene([])], { platform: "facebook" }, { hashtags: tags }).hashtags).toHaveLength(3);
    expect(run([scene([]), scene([])], { platform: "tiktok" }, { hashtags: tags }).hashtags).toHaveLength(6);
    expect(run([scene([]), scene([])], {}, { hashtags: tags }).hashtags).toHaveLength(8);
  });
});

describe("empty scenes and the last scene's call to action", () => {
  const t = (over: Record<string, unknown>) => text(over);
  it("an empty scene (no layer, no voice line) is dropped, keeping at least two scenes", () => {
    const spec = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers: [t({})] }, { seconds: 3, background: {}, layers: [] }, { seconds: 3, background: {}, layers: [t({ text: "Order on WhatsApp" })] }] }, { ratio: "9:16", photoCount: 0, seconds: 9 });
    expect(spec.scenes).toHaveLength(2);
    expect(spec.scenes.reduce((s, x) => s + x.seconds, 0)).toBeCloseTo(9, 1);
    const two = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers: [] }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 0, seconds: 6 });
    expect(two.scenes).toHaveLength(2);
    expect(two.scenes[0].transition).toBe("cut");
  });

  it("a bare number on the last scene gets the ordering words; a scene that already says how to order is left", () => {
    const end = (layers: unknown[]) => validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers: [t({ text: "Galaxy A56" })] }, { seconds: 3, background: {}, layers }] }, { ratio: "9:16", photoCount: 0, seconds: 6 }).scenes[1].layers;
    expect(end([t({ text: "+250 788 300 400" })])[0]).toMatchObject({ text: "Call or WhatsApp +250 788 300 400" });
    expect(end([t({ text: "Order on WhatsApp", y: 0.3 }), t({ text: "+250 788 300 400" })])[1]).toMatchObject({ text: "+250 788 300 400" });
    expect(end([t({ text: "Nova Phones Kigali" })])[0]).toMatchObject({ text: "Nova Phones Kigali" });
  });
});

describe("phone bars and quiet lines", () => {
  it("a phone bar moves with its number into the safe area", () => {
    const spec = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers: [{ kind: "shape", shape: "rect", color: "#25D366", x: 0.5, y: 0.86, w: 0.86, h: 0.065, radius: 0.5 }, text({ text: "WhatsApp 0788 300 400", y: 0.86, h: 0.05, color: "#111111" })] }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 0, seconds: 6 });
    const [bar, number] = spec.scenes[0].layers;
    expect(Math.abs(bar.y - number.y)).toBeLessThan(1e-9);
    expect(number.y + number.h / 2).toBeLessThanOrEqual(0.78 + 1e-9);
  });

  it("a faded light line on a pale background turns dark; a readable one is left", () => {
    const pale = { kind: "gradient", colors: ["#f4f6fb", "#c9d2e4"] };
    const [faded] = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: pale, layers: [text({ text: "0788 300 400", size: 0.03, color: "rgba(255,255,255,0.85)", y: 0.75, h: 0.04 })] }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 0, seconds: 6 }).scenes[0].layers;
    expect((faded as { color: string }).color).toBe("#111111");
    const [kept] = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: { kind: "solid", colors: ["#0b0b0f"] }, layers: [text({ text: "0788 300 400", size: 0.03, color: "#ffffff", y: 0.75, h: 0.04 })] }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "9:16", photoCount: 0, seconds: 6 }).scenes[0].layers;
    expect((kept as { color: string }).color).toBe("#ffffff");
  });
});

describe("loop 6: square videos and spoken numbers", () => {
  it("on 1:1 text keeps a small margin inside the frame (a price at the very top was cut)", () => {
    const spec = validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers: [text({ text: "25,000 RWF", y: 0.02, h: 0.1 })] }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "1:1", photoCount: 0, seconds: 6 });
    const [price] = spec.scenes[0].layers;
    expect(price.y - price.h / 2).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it("a long voice line is cut at a sentence, never inside a spoken phone number", () => {
    const spec = validateSpec(
      { palette: {}, scenes: [{ seconds: 2, background: {}, layers: [text({})], say: "Order on WhatsApp, zero seven eight eight, one two three, four five six." }, { seconds: 2, background: {}, layers: [text({})], say: "Ikanzu nziza. Yakorewe mu Rwanda, ingano zose kuva S kugeza XL ku giciro cyiza cyane." }] },
      { ratio: "9:16", photoCount: 0, seconds: 6 },
    );
    expect(spec.scenes[0].say).toBe("Order on WhatsApp, zero seven eight eight, one two three, four five six.");
    expect(spec.scenes[1].say).toBe("Ikanzu nziza.");
  });
});

describe("captions keep their lines", () => {
  it("line breaks survive, each line is cleaned, blank runs shrink to one", () => {
    const spec = validateSpec(
      { palette: {}, caption: "Kitenge dress: 25,000 RWF\r\n\n\n\nMade in Kigali,   S to XL.\nOrder on WhatsApp 0788 123 456", scenes: [{ seconds: 3, background: {}, layers: [] }, { seconds: 3, background: {}, layers: [] }] },
      { ratio: "9:16", photoCount: 0, seconds: 6 },
    );
    expect(spec.caption).toBe("Kitenge dress: 25,000 RWF\n\nMade in Kigali, S to XL.\nOrder on WhatsApp 0788 123 456");
  });
});

describe("text never lies on other text", () => {
  it("a price behind its own headline is pulled apart; texts at different times may share a place", () => {
    const run = (layers: unknown[]) => validateSpec({ palette: {}, scenes: [{ seconds: 3, background: {}, layers }, { seconds: 3, background: {}, layers: [] }] }, { ratio: "1:1", photoCount: 0, seconds: 6 }).scenes[0].layers as TextLayer[];
    const [price, head] = run([text({ text: "25,000 RWF", size: 0.07, y: 0.12, h: 0.06 }), text({ text: "YAKOREWE MU RWANDA", font: "anton", size: 0.12, y: 0.2, h: 0.12, w: 0.8 })]);
    expect(price.y + drawnHeight(price, "1:1") / 2).toBeLessThanOrEqual(head.y - drawnHeight(head, "1:1") / 2 + 1e-9);
    const [a, b] = run([text({ text: "First", y: 0.5, to: 0.5 }), text({ text: "Second", y: 0.5, from: 0.5 })]);
    expect(a.y).toBe(b.y);
  });
});
