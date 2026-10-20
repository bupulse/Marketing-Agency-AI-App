import { describe, expect, it } from "vitest";
import type { Layer, MotionSpec } from "@/lib/video-engine/spec";
import { drawnHeight } from "@/lib/video-engine/subject";
import { PHOTO_EDGE_MARGIN, STRICT_AREA, offPhotoEdges, safeAreaFor, validateSpec } from "@/lib/video-engine/validate";
// The first LEAF end-to-end video (VideoJob cmvf0b2lt00010v45u4zdrtdm, kigali-price-first, TikTok 9:16), read from the
// TEST database as it was saved. Its scene 3 has a framed photo; the WhatsApp bar under it only touched the photo's
// bottom edge in the design, and lay across it on screen once the handheld camera moved the layers apart.
import saved from "./fixtures/leaf-e2e-kigali-price-first.json";

type Text = Extract<Layer, { kind: "text" }>;
type Photo = Extract<Layer, { kind: "photo" }>;
const spec = saved as unknown as MotionSpec;

/** How a text sits against a framed photo: fully inside, fully clear (both with the margin), or across an edge. */
function place(t: Text, p: Photo, layers: Layer[]): "inside" | "clear" | "across" | "beside" {
  if (Math.abs(t.x - p.x) >= (t.w + p.w) / 2 - 0.01) return "beside";
  const behind = layers.filter((s) => s.kind === "shape" && Math.abs(s.x - t.x) <= t.w / 2 && Math.abs(s.y - t.y) <= t.h / 2 && s.h <= t.h * 2.2);
  const half = Math.max(drawnHeight(t, "9:16"), ...behind.map((s) => s.h)) / 2;
  const top = p.y - p.h / 2;
  const bottom = p.y + p.h / 2;
  const m = PHOTO_EDGE_MARGIN - 0.001;
  if (t.y - half >= top + m && t.y + half <= bottom - m) return "inside";
  if (t.y + half <= top - m || t.y - half >= bottom + m) return "clear";
  return "across";
}
const texts = (layers: Layer[]) => layers.filter((l): l is Text => l.kind === "text");
const framedPhoto = (layers: Layer[]) => layers.find((l): l is Photo => l.kind === "photo" && l.w < 0.95)!;

describe("text off a framed photo's edge", () => {
  const scene = spec.scenes[2].layers;

  it("reproduces the saved video: the WhatsApp bar sits on the framed photo's bottom edge", () => {
    const photo = framedPhoto(scene);
    const bar = texts(scene).find((t) => t.text.startsWith("WhatsApp"))!;
    expect(place(bar, photo, scene)).toBe("across");
  });

  it("moves the bar fully inside the photo's bottom (no room below: the next line is there), with its shape; clear lines stay", () => {
    const area = safeAreaFor("tiktok");
    const fixed = offPhotoEdges(scene, "9:16", area);
    const photo = framedPhoto(fixed);
    for (const t of texts(fixed)) expect(place(t, photo, fixed), t.text).not.toBe("across");
    const bar = texts(fixed).find((t) => t.text.startsWith("WhatsApp"))!;
    expect(place(bar, photo, fixed)).toBe("inside");
    expect(bar.y).toBeCloseTo(photo.y + photo.h / 2 - PHOTO_EDGE_MARGIN - 0.0325, 3);
    const shape = fixed.find((l) => l.kind === "shape")!;
    expect(shape.y).toBe(bar.y);
    // With room below (the next line further down), it goes clear below instead.
    const roomy = scene.map((l) => (l.kind === "text" && l.text.startsWith("Find us") ? { ...l, y: 0.8, size: 0.03 } : l));
    const below = offPhotoEdges(roomy, "9:16", area);
    expect(place(texts(below).find((t) => t.text.startsWith("WhatsApp"))!, photo, below)).toBe("clear");
    // The headline above was already clear: unchanged.
    expect(texts(fixed).find((t) => t.text.startsWith("Homes"))!.y).toBe(0.17);
  });

  it("a headline across the top edge goes above it; a boxed line with room inside goes inside", () => {
    const photo: Photo = { kind: "photo", photo: 1, x: 0.5, y: 0.46, w: 0.86, h: 0.43, fit: "cover" } as Photo;
    const headline: Text = { ...(texts(scene)[0] as Text), y: 0.24 };
    const boxed: Text = { ...(texts(scene)[0] as Text), text: "Grow at home", size: 0.04, y: 0.66, box: { color: "rgba(0,0,0,0.55)", radius: 0.3, padding: 0.02 } };
    const [, up] = offPhotoEdges([photo, headline], "9:16", STRICT_AREA) as [Photo, Text];
    expect(place(up, photo, [photo, up])).toBe("clear");
    expect(up.y).toBeLessThan(0.24);
    const [, inner] = offPhotoEdges([photo, boxed], "9:16", STRICT_AREA) as [Photo, Text];
    expect(place(inner, photo, [photo, inner])).toBe("inside");
    // A full-frame photo has no edge on screen: nothing moves.
    const full = { ...photo, w: 1, h: 1, y: 0.5 };
    expect(offPhotoEdges([full, headline], "9:16", STRICT_AREA)[1]).toBe(headline);
  });

  it("a new design or edit of the saved spec keeps every line off the framed photo's edges, and lines apart", () => {
    const out = validateSpec(spec, { ratio: "9:16", photoCount: 4, seconds: 15, platform: "tiktok", phone: "0788000111" });
    for (const s of out.scenes) {
      const photo = s.layers.find((l): l is Photo => l.kind === "photo" && !l.cutout && (l.w < 0.95 || l.h < 0.95));
      if (!photo) continue;
      for (const t of texts(s.layers)) expect(place(t, photo, s.layers), t.text).not.toBe("across");
      // No two lines print on top of each other.
      const ts = texts(s.layers).sort((a, b) => a.y - b.y);
      for (let k = 1; k < ts.length; k++) {
        if (Math.abs(ts[k].x - ts[k - 1].x) >= (ts[k].w + ts[k - 1].w) / 2) continue;
        expect(ts[k].y - drawnHeight(ts[k], "9:16") / 2, `${ts[k - 1].text} / ${ts[k].text}`).toBeGreaterThanOrEqual(ts[k - 1].y + drawnHeight(ts[k - 1], "9:16") / 2 - 0.002);
      }
    }
  });
});
