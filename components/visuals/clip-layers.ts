// AI clips in the slideshow renderer (lib/visuals/ai-clips.ts makes them; docs/CONTENT_VISUALS.md "Video quality").
// A scene with a clip (VideoScene.clipPath) shows the clip's moving picture where its photo would be, muted (the
// video's own music and voice-over play): each clip is opened with VideoSource (mp4box + WebCodecs' VideoDecoder) and
// drawn into a small canvas of its own before each frame, and the plan drawn is a copy whose clip scenes point at that
// canvas, so the classic slideshow and every video look draw clips exactly like photos (same crops, motion, captions).
// A clip that cannot be loaded or decoded leaves its scene on the photo: a video is never failed for a clip.
import { VideoSource } from "@/lib/video-engine/video-source";
import { layersAt } from "@/lib/visuals/timeline";
import type { VideoPlan } from "@/lib/visuals/types";

type Img = CanvasImageSource & { width: number; height: number };
type Ctx = { drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void };
type ClipCanvas = Img & { getContext(id: "2d"): Ctx | null };

/** What the renderer needs of a clip: its size, its length, and the frame at a time (VideoSource in the browser). */
export type ClipSource = { width: number; height: number; durationMs: number; frameAt(tMs: number): Promise<CanvasImageSource>; close(): void };

export type ClipDeps = {
  open?: (url: string) => Promise<ClipSource>;
  canvas?: (width: number, height: number) => ClipCanvas;
};

export interface ClipLayers {
  /** The plan to draw: clip scenes point at their clip's canvas. */
  plan: VideoPlan;
  /** The photos plus one canvas per clip. */
  images: Map<string, Img>;
  /** Clips that opened. */
  count: number;
  /** Draws the current frame of each clip on screen at tMs into its canvas (call before drawing the frame). */
  update(tMs: number): Promise<void>;
  close(): void;
}

/** The key a clip's canvas has in the image map (never a storage path). */
export const clipKey = (path: string) => `clip:${path}`;

const defaultCanvas = (width: number, height: number): ClipCanvas =>
  (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height })) as unknown as ClipCanvas;

/** Opens the plan's clips (those with a URL); a clip that fails is left out and its scene keeps the photo. */
export async function openClipLayers(plan: VideoPlan, images: Map<string, Img>, clipUrls: Record<string, string> | undefined, deps: ClipDeps = {}): Promise<ClipLayers> {
  const open = deps.open ?? ((url: string) => VideoSource.open(url));
  const makeCanvas = deps.canvas ?? defaultCanvas;
  const paths = [...new Set(plan.scenes.flatMap((s) => (s.clipPath && clipUrls?.[s.clipPath] ? [s.clipPath] : [])))];
  const clips = new Map<string, { source: ClipSource; canvas: ClipCanvas; ctx: Ctx; broken: boolean }>();
  await Promise.all(
    paths.map(async (path) => {
      let source: ClipSource | null = null;
      try {
        source = await open(clipUrls![path]);
        const canvas = makeCanvas(source.width || 720, source.height || 1280);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No 2D canvas context");
        // The first frame proves the clip decodes here, and is what the scene starts on.
        ctx.drawImage(await source.frameAt(0), 0, 0, canvas.width, canvas.height);
        clips.set(path, { source, canvas, ctx, broken: false });
      } catch {
        source?.close();
      }
    }),
  );
  const drawn = new Map(images);
  for (const [path, clip] of clips) drawn.set(clipKey(path), clip.canvas);
  const drawPlan: VideoPlan = { ...plan, scenes: plan.scenes.map((s) => (s.clipPath && clips.has(s.clipPath) ? { ...s, photoPath: clipKey(s.clipPath) } : s)) };
  return {
    plan: drawPlan,
    images: drawn,
    count: clips.size,
    async update(tMs: number) {
      for (const layer of layersAt(plan, tMs)) {
        const scene = plan.scenes[layer.index];
        const clip = scene.clipPath ? clips.get(scene.clipPath) : undefined;
        if (!clip || clip.broken) continue;
        // The scene's own time; a scene longer than its clip holds the clip's last frame.
        const local = Math.min(layer.progress * scene.durationMs, Math.max(0, clip.source.durationMs - 50));
        try {
          clip.ctx.drawImage(await clip.source.frameAt(local), 0, 0, clip.canvas.width, clip.canvas.height);
        } catch {
          // Keeps the last frame drawn for the rest of the video.
          clip.broken = true;
        }
      }
    },
    close() {
      for (const clip of clips.values()) clip.source.close();
    },
  };
}
