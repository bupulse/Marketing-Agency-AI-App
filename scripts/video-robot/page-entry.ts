// The video robot's page (docs/VIDEO_ROBOT.md): bundled by build-page.mjs with the browser renderer itself
// (components/visuals/video-renderer.ts and lib/visuals/timeline.ts), so a robot video is drawn by exactly the code
// an owner's browser runs. The robot drives it through window.videoRobot.
import { renderVideo, VideoRenderError } from "@/components/visuals/video-renderer";
import type { VideoPlan } from "@/lib/visuals/types";

type Format = "mp4" | "webm";

/** Which file this Chrome can make: MP4 when WebCodecs encodes H.264 at 1080x1920, else WebM through MediaRecorder. */
async function support(): Promise<Format | null> {
  if (typeof VideoEncoder !== "undefined") {
    for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
      const config = { codec, width: 1080, height: 1920, bitrate: 2_000_000, framerate: 30, avc: { format: "avc" as const } };
      if ((await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) return "mp4";
    }
  }
  if (typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function") return "webm";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Renders one plan. The renderer picks MP4 whenever VideoEncoder exists, so WebM is forced by hiding it. */
async function render(plan: VideoPlan, photoUrls: Record<string, string>, format: Format, audio: { voice?: string; music?: string } = {}, clipUrls: Record<string, string> = {}) {
  if (format === "webm") Reflect.deleteProperty(globalThis, "VideoEncoder");
  try {
    // Voiceover and music arrive as data URLs, like the photos: the same mix as the owner's browser (lib/voice/mix.ts).
    // AI clips arrive as data URLs too (lib/visuals/ai-clips.ts); a missing one keeps its scene's photo.
    const result = await renderVideo(plan, { photoUrls, clipUrls, voiceUrl: audio.voice ?? null, musicUrl: audio.music ?? null });
    return { ok: true as const, base64: toBase64(new Uint8Array(await result.blob.arrayBuffer())), mimeType: result.mimeType, bytes: result.blob.size };
  } catch (error) {
    const reason = error instanceof VideoRenderError ? (error.reason === "too_large" ? "too_large" : error.reason === "unsupported" ? "unsupported" : "render_failed") : "render_failed";
    return { ok: false as const, reason };
  }
}

(globalThis as unknown as { videoRobot: unknown }).videoRobot = { support, render };
