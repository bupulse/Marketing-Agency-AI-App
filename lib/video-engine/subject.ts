// Keeps text off the product (docs/VIDEO_ENGINE.md, "Text and the product"). The product is the point of the video,
// so a text box that lies across it is moved to the empty band above or below it. The subject of a photo is the
// product's box in that photo: the cut-out's bounding box when the product could be cut out (cutout.ts), otherwise
// the centre 60% of the photo. Its place on the canvas follows the layer's crop (cover or contain, focus point).
// Pure and stable: a repaired scene repairs to itself. Used by validate.ts.
import { coverRect } from "./draw";
import { RATIOS, type Layer, type PhotoLayer, type Ratio, type Scene, type TextLayer } from "./spec";

/** A box as fractions (of a photo or of the canvas): left, top, width, height. */
export type Box = { x: number; y: number; w: number; h: number };
/** What the validator knows about photo n (index n - 1): its size, and the product's box in it when known. */
export type PhotoInfo = { width: number; height: number; subject?: Box | null };

/** The centre 60% of a photo: where the product usually is when nothing better is known. */
export const DEFAULT_SUBJECT: Box = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
/** A text box may overlap the product by this share of its own area before it is moved. */
export const OVERLAP_ALLOWED = 0.15;
/** Bands used when the product fills the frame: text goes to the top or the bottom of the picture. */
const FULL_FRAME_BANDS = { top: [0, 0.32], bottom: [0.64, 1] } as const;
const GAP = 0.02;

const clip = (b: Box): Box | null => {
  const x0 = Math.max(0, b.x);
  const y0 = Math.max(0, b.y);
  const x1 = Math.min(1, b.x + b.w);
  const y1 = Math.min(1, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/**
 * Where the subject of a photo lands on the canvas (fractions), for a photo drawn into `layerBox` (canvas fractions,
 * left/top/width/height) with `fit`, at its first frame (no zoom yet). Null when it is off the canvas.
 */
export function subjectOnCanvas(layerBox: Box, ratio: Ratio, photo: PhotoInfo | undefined, fit: "cover" | "contain" = "cover", focusX = 0.5, focusY = 0.5): Box | null {
  const { width: W, height: H } = RATIOS[ratio] ?? RATIOS["9:16"];
  const s = photo?.subject ?? DEFAULT_SUBJECT;
  const dw = layerBox.w * W;
  const dh = layerBox.h * H;
  // Without the photo's size, take it as the same shape as its box.
  const iw = photo?.width || dw;
  const ih = photo?.height || dh;
  let px: (u: number) => number;
  let py: (v: number) => number;
  if (fit === "contain") {
    const k = Math.min(dw / iw, dh / ih);
    const ox = layerBox.x * W + (dw - iw * k) / 2;
    const oy = layerBox.y * H + (dh - ih * k) / 2;
    px = (u) => ox + u * iw * k;
    py = (v) => oy + v * ih * k;
  } else {
    const c = coverRect({ width: iw, height: ih }, { w: dw, h: dh }, 1, focusX, focusY);
    px = (u) => layerBox.x * W + ((u * iw - c.sx) * dw) / c.sw;
    py = (v) => layerBox.y * H + ((v * ih - c.sy) * dh) / c.sh;
  }
  const x0 = px(s.x) / W;
  const y0 = py(s.y) / H;
  // The subject cannot leave its layer's box (a cover crop cuts it).
  const inBox = clip({ x: x0, y: y0, w: px(s.x + s.w) / W - x0, h: py(s.y + s.h) / H - y0 });
  if (!inBox) return null;
  const x1 = Math.max(inBox.x, layerBox.x);
  const y1 = Math.max(inBox.y, layerBox.y);
  const x2 = Math.min(inBox.x + inBox.w, layerBox.x + layerBox.w);
  const y2 = Math.min(inBox.y + inBox.h, layerBox.y + layerBox.h);
  return x2 > x1 && y2 > y1 ? clip({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }) : null;
}

const boxOf = (l: Pick<Layer, "x" | "y" | "w" | "h">): Box => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
const area = (b: Box) => b.w * b.h;
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** A giant word behind the product on purpose (validate.ts lets it be bigger than 0.22): it stays. */
const isBackdropWord = (t: TextLayer) => t.size > 0.22 && (t.depth ?? 1) <= 0.35;

/** The product's box on the canvas in a scene: the biggest photo layer, else the background photo (if not blurred). */
export function sceneSubject(scene: Pick<Scene, "layers" | "background">, ratio: Ratio, photos: (PhotoInfo | undefined)[]): Box | null {
  const layers = scene.layers.filter((l): l is PhotoLayer => l.kind === "photo");
  const biggest = layers.map((l) => ({ l, a: area(clip(boxOf(l)) ?? { x: 0, y: 0, w: 0, h: 0 }) })).sort((a, b) => b.a - a.a)[0]?.l;
  if (biggest) {
    // A turntable fills its own box (product, floor and reflection): the box is the subject.
    if (biggest.turntable) return clip(boxOf(biggest));
    return subjectOnCanvas(boxOf(biggest), ratio, photos[biggest.photo - 1], biggest.fit ?? "cover", biggest.focusX ?? 0.5, biggest.focusY ?? 0.5);
  }
  const bg = scene.background;
  if (bg.kind === "photo" && bg.photo && (bg.blur ?? 0) < 12) return subjectOnCanvas({ x: 0, y: 0, w: 1, h: 1 }, ratio, photos[bg.photo - 1]);
  return null;
}

/**
 * Moves text off the product. Texts that overlap the subject by more than a little go to the band above or below it
 * (the side they were nearer); everything in a band is stacked in reading order, shrunk only if it does not fit. When
 * the product fills the frame, the bands are the top and bottom of the picture. A shape behind a moved text (a phone
 * bar, a price badge) moves with it. Unchanged when no text overlaps.
 */
/** Average character width of each font, as a share of its size (measured on mixed-case advert lines; a little generous). */
const CHAR_WIDTH: Record<string, number> = { anton: 0.43, inter: 0.55, poppins: 0.58, nunito: 0.53, "space-grotesk": 0.55, playfair: 0.5, "dm-serif": 0.5 };

/**
 * The height a text really takes (fractions of the canvas height): its lines at its size, plus its box's padding.
 * Designs often give a text box much taller than its words; restacking the real heights keeps the type large.
 */
export function textHeight(t: TextLayer, ratio: Ratio): number {
  const { width: W, height: H } = RATIOS[ratio] ?? RATIOS["9:16"];
  const lines = Math.max(1, Math.ceil((t.text.length * t.size * (CHAR_WIDTH[t.font] ?? 0.55)) / Math.max(0.1, t.w)));
  const pad = t.box ? 1.2 * (t.box.padding ?? 0.025) : 0;
  return Math.min(t.h, ((lines * t.size * (t.lineHeight ?? 1.12) + pad) * W) / H + 0.01);
}

export function keepOffSubject(layers: Layer[], subject: Box | null, safe: { top: number; bottom: number }, ratio: Ratio = "9:16"): Layer[] {
  if (!subject) return layers;
  const texts = layers.map((l, i) => ({ l, i })).filter((t): t is { l: TextLayer; i: number } => t.l.kind === "text" && !isBackdropWord(t.l));
  const hits = texts.filter((t) => overlap(boxOf(t.l), subject) > area(boxOf(t.l)) * OVERLAP_ALLOWED);
  if (hits.length === 0) return layers;
  let top: [number, number] = [safe.top, subject.y - GAP];
  let bottom: [number, number] = [subject.y + subject.h + GAP, safe.bottom];
  if (top[1] - top[0] < 0.12 && bottom[1] - bottom[0] < 0.12) {
    top = [safe.top, Math.max(safe.top + 0.1, FULL_FRAME_BANDS.top[1])];
    bottom = [Math.min(safe.bottom - 0.1, FULL_FRAME_BANDS.bottom[0]), safe.bottom];
  }
  const centre = subject.y + subject.h / 2;
  const roomy = (band: [number, number]) => band[1] - band[0] >= 0.06;
  const bandOf = (t: TextLayer): "top" | "bottom" | null => {
    const up = t.y < centre;
    if (up && roomy(top)) return "top";
    if (!up && roomy(bottom)) return "bottom";
    return roomy(top) ? "top" : roomy(bottom) ? "bottom" : null;
  };
  const inBand = (t: TextLayer, b: [number, number]) => t.y >= b[0] && t.y <= b[1];
  const out = [...layers];
  // A shape right behind a text (its centre inside the text box, not much taller: a phone bar, a price badge).
  const backing = (t: TextLayer) => layers.filter((s) => s.kind === "shape" && Math.abs(s.x - t.x) <= t.w / 2 && Math.abs(s.y - t.y) <= t.h / 2 && s.h <= t.h * 2);
  const tight = (m: { l: TextLayer }) => Math.max(textHeight(m.l, ratio), ...backing(m.l).map((s) => s.h));
  // Members: the overlapping texts sent to a band, and the texts already in it (they are restacked with them).
  const groups = {
    top: texts.filter((t) => (hits.includes(t) ? bandOf(t.l) === "top" : inBand(t.l, top))).sort((a, b) => a.l.y - b.l.y),
    bottom: texts.filter((t) => (hits.includes(t) ? bandOf(t.l) === "bottom" : inBand(t.l, bottom))).sort((a, b) => a.l.y - b.l.y),
  };
  const need = (g: { l: TextLayer }[]) => g.reduce((s, m) => s + tight(m), 0) + GAP * Math.max(0, g.length - 1);
  // A full band hands its text nearest the product to the other band while that one has room.
  for (let n = 0; n < 4 && need(groups.top) > top[1] - top[0] && groups.top.length > 1 && need([...groups.bottom, groups.top[groups.top.length - 1]]) <= bottom[1] - bottom[0]; n++) groups.bottom.unshift(groups.top.pop()!);
  for (let n = 0; n < 4 && need(groups.bottom) > bottom[1] - bottom[0] && groups.bottom.length > 1 && need([...groups.top, groups.bottom[0]]) <= top[1] - top[0]; n++) groups.top.push(groups.bottom.shift()!);
  for (const [name, band] of [["top", top], ["bottom", bottom]] as const) {
    const members = groups[name];
    if (members.length === 0 || !members.some((m) => hits.includes(m))) continue;
    const gaps = GAP * (members.length - 1);
    const heights = members.reduce((s, m) => s + tight(m), 0);
    const room = band[1] - band[0];
    // Shrink only what does not fit, never below 0.7 (a little rounding slack, so a repaired band is left as it is).
    const k = heights + gaps > room + 0.003 ? Math.max(0.7, (room - gaps) / heights) : 1;
    // Top band stacks from its top; bottom band ends at its bottom (where the call to action is read).
    let y = name === "top" ? band[0] : band[1] - Math.min(heights * k + gaps, room);
    for (const m of members) {
      const h = round(tight(m) * k);
      const ny = round(y + h / 2);
      const dy = ny - m.l.y;
      const size = round(Math.max(0.03, m.l.size * k));
      out[m.i] = { ...m.l, y: ny, h, size };
      // Its backing shape travels with it.
      for (const b of backing(m.l)) {
        const j = layers.indexOf(b);
        out[j] = { ...b, y: round(b.y + dy), h: round(Math.min(b.h, h)) };
      }
      y += h + GAP;
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
