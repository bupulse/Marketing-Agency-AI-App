import { describe, expect, it } from "vitest";
import { factCheck } from "@/lib/video-engine/factcheck";
import { legible, validateSpec } from "@/lib/video-engine/validate";
import type { Layer } from "@/lib/video-engine/spec";

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

describe("fact check: list markers", () => {
  const facts = { business: { name: "Nova Phones Kigali" }, product: { name: "Samsung Galaxy A56", usps: ["Genuine with 12-month warranty"] } };
  const said = (say: string) => factCheck({ caption: "", scenes: [{ seconds: 3, background: { kind: "solid", colors: ["#000"] }, layers: [], say }] }, facts);
  it("spoken and written list markers are not facts; a real count still is", () => {
    expect(said("One. Genuine, with a twelve-month warranty. Two. Pay with MoMo.")).toEqual([]);
    expect(said("Reason 3: it is genuine. Step 2, order.")).toEqual([]);
    expect(said("Comes with 2 chargers.").map((w) => w.found)).toEqual(["2"]);
  });
});
