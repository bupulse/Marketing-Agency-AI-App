// Keeps text off the product (docs/VIDEO_ENGINE.md, "Text and the product"). The product is the point of the video,
// so a text box that lies across it is moved to the empty band above or below it. The subject of a photo is the
// product's box in that photo: the cut-out's bounding box when the product could be cut out (cutout.ts), otherwise
// the centre 60% of the photo. Its place on the canvas follows the layer's crop (cover or contain, focus point).
// Pure and stable: a repaired scene repairs to itself. Used by validate.ts.
import { coverRect } from "./draw";
import { luminance, turntableFit } from "./draw3d";
import { RATIOS, type Layer, type PhotoLayer, type Ratio, type Scene, type TextLayer, type VideoLayer } from "./spec";

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

/**
 * Where a cut-out product is drawn (canvas fractions, at its largest): the trimmed product, the shape of the photo's
 * subject box, fitted into the layer's box (draw3d.ts drawCutout) and grown by its slow zoom (zoomTo, which takes a
 * cut-out past its box), or standing on its turntable. Null when the layer does not draw a cut-out (no cut-out asked,
 * or none known for the photo: only cut-out photos carry a subject box).
 */
export function cutoutBox(l: PhotoLayer, ratio: Ratio, photo: PhotoInfo | undefined): Box | null {
  return l.cutout && photo?.subject ? drawnBox(l, ratio, photo, photo.subject) : null;
}

/**
 * Where a product photo is drawn: a cut-out (cutoutBox), or a whole photo on a turntable or fitted ("contain") into an
 * inset card. Null for a cover photo, a photo filling the frame, or a photo whose size is not known.
 */
export function productBox(l: PhotoLayer, ratio: Ratio, photo: PhotoInfo | undefined): Box | null {
  const cut = cutoutBox(l, ratio, photo);
  if (cut) return cut;
  const inset = Math.min(l.w, 1) * Math.min(l.h, 1) < 0.5;
  return l.turntable || (l.fit === "contain" && inset) ? drawnBox({ ...l, zoomTo: undefined }, ratio, photo, { x: 0, y: 0, w: 1, h: 1 }) : null;
}

function drawnBox(l: PhotoLayer, ratio: Ratio, photo: PhotoInfo | undefined, s: Box): Box | null {
  if (!photo?.width || !photo.height || (!l.turntable && l.fit !== "contain")) return null;
  const { width: W, height: H } = RATIOS[ratio] ?? RATIOS["9:16"];
  const cw = s.w * photo.width;
  const ch = s.h * photo.height;
  if (cw <= 0 || ch <= 0) return null;
  const bw = l.w * W;
  const bh = l.h * H;
  let w: number;
  let h: number;
  let cy: number;
  if (l.turntable) {
    // Its tallest moment: the near edge swung forward (centre = that height / 2 + 3% of the box).
    const f = turntableFit({ w: bw, h: bh }, cw, ch, l.turntable.angle ?? 35);
    h = 2 * (f.centre - bh * 0.03);
    w = (f.w * h) / f.h;
    cy = (l.y - l.h / 2) * H + f.centre;
  } else {
    const k = Math.min(bw / cw, bh / ch) * Math.max(1, l.zoomTo ?? 1);
    w = cw * k;
    h = ch * k;
    cy = l.y * H;
  }
  return { x: l.x - w / W / 2, y: cy / H - h / H / 2, w: w / W, h: h / H };
}
const area = (b: Box) => b.w * b.h;

/**
 * What text must keep off for a product photo (productBox): the product, and on a turntable its contact shadow and the
 * top of its floor reflection too (the reflection fades out below; text may sit on its faint end).
 */
export function productArea(l: PhotoLayer, ratio: Ratio, photo: PhotoInfo | undefined): Box | null {
  const b = productBox(l, ratio, photo);
  if (!b || !l.turntable) return b;
  return { ...b, h: Math.min(l.y + l.h / 2 - b.y, b.h + l.h * 0.1) };
}
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** A giant word behind the product on purpose (validate.ts lets it be bigger than 0.22): it stays. */
/** A price, a phone number or a call to action: never a backdrop, always kept readable and inside the frame. */
export const CONTACT = /\d{3}[\s-]?\d{3}|\d{1,3}(?:,\d{3})+|\b(?:whatsapp|call|order|contact|rwf|frw|ksh|tsh|ugx|price)\b/i;
export const isBackdropWord = (t: Pick<TextLayer, "size" | "depth" | "text">) => t.size > 0.22 && (t.depth ?? 1) <= 0.35 && !CONTACT.test(t.text);

/** The product's box on the canvas in a scene: the biggest photo layer, else the background photo (if not blurred). */
export function sceneSubject(scene: Pick<Scene, "layers" | "background">, ratio: Ratio, photos: (PhotoInfo | undefined)[]): Box | null {
  // Every photo layer that is not a small inset: with two products side by side, the subject covers both.
  // A video clip counts like a full-frame photo of unknown content: its centre 60%.
  const layers = scene.layers.filter((l): l is PhotoLayer | VideoLayer => (l.kind === "photo" || l.kind === "video") && area(clip(boxOf(l)) ?? { x: 0, y: 0, w: 0, h: 0 }) >= 0.02);
  const boxes = layers
    // A turntable fills its own box (product, floor and reflection): the box is the subject.
    // A cut-out fills its box with the product alone (not the product's place in the whole photo); a photo card (an
    // inset, not filling the frame) is kept clear whole, as it shows: text on its edge reads as a mistake, especially
    // once a re-shape to 1:1 or 4:5 moves things closer.
    .map((l) => {
      if (l.kind === "video") return subjectOnCanvas(boxOf(l), ratio, undefined, l.fit);
      const product = productArea(l, ratio, photos[l.photo - 1]);
      if (product) return clip(product);
      if (l.turntable || area(clip(boxOf(l)) ?? { x: 0, y: 0, w: 0, h: 0 }) < 0.5) return clip(boxOf(l));
      return subjectOnCanvas(boxOf(l), ratio, photos[l.photo - 1], l.fit ?? "cover", l.focusX ?? 0.5, l.focusY ?? 0.5);
    })
    .filter((b): b is Box => !!b);
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    return { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
  }
  if (layers.length) return null;
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
  return Math.min(t.h, drawnHeight(t, ratio));
}

/** The height the renderer will actually draw (it lets text grow past a short box rather than shrink it to nothing). */
export function drawnHeight(t: Pick<TextLayer, "text" | "size" | "font" | "w" | "lineHeight" | "box">, ratio: Ratio): number {
  const { width: W, height: H } = RATIOS[ratio] ?? RATIOS["9:16"];
  const lines = Math.max(1, Math.ceil((t.text.length * t.size * (CHAR_WIDTH[t.font] ?? 0.55)) / Math.max(0.1, t.w)));
  const pad = t.box ? 1.2 * (t.box.padding ?? 0.025) : 0;
  return ((lines * t.size * (t.lineHeight ?? 1.12) + pad) * W) / H + 0.01;
}

/**
 * A big badge shape (burst, circle, blob) lying over the product with no text on it hides the product for nothing
 * (a yellow burst covered the house): it moves behind the scene's price or phone text, cut to that text's size, or
 * is dropped when there is none.
 */
export function badgesOffProduct(layers: Layer[], subject: Box | null): Layer[] {
  if (!subject) return layers;
  const texts = layers.filter((t): t is TextLayer => t.kind === "text");
  const holder = texts.find((t) => CONTACT.test(t.text) && !layers.some((s) => s.kind === "shape" && ["burst", "circle", "blob"].includes(s.shape) && Math.abs(t.x - s.x) <= s.w / 2 && Math.abs(t.y - s.y) <= s.h / 2));
  const out: Layer[] = [];
  let used = false;
  for (const s of layers) {
    const badge = s.kind === "shape" && ["burst", "circle", "blob"].includes(s.shape) && s.material !== "glass";
    const holds = badge && texts.some((t) => Math.abs(t.x - s.x) <= s.w / 2 && Math.abs(t.y - s.y) <= s.h / 2);
    if (!badge || holds || overlap(boxOf(s), subject) < area(subject) * 0.25) {
      out.push(s);
      continue;
    }
    if (holder && !used) {
      used = true;
      // Behind the price: put first in the list so the text stays on top.
      out.unshift({ ...s, x: holder.x, y: holder.y, w: round(Math.min(s.w, holder.w * 1.15)), h: round(Math.min(s.h, holder.h * 2.2)) });
    }
  }
  return out;
}

export function keepOffSubject(layers: Layer[], subject: Box | null, safe: { top: number; bottom: number }, ratio: Ratio = "9:16"): Layer[] {
  if (!subject) return layers;
  const texts = layers.map((l, i) => ({ l, i })).filter((t): t is { l: TextLayer; i: number } => t.l.kind === "text" && !isBackdropWord(t.l));
  const hits = texts.filter((t) => overlap(boxOf(t.l), subject) > area(boxOf(t.l)) * OVERLAP_ALLOWED);
  if (hits.length === 0) return layers;
  let top: [number, number] = [safe.top, subject.y - GAP];
  let bottom: [number, number] = [subject.y + subject.h + GAP, safe.bottom];
  const fullFrame = top[1] - top[0] < 0.12 && bottom[1] - bottom[0] < 0.12;
  if (fullFrame) {
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
  // When the product fills the frame, text in the bands still lies on it: it gets a caption box (dark behind light
  // text, light behind dark) so a busy pattern or a bright plate never eats the letters. Decided before stacking, so
  // the heights stay the same on a second check.
  if (fullFrame) {
    for (const h of hits) {
      if (h.l.box) continue;
      const light = luminance(h.l.color) > 0.5;
      const boxed: TextLayer = { ...h.l, box: { color: light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)", padding: 0.02, radius: 0.3 } };
      h.l = boxed;
      out[h.i] = boxed;
    }
  }
  // A shape right behind a text (its centre inside the text box, not much taller: a phone bar, a price badge).
  // And a badge it sits on (a burst, circle, blob or rect whose box holds the text's centre): it moves with the text, cut
  // down to about the text's size, or it would stay behind covering the product (a yellow burst hid the house).
  const backing = (t: TextLayer) =>
    layers.filter((s) => s.kind === "shape" && ((Math.abs(s.x - t.x) <= t.w / 2 && Math.abs(s.y - t.y) <= t.h / 2 && s.h <= t.h * 2) || (["burst", "circle", "blob", "rect"].includes(s.shape) && Math.abs(t.x - s.x) <= s.w / 2 && Math.abs(t.y - s.y) <= s.h / 2)));
  // A thin rule just above or below a text (a gold line under the price, h up to 0.015) belongs to its nearest text and
  // keeps its distance when that text is restacked (it would otherwise cross the text that moves onto it).
  const ruleOf = new Map<Layer, TextLayer>();
  for (const r of layers) {
    if (r.kind !== "shape" || r.h > 0.015) continue;
    const near = texts
      .map((t) => ({ t: t.l, d: Math.abs(r.y - t.l.y) - t.l.h / 2 }))
      .filter((n) => n.d <= 0.04 && Math.abs(r.x - n.t.x) <= (n.t.w + r.w) / 2)
      .sort((a, b) => a.d - b.d)[0];
    if (near && !backing(near.t).includes(r)) ruleOf.set(r, near.t);
  }
  // Stacked by the height the letters are drawn at (a short box with big letters would overlap its neighbour).
  const tight = (m: { l: TextLayer }) => Math.max(drawnHeight(m.l, ratio), ...backing(m.l).map((s) => Math.min(s.h, drawnHeight(m.l, ratio) * 1.6)));
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
        const big = b.h > m.l.h * 2;
        const nh = Math.min(b.h, h * (big ? 1.6 : 1));
        // A burst, circle or blob keeps its shape (squashed flat it turns and leaves the price on the bare background):
        // it shrinks evenly to the text's height.
        const even = b.kind === "shape" && ["burst", "circle", "blob"].includes(b.shape) ? Math.min(1, nh / b.h) : null;
        out[j] =
          even !== null
            ? { ...b, x: big ? m.l.x : b.x, y: round(b.y + dy), h: round(b.h * even), w: round(b.w * even) }
            : { ...b, x: big ? m.l.x : b.x, y: round(b.y + dy), h: round(nh), w: big ? round(Math.min(b.w, m.l.w * 1.15)) : b.w };
        // Still too small to hold the whole line: the text gets a box in the badge's colour, so no letter falls on the bare
        // background (its colour was chosen for the badge).
        const moved = out[m.i] as TextLayer;
        if (even !== null && b.kind === "shape" && !moved.box && b.w * even * 0.65 < m.l.w) out[m.i] = { ...moved, box: { color: b.color, padding: 0.015, radius: 0.3 } };
      }
      // Its rule keeps the same side and gap (scaled with the text).
      for (const [r, t] of ruleOf) {
        if (t !== m.l) continue;
        const side = r.y < m.l.y ? -1 : 1;
        const edgeGap = Math.max(0, Math.abs(r.y - m.l.y) - m.l.h / 2);
        out[layers.indexOf(r)] = { ...r, y: round(ny + side * (h / 2 + edgeGap)) };
      }
      y += h + GAP;
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
