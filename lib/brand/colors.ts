// Picks up to 3 main colours from an image's pixels. Pure, so it is unit tested;
// the browser helper that draws the image to a canvas lives in image-colors.ts.

type Bucket = { count: number; r: number; g: number; b: number };

const MIN_ALPHA = 128;
const MIN_DISTANCE = 56;

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function distance(a: Bucket, b: Bucket): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function pick(buckets: Bucket[], max: number): Bucket[] {
  const chosen: Bucket[] = [];
  for (const bucket of buckets.sort((x, y) => y.count - x.count)) {
    if (chosen.length >= max) break;
    if (chosen.every((c) => distance(c, bucket) >= MIN_DISTANCE)) chosen.push(bucket);
  }
  return chosen;
}

/**
 * @param data RGBA bytes (e.g. ImageData.data)
 * Transparent, near-white and near-black pixels are ignored unless the image has nothing else.
 */
export function extractColors(data: ArrayLike<number>, max = 3): string[] {
  const colorful = new Map<number, Bucket>();
  const extremes = new Map<number, Bucket>();

  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < MIN_ALPHA) continue;

    const isExtreme = (r > 235 && g > 235 && b > 235) || (r < 25 && g < 25 && b < 25);
    const map = isExtreme ? extremes : colorful;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = map.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      map.set(key, { count: 1, r, g, b });
    }
  }

  const source = colorful.size > 0 ? colorful : extremes;
  const averaged = [...source.values()].map((v) => ({ count: v.count, r: v.r / v.count, g: v.g / v.count, b: v.b / v.count }));
  return pick(averaged, max).map((c) => toHex(c.r, c.g, c.b));
}
