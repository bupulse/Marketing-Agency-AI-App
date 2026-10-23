import { describe, expect, it, vi } from "vitest";

// The renderer's AI clip layer (components/visuals/clip-layers.ts) with fake clips and canvases: which frame each
// clip scene shows, and that a clip that cannot be opened leaves its scene on the photo.
vi.mock("@/lib/video-engine/video-source", () => ({ VideoSource: { open: vi.fn() } }));

import { clipKey, openClipLayers, type ClipSource } from "@/components/visuals/clip-layers";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { sceneStarts } from "@/lib/visuals/timeline";
import type { VideoPlan } from "@/lib/visuals/types";

type Drawn = { frame: unknown };
function fakeCanvas(width: number, height: number) {
  const drawn: Drawn[] = [];
  return { width, height, drawn, getContext: () => ({ drawImage: (frame: unknown) => void drawn.push({ frame }) }) };
}
function fakeSource(durationMs = 6000) {
  const s = { width: 720, height: 1280, durationMs, asked: [] as number[], closed: false, frameAt: vi.fn(async (t: number) => (s.asked.push(t), { t }) as unknown as CanvasImageSource), close: () => void (s.closed = true) };
  return s satisfies ClipSource;
}

function plan(): VideoPlan {
  const p = buildVideoPlan({ script: "Grow your own greens\nNo soil, no mess\nFits any balcony", hook: "Fresh lettuce at home", businessName: "LEAF", photos: ["u/projects/a.jpg", "u/projects/b.jpg"], pack: "bold" });
  p.scenes[0].clipPath = "u/aiclips/v-0.mp4";
  p.scenes[1].clipPath = "u/aiclips/v-1.mp4";
  return p;
}
const urls = { "u/aiclips/v-0.mp4": "data:video/mp4;base64,AAAA", "u/aiclips/v-1.mp4": "data:video/mp4;base64,BBBB" };
const photo = { width: 1080, height: 1920 } as unknown as CanvasImageSource & { width: number; height: number };

describe("openClipLayers", () => {
  it("points clip scenes at their clip's canvas and keeps the photos for the rest", async () => {
    const sources = new Map<string, ReturnType<typeof fakeSource>>();
    const layers = await openClipLayers(plan(), new Map([["u/projects/a.jpg", photo]]), urls, {
      open: async (url) => sources.set(url, fakeSource()).get(url)!,
      canvas: fakeCanvas as never,
    });
    expect(layers.count).toBe(2);
    expect(layers.plan.scenes[0].photoPath).toBe(clipKey("u/aiclips/v-0.mp4"));
    expect(layers.plan.scenes[1].photoPath).toBe(clipKey("u/aiclips/v-1.mp4"));
    expect(layers.plan.scenes[2].photoPath).toBe(plan().scenes[2].photoPath);
    expect(layers.images.get(clipKey("u/aiclips/v-0.mp4"))).toMatchObject({ width: 720, height: 1280 });
    expect(layers.images.get("u/projects/a.jpg")).toBe(photo);
    // The first frame is drawn when the clip opens.
    expect([...sources.values()].every((s) => s.asked[0] === 0)).toBe(true);
    layers.close();
    expect([...sources.values()].every((s) => s.closed)).toBe(true);
  });

  it("each frame asks the clip on screen for the scene's own time, holding the last frame past its end", async () => {
    const p = plan();
    p.scenes[1].durationMs = 6000;
    const sources: ReturnType<typeof fakeSource>[] = [];
    const layers = await openClipLayers(p, new Map(), urls, { open: async () => (sources.push(fakeSource(4000)), sources.at(-1)!), canvas: fakeCanvas as never });
    const start = sceneStarts(p)[1];
    const second = sources[1];
    second.asked.length = 0;
    await layers.update(start + 1000);
    await layers.update(start + 5000);
    expect(second.asked[0]).toBeCloseTo(1000, 0);
    // The clip is 4 s: at 5 s into the scene it holds its last frame.
    expect(second.asked[1]).toBe(3950);
  });

  it("a clip that does not open leaves its scene on the photo", async () => {
    const layers = await openClipLayers(plan(), new Map(), urls, {
      open: async (url) => {
        if (url === urls["u/aiclips/v-1.mp4"]) throw new Error("cannot decode");
        return fakeSource();
      },
      canvas: fakeCanvas as never,
    });
    expect(layers.count).toBe(1);
    expect(layers.plan.scenes[1].photoPath).toBe("u/projects/b.jpg");
  });

  it("no clip URLs: the plan as it is", async () => {
    const p = plan();
    const layers = await openClipLayers(p, new Map(), {}, { open: async () => fakeSource(), canvas: fakeCanvas as never });
    expect(layers.count).toBe(0);
    expect(layers.plan.scenes.map((s) => s.photoPath)).toEqual(p.scenes.map((s) => s.photoPath));
  });

  it("a clip that stops decoding keeps its last frame instead of failing the video", async () => {
    const broken = fakeSource();
    const layers = await openClipLayers(plan(), new Map(), { "u/aiclips/v-0.mp4": urls["u/aiclips/v-0.mp4"] }, { open: async () => broken, canvas: fakeCanvas as never });
    broken.frameAt.mockRejectedValueOnce(new Error("decoder died"));
    await expect(layers.update(500)).resolves.toBeUndefined();
    broken.frameAt.mockClear();
    await layers.update(900);
    expect(broken.frameAt).not.toHaveBeenCalled();
  });
});
