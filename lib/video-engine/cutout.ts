// Free product cut-outs (docs/VIDEO_ENGINE.md, "3D look"): no AI and no cost. A product photographed on a plain or
// near-uniform background (a white sweep, a grey studio, a coloured paper) is lifted off it, so the turntable and
// "contain" photos show the product itself floating, not a rectangle. How: the border of the photo is sampled; if it is
// busy (a shop, a room, a street) the photo is refused with a reason. Otherwise the background is flooded from the
// border by colour distance (step by step, so a soft studio gradient is followed, but never far from the border's own
// colour), the mask is feathered, and the picture is trimmed to the product. Server side (sharp).
import sharp from "sharp";

export type Cutout = { ok: true; png: Buffer; width: number; height: number; coverage: number } | { ok: false; reason: string };

/** How strict the detection is. Distances are in RGB units (0 to 441). */
export const CUTOUT_LIMITS = {
  /** Work at most this size (the long side); the cut-out keeps this size. */
  maxSide: 1280,
  /** A border pixel farther than this from the border's median colour counts as "busy". */
  borderDistance: 38,
  /** More than this share of busy border pixels: the background is not plain. */
  busyShare: 0.12,
  /** Flood: a step to a neighbour may change the colour by at most this much... */
  stepDistance: 10,
  /** ...and never into an edge: a pixel this different from the one two steps on (a product's outline, even a soft
   * white-on-white one). */
  edgeDistance: 14,
  /** ...and the background never goes farther than this from the border's colour. */
  backgroundDistance: 64,
  /** The product must cover between these shares of the photo. */
  minCoverage: 0.04,
  maxCoverage: 0.9,
} as const;

const dist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
};

/**
 * Indices of the pixels in a band `band` pixels wide along the four edges of a w x h image.
 */
function borderPixels(w: number, h: number, band: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    const full = y < band || y >= h - band;
    for (let x = 0; x < w; x++) if (full || x < band || x >= w - band) out.push(y * w + x);
  }
  return out;
}

/**
 * The background mask of an RGB image (1 = background): checks the border is plain, then floods from it. Pure (on raw
 * pixels), so it is unit tested without image files. Returns the reason when the background is not plain.
 */
export function backgroundMask(rgb: Uint8Array | Buffer, w: number, h: number, limits = CUTOUT_LIMITS): { ok: true; mask: Uint8Array; coverage: number } | { ok: false; reason: string } {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.015));
  const border = borderPixels(w, h, band);
  const at = (i: number, c: number) => rgb[i * 3 + c];
  const bg = [0, 1, 2].map((c) => median(border.map((i) => at(i, c))));
  const busy = border.filter((i) => dist(at(i, 0), at(i, 1), at(i, 2), bg[0], bg[1], bg[2]) > limits.borderDistance).length / border.length;
  if (busy > limits.busyShare) return { ok: false, reason: `The background is not plain (${Math.round(busy * 100)}% of the edge differs), so the product cannot be cut out. Use a photo on a plain background.` };

  // Edges block the flood, so it cannot creep across a soft outline in small steps (a white box on a white sweep).
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Two pixels apart, so an outline softened over a few pixels (lens blur, anti-aliasing) still counts.
      const right = x < w - 2 && dist(at(i, 0), at(i, 1), at(i, 2), at(i + 2, 0), at(i + 2, 1), at(i + 2, 2)) > limits.edgeDistance;
      const down = y < h - 2 && dist(at(i, 0), at(i, 1), at(i, 2), at(i + 2 * w, 0), at(i + 2 * w, 1), at(i + 2 * w, 2)) > limits.edgeDistance;
      if (right) edge[i] = edge[i + 1] = edge[i + 2] = 1;
      if (down) edge[i] = edge[i + w] = edge[i + 2 * w] = 1;
    }
  }
  const mask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  // The background, or a soft shadow on it: the same colour with less light (every channel dimmed by about the same
  // factor). The turntable draws its own shadow, so the photo's shadow goes with the background.
  const nearBg = (i: number) => {
    if (dist(at(i, 0), at(i, 1), at(i, 2), bg[0], bg[1], bg[2]) <= limits.backgroundDistance) return true;
    const k = [0, 1, 2].map((c) => (at(i, c) + 1) / (bg[c] + 1));
    return Math.max(...k) <= 1 && Math.min(...k) >= 0.3 && Math.max(...k) - Math.min(...k) <= 0.08;
  };
  for (const i of border) {
    if (!mask[i] && nearBg(i)) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const r = at(i, 0);
    const g = at(i, 1);
    const b = at(i, 2);
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n < 0 || mask[n]) continue;
      if (!edge[n] && dist(r, g, b, at(n, 0), at(n, 1), at(n, 2)) <= limits.stepDistance && nearBg(n)) {
        mask[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  // The flood stops one pixel short of an outline: background-coloured pixels touching the background join it.
  const touch: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) continue;
    const x = i % w;
    const touches = (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (i >= w && mask[i - w]) || (i < w * h - w && mask[i + w]);
    if (touches && dist(at(i, 0), at(i, 1), at(i, 2), bg[0], bg[1], bg[2]) <= limits.stepDistance * 2) touch.push(i);
  }
  for (const i of touch) mask[i] = 1;
  tail += touch.length;
  const coverage = 1 - tail / (w * h);
  if (coverage < limits.minCoverage) return { ok: false, reason: "No product was found in front of the background." };
  if (coverage > limits.maxCoverage) return { ok: false, reason: "The product fills the photo: there is no background to remove." };
  return { ok: true, mask, coverage };
}

/** The product's box in the mask (where it is not background), with a small margin. */
function productBox(mask: Uint8Array, w: number, h: number): { left: number; top: number; width: number; height: number } {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const m = Math.round(Math.min(w, h) * 0.01);
  const left = Math.max(0, x0 - m);
  const top = Math.max(0, y0 - m);
  return { left, top, width: Math.min(w, x1 + m + 1) - left, height: Math.min(h, y1 + m + 1) - top };
}

/** Cuts the product out of a photo on a plain background: a trimmed PNG with a soft edge, or the reason it cannot. */
export async function makeCutout(photo: Buffer): Promise<Cutout> {
  const { data, info } = await sharp(photo).rotate().resize({ width: CUTOUT_LIMITS.maxSide, height: CUTOUT_LIMITS.maxSide, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const found = backgroundMask(data, w, h);
  if (!found.ok) return found;
  // Alpha: 255 on the product, 0 on the background, feathered over about 1.5 px (more on big photos) so the edge is soft.
  const alpha = Buffer.alloc(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = found.mask[i] ? 0 : 255;
  // The outermost product pixels mix product and background (a light fringe on a white sweep): shave off two.
  for (let pass = 0; pass < 2; pass++) {
    const was = Uint8Array.from(alpha);
    for (let i = 0; i < alpha.length; i++) {
      if (!was[i]) continue;
      const x = i % w;
      if ((x > 0 && !was[i - 1]) || (x < w - 1 && !was[i + 1]) || (i >= w && !was[i - w]) || (i < alpha.length - w && !was[i + w])) alpha[i] = 0;
    }
  }
  const soft = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.8, Math.min(w, h) / 700)).extractChannel(0).raw().toBuffer();
  const box = productBox(found.mask, w, h);
  // RGBA by hand (sharp applies a crop before a joined channel, so the two are not combined in one pipeline).
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = soft[i];
  }
  const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extract(box).png({ compressionLevel: 9 }).toBuffer();
  return { ok: true, png, width: box.width, height: box.height, coverage: Math.round(found.coverage * 1000) / 1000 };
}
