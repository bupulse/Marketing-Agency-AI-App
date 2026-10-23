// The product photo as Veo's first frame (lib/video-engine/veo.ts), shared by the studio (video-lab/ai-clips.ts) and
// BuPulse's overnight AI clips (lib/visuals/ai-clips.ts). Server-only (sharp).
import sharp from "sharp";
import type { VeoRatio } from "./veo";

/** The product photo as Veo's first frame: cropped to the clip's shape around the product, at the clip's size (JPEG). */
export async function firstFrame(photo: Buffer, ratio: VeoRatio, box: { x: number; y: number; w: number; h: number } | null): Promise<Buffer> {
  const [width, height] = ratio === "9:16" ? [720, 1280] : [1280, 720];
  const img = sharp(photo).rotate();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (box && w && h) {
    // The largest crop of the clip's shape, centred on the product's box (kept inside the photo).
    const scale = Math.min(w / width, h / height);
    const cw = Math.round(width * scale);
    const ch = Math.round(height * scale);
    const cx = (box.x + box.w / 2) * w;
    const cy = (box.y + box.h / 2) * h;
    const left = Math.max(0, Math.min(w - cw, Math.round(cx - cw / 2)));
    const top = Math.max(0, Math.min(h - ch, Math.round(cy - ch / 2)));
    return sharp(photo).rotate().extract({ left, top, width: cw, height: ch }).resize(width, height).jpeg({ quality: 88 }).toBuffer();
  }
  // No cut-out (a photo with a scene behind the product): the centre, where product photos put the product. sharp's
  // "attention" crop was tried on 19 October 2026 and picked a fruit bowl and a control box instead of the tower (Veo then
  // invented a tower of its own), so it is not used.
  return img.resize(width, height, { fit: "cover", position: "centre" }).jpeg({ quality: 88 }).toBuffer();
}
