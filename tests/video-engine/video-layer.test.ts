import { describe, expect, it, vi } from "vitest";
import { drawSpecFrame, videoFrameKey } from "@/lib/video-engine/draw";
import { sumTracks } from "@/lib/video-engine/encode";
import { totalMs, type VideoLayer } from "@/lib/video-engine/spec";
import { validateSpec } from "@/lib/video-engine/validate";
import { clipSoundCues, openVideoFrames, videoClips, videoFramesAt } from "@/lib/video-engine/video-frames";

const clip = (over: Record<string, unknown> = {}) => ({ kind: "video", url: "/videos/seedance/sd-1.mp4", fit: "cover", start: 0, sound: true, x: 0.5, y: 0.5, w: 1, h: 1, ...over });
const text = (over: Record<string, unknown> = {}) => ({ kind: "text", text: "WhatsApp 0788 123 456", font: "inter", size: 0.04, color: "#ffffff", x: 0.5, y: 0.75, w: 0.7, h: 0.05, ...over });
const overlay = (scenes: unknown[], seconds = 8) => validateSpec({ palette: {}, scenes }, { ratio: "9:16", photoCount: 0, seconds });

describe("video layers: validation", () => {
  it("keeps a clip layer (url, fit, start, sound), one per scene, full frame by default", () => {
    const spec = overlay([{ seconds: 4, background: {}, layers: [{ kind: "video", url: "/videos/seedance/sd-1.mp4", start: 0, sound: true }, clip({ url: "/videos/seedance/sd-2.mp4" }), text()] }, { seconds: 4, background: {}, layers: [clip({ start: 4 })] }]);
    const v = spec.scenes[0].layers.filter((l) => l.kind === "video") as VideoLayer[];
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "video", url: "/videos/seedance/sd-1.mp4", fit: "cover", start: 0, sound: true, x: 0.5, y: 0.5, w: 1, h: 1 });
    expect(spec.scenes[1].layers[0]).toMatchObject({ start: 4 });
  });

  it("refuses addresses it should not load", () => {
    for (const url of ["javascript:alert(1)", "http://example.com/a.mp4", "file:///etc/passwd", "data:video/mp4;base64,AAAA", ""]) {
      const spec = overlay([{ seconds: 4, background: {}, layers: [clip({ url }), text()] }, { seconds: 4, background: {}, layers: [text()] }]);
      expect(spec.scenes[0].layers.some((l) => l.kind === "video")).toBe(false);
    }
    const ok = overlay([{ seconds: 4, background: {}, layers: [clip({ url: "https://cdn.example.com/clips/a.mp4?x=1" })] }, { seconds: 4, background: {}, layers: [clip({ start: 4 })] }]);
    expect(ok.scenes[0].layers[0]).toMatchObject({ kind: "video" });
  });

  it("a Seedance clip of 4 or 5 seconds is not stretched to 6 s, and a one-shot clip is a valid video", () => {
    const short = overlay([{ seconds: 2.5, background: {}, layers: [clip()] }, { seconds: 2, background: {}, layers: [clip({ start: 2.5 })] }], 4.5);
    expect(totalMs(short)).toBe(4500);
    const one = overlay([{ seconds: 5, background: {}, layers: [clip(), text()] }], 5);
    expect(one.scenes).toHaveLength(1);
    expect(() => overlay([{ seconds: 5, background: {}, layers: [text()] }], 5)).toThrow();
  });

  it("light text over a clip gets a veil, and text is kept off the clip's centre like a full-frame photo", () => {
    const spec = overlay([{ seconds: 4, background: {}, layers: [clip(), text({ text: "Galaxy A56", y: 0.5, size: 0.06, h: 0.08 })] }, { seconds: 4, background: {}, layers: [clip({ start: 4 })] }]);
    const [video, caption] = spec.scenes[0].layers;
    expect(video).toMatchObject({ dim: 0.4 });
    expect(caption.y < 0.36 || caption.y > 0.62).toBe(true);
  });
});

describe("video layers: frames and sound", () => {
  const spec = overlay([{ seconds: 3, background: {}, layers: [clip(), text()] }, { seconds: 3, background: {}, transition: "fade", layers: [clip({ start: 3 }), text()] }], 6);

  it("knows which clip frame each video frame needs (the scene's start in the clip plus the time in the scene)", () => {
    expect(videoFramesAt(spec, 1000)).toEqual([{ key: videoFrameKey(0, 0), url: "/videos/seedance/sd-1.mp4", clipMs: 1000 }]);
    // During the fade into scene 2 both scenes show, each at its own place in the clip.
    const both = videoFramesAt(spec, 3100);
    expect(both.map((b) => [b.key, b.clipMs])).toEqual([
      [videoFrameKey(0, 0), 2999],
      [videoFrameKey(1, 0), 3100],
    ]);
    expect(videoClips(spec)).toEqual([{ url: "/videos/seedance/sd-1.mp4", sound: true }]);
  });

  it("places the clip's sound scene by scene, like voice cues", () => {
    expect(clipSoundCues(spec)).toEqual([{ url: "/videos/seedance/sd-1.mp4", cues: [{ scene: 0, fromMs: 0, toMs: 3000, atMs: 0 }, { scene: 1, fromMs: 3000, toMs: 6000, atMs: 3000 }] }]);
    const silent = overlay([{ seconds: 3, background: {}, layers: [clip({ sound: false })] }, { seconds: 3, background: {}, layers: [clip({ start: 3, sound: false })] }], 6);
    expect(clipSoundCues(silent)).toEqual([]);
    const [mixed] = sumTracks([[Float32Array.from([0.1, 0.2])], [Float32Array.from([0.3, 0.3]), Float32Array.from([0, 0])]]);
    expect(Array.from(mixed).map((v) => Math.round(v * 10) / 10)).toEqual([0.4, 0.5]);
  });

  it("opens each clip once, fills the photos map in time order, shares one frame between two scenes of one clip, and closes", async () => {
    const frameAt = vi.fn(async (t: number) => ({ displayWidth: 720, displayHeight: 1280, t }) as unknown as VideoFrame);
    const close = vi.fn();
    const open = vi.fn(async () => ({ frameAt, close }));
    const frames = await openVideoFrames(spec, open);
    expect(open).toHaveBeenCalledTimes(1);
    const photos = new Map();
    await frames.prepare(3100, photos);
    expect(frameAt).toHaveBeenCalledTimes(1);
    expect(frameAt).toHaveBeenLastCalledWith(3100);
    expect(photos.get(videoFrameKey(0, 0))).toBe(photos.get(videoFrameKey(1, 0)));
    frames.close();
    expect(close).toHaveBeenCalled();
    const broken = await openVideoFrames(spec, async () => {
      throw new Error("no");
    });
    expect(broken.failed).toEqual(["/videos/seedance/sd-1.mp4"]);
    await broken.prepare(1000, photos);
  });

  it("draws the frame from the map (cover crop), black when it is missing", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) =>
        prop in target ? target[prop] : prop === "measureText" ? (s: string) => ({ width: s.length * 20 }) : prop.startsWith("create") ? () => ({ addColorStop: () => undefined }) : (...a: unknown[]) => void calls.push(`${prop}:${a.length}:${a[0] && typeof a[0] === "object" && "tag" in (a[0] as object) ? (a[0] as { tag: string }).tag : ""}`),
      set: (target, prop: string, value) => ((target[prop] = value), true),
    });
    const frame = { tag: "frame", displayWidth: 1280, displayHeight: 720 };
    drawSpecFrame(ctx as unknown as CanvasRenderingContext2D, spec, new Map([[videoFrameKey(0, 0), frame as unknown as VideoFrame]]), 1000, { makeCanvas: null });
    expect(calls).toContain("drawImage:9:frame");
    calls.length = 0;
    drawSpecFrame(ctx as unknown as CanvasRenderingContext2D, spec, new Map(), 1000, { makeCanvas: null });
    expect(calls.some((c) => c.startsWith("drawImage"))).toBe(false);
  });
});

describe("a clip plays straight through its cuts", () => {
  it("the video layer is fully opaque on a scene's first frame (no entrance fade from black)", () => {
    // Overlay specs cut between shots (a fade would show the previous scene first).
    const spec = overlay([{ seconds: 3, background: {}, layers: [clip(), text()] }, { seconds: 3, background: {}, transition: "cut", layers: [clip({ start: 3 }), text()] }], 6);
    const alphas: number[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => {
        if (prop in target) return target[prop];
        if (prop === "measureText") return (s: string) => ({ width: s.length * 20 });
        if (prop.startsWith("create")) return () => ({ addColorStop: () => undefined });
        if (prop === "drawImage") return () => void alphas.push(target.globalAlpha as number);
        return () => undefined;
      },
      set: (target, prop: string, value) => ((target[prop] = value), true),
    });
    const frame = { displayWidth: 720, displayHeight: 1280 } as unknown as VideoFrame;
    drawSpecFrame(ctx as unknown as CanvasRenderingContext2D, spec, new Map([[videoFrameKey(1, 0), frame]]), 3000, { makeCanvas: null });
    expect(alphas[0]).toBe(1);
  });
});
