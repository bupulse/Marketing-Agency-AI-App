// Browser video renderer (docs/CONTENT_VISUALS.md): turns a VideoPlan into an MP4 (WebCodecs + mp4-muxer) or, where
// WebCodecs is missing, a real-time WebM (MediaRecorder). Client-only; the timeline maths lives in lib/visuals/timeline.
import { STYLES } from "@/lib/designs/library/styles";
import { captionAt, frameCount, frameTimestampUs, kenBurns, layersAt, wrapText } from "@/lib/visuals/timeline";
import { VIDEO_LIMITS, type VideoPlan } from "@/lib/visuals/types";
import { getVideoLook } from "@/lib/visuals/video-looks";
import { drawLookFrame } from "./look-renderer";
import { mixSamples } from "@/lib/voice/mix";

export type VideoSupport = { mp4: boolean; webm: boolean };

type Img = CanvasImageSource & { width: number; height: number };
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** Sync, cheap: whether WebCodecs VideoEncoder (mp4) or MediaRecorder+canvas.captureStream (webm) exist. */
export function videoSupport(): VideoSupport {
  if (typeof window === "undefined") return { mp4: false, webm: false };
  const mp4 = typeof VideoEncoder !== "undefined";
  const webm =
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function";
  return { mp4, webm };
}

export class VideoRenderError extends Error {
  readonly reason: "unsupported" | "too_large" | "aborted" | "failed";
  constructor(reason: "unsupported" | "too_large" | "aborted" | "failed", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VideoRenderError";
    this.reason = reason;
  }
}

export interface RenderOptions {
  /** Signed URLs for scene.photoPath values. A missing or failing image draws the brand backdrop instead (never fail). */
  photoUrls: Record<string, string>;
  /** Optional owner-uploaded music track (never stored); it replaces the library track. */
  music?: File | Blob | null;
  /** The voiceover MP3 (signed URL or data URL) and the library track (public or data URL), mixed under the video. */
  voiceUrl?: string | null;
  musicUrl?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  mimeType: "video/mp4" | "video/webm";
  durationMs: number;
  /** Music or voice was asked for but this browser could not decode or encode it: the video is silent. */
  musicSkipped: boolean;
}

const UNSUPPORTED = "This browser cannot make videos. Try the latest Chrome, Edge or Safari on a computer or phone.";
const TOO_LARGE = "The video came out larger than 8 MB. Try fewer scenes or shorter captions.";
const FAILED = "We could not make the video in this browser. Please try again.";

/** The pack's caption font (lib/designs/library/styles.ts STYLES[pack].video). */
function captionFont(pack: VideoPlan["pack"]): { family: string; weight: number; upper: boolean } {
  const v = (STYLES[pack] ?? STYLES.clean).video;
  return { family: v.css, weight: v.weight, upper: v.upper };
}

// The pack's caption font and the business-name weight, self-hosted in public/fonts/video (the Fontsource 5.3.0 files
// of the families the slide designs use, SIL OFL), so a video looks the same in every browser and in the video
// robot's headless Chrome (docs/VIDEO_ROBOT.md). Latin and Latin Extended only; other scripts use the fallback fonts.
const FONT_BASE = "/fonts/video";
const FONT_RANGES = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext": "U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
} as const;

/** Loads the plan's fonts into the page (at most `timeoutMs`); a font that does not arrive leaves the fallback font. */
export async function loadVideoFonts(pack: VideoPlan["pack"], timeoutMs = 4000): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return;
  const files = (STYLES[pack] ?? STYLES.clean).video;
  const faces = files.weights.flatMap((weight) =>
    (Object.keys(FONT_RANGES) as (keyof typeof FONT_RANGES)[]).map((subset) => {
      const url = `${FONT_BASE}/${files.slug}-${subset}-${weight}-normal.woff2`;
      return new FontFace(files.family, `url(${url}) format("woff2")`, { weight: String(weight), unicodeRange: FONT_RANGES[subset] });
    }),
  );
  const loads = faces.map((face) =>
    face.load().then(
      (loaded) => void document.fonts.add(loaded),
      () => undefined,
    ),
  );
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Draws one frame at tMs onto a 2D context (exported so the UI can show a live preview / poster). */
export function drawFrame(ctx: CanvasRenderingContext2D, plan: VideoPlan, images: Map<string, Img>, tMs: number): void {
  // A plan with a look (lib/visuals/video-looks.ts) is drawn by its layouts; older plans keep the original slideshow.
  const look = getVideoLook(plan.look);
  if (look) return drawLookFrame(ctx, plan, look, images, tMs);
  const W = plan.width;
  const H = plan.height;
  const font = captionFont(plan.pack);
  ctx.globalAlpha = 1;
  ctx.fillStyle = plan.colors.background;
  ctx.fillRect(0, 0, W, H);

  for (const layer of layersAt(plan, tMs)) {
    const scene = plan.scenes[layer.index];
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    const img = scene.photoPath ? images.get(scene.photoPath) : undefined;
    if (img && img.width > 0 && img.height > 0) {
      const r = kenBurns(scene.motion, layer.progress, img, { width: W, height: H });
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
    } else {
      drawBackdrop(ctx, plan, layer.opacity);
    }

    // Scrim: transparent at the middle, dark at the bottom, so captions always read.
    const scrim = ctx.createLinearGradient(0, H * 0.45, 0, H);
    scrim.addColorStop(0, "rgba(0,0,0,0)");
    scrim.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.globalAlpha = layer.opacity;
    ctx.fillStyle = scrim;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);

    ctx.restore();
  }

  // One caption at a time, over the photos (lib/visuals/timeline.ts captionAt): the outgoing text is gone before the
  // incoming one fades in, so captions never overlap during a crossfade.
  const caption = captionAt(plan, tMs);
  const scene = caption ? plan.scenes[caption.index] : null;
  const text = scene ? (font.upper ? scene.text.toUpperCase() : scene.text) : "";
  if (caption && scene && text.trim() && caption.alpha > 0) {
    ctx.save();
    const size = scene.role === "body" ? 64 : 84;
    const lineHeight = size * 1.18;
    ctx.font = `${font.weight} ${size}px ${font.family}`;
    const lines = wrapText(text, W - 160, (s) => ctx.measureText(s).width, 4);
    const top = H * 0.72 - (lines.length * lineHeight) / 2 + (1 - caption.rise) * 40;
    ctx.globalAlpha = caption.alpha;
    ctx.fillStyle = plan.colors.accent;
    ctx.fillRect(W / 2 - 60, top - 40, 120, 10);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = plan.colors.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, W / 2, top + i * lineHeight));
    ctx.restore();
  }

  // Business name, small, near the top.
  if (plan.businessName) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `600 32px ${font.family}`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 10;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(plan.businessName, W / 2, 110);
    ctx.restore();
  }
}

/** The brand backdrop for a scene without a photo: background into an accent tint, with a soft accent circle. */
function drawBackdrop(ctx: CanvasRenderingContext2D, plan: VideoPlan, opacity: number): void {
  const W = plan.width;
  const H = plan.height;
  ctx.fillStyle = plan.colors.background;
  ctx.fillRect(0, 0, W, H);
  const tint = ctx.createLinearGradient(0, 0, 0, H);
  tint.addColorStop(0, "rgba(0,0,0,0)");
  tint.addColorStop(1, plan.colors.accent);
  ctx.globalAlpha = opacity * 0.28;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = opacity * 0.16;
  ctx.fillStyle = plan.colors.accent;
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.3, W * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = opacity;
}

export async function renderVideo(plan: VideoPlan, options: RenderOptions): Promise<RenderResult> {
  const support = videoSupport();
  if (!support.mp4 && !support.webm) throw new VideoRenderError("unsupported", UNSUPPORTED);
  try {
    checkAbort(options.signal);
    const [images] = await Promise.all([loadImages(plan, options.photoUrls), loadVideoFonts(getVideoLook(plan.look)?.style ?? plan.pack)]);
    if (support.mp4) {
      const wantsAudio = !!(options.music || options.voiceUrl || options.musicUrl);
      const audio = wantsAudio ? await encodeSoundtrack(plan, options).catch(() => null) : null;
      let blob = await encodeMp4(plan, images, VIDEO_LIMITS.bitrate, audio, options);
      if (blob.size > VIDEO_LIMITS.maxBytes) blob = await encodeMp4(plan, images, VIDEO_LIMITS.bitrate * 0.55, audio, options);
      if (blob.size > VIDEO_LIMITS.maxBytes) throw new VideoRenderError("too_large", TOO_LARGE);
      options.onProgress?.(1);
      return { blob, mimeType: "video/mp4", durationMs: plan.totalMs, musicSkipped: wantsAudio && !audio };
    }
    const blob = await recordWebm(plan, images, options);
    if (blob.size > VIDEO_LIMITS.maxBytes) throw new VideoRenderError("too_large", TOO_LARGE);
    options.onProgress?.(1);
    return { blob, mimeType: "video/webm", durationMs: plan.totalMs, musicSkipped: !!(options.music || options.voiceUrl || options.musicUrl) };
  } catch (error) {
    if (error instanceof VideoRenderError) throw error;
    if (options.signal?.aborted) throw new VideoRenderError("aborted", "The video was cancelled.", { cause: error });
    throw new VideoRenderError("failed", FAILED, { cause: error });
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VideoRenderError("aborted", "The video was cancelled.");
}

/** Loads every scene photo; a failing one is left out (the scene draws the backdrop). */
async function loadImages(plan: VideoPlan, urls: Record<string, string>): Promise<Map<string, Img>> {
  const images = new Map<string, Img>();
  const paths = [...new Set([...plan.scenes.map((s) => s.photoPath), plan.logoPath].filter((p): p is string => !!p && !!urls[p]))];
  await Promise.all(
    paths.map(async (path) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = urls[path];
        await img.decode();
        images.set(path, img);
      } catch {
        // Backdrop instead.
      }
    }),
  );
  return images;
}

function makeCanvas(plan: VideoPlan): { canvas: AnyCanvas; ctx: CanvasRenderingContext2D } {
  const canvas: AnyCanvas =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(plan.width, plan.height) : document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("No 2D canvas context");
  return { canvas, ctx };
}

type EncodedAudio = { chunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[]; sampleRate: number; numberOfChannels: number };

const SAMPLE_RATE = 44_100;

/** Fetches and decodes one audio file at 44.1 kHz; null when it is missing or cannot be decoded. */
async function decode(context: BaseAudioContext, source: Blob | string | null | undefined): Promise<Float32Array[] | null> {
  if (!source) return null;
  try {
    const bytes = typeof source === "string" ? await (await fetch(source)).arrayBuffer() : await source.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice());
  } catch {
    return null;
  }
}

/**
 * The soundtrack: the voiceover over the music (the owner's own file, else the library track), mixed by
 * lib/voice/mix.ts, encoded to AAC. Null when there is nothing to hear or this browser cannot encode AAC.
 */
async function encodeSoundtrack(plan: VideoPlan, options: RenderOptions): Promise<EncodedAudio | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioContext === "undefined") return null;
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  let voice: Float32Array[] | null;
  let music: Float32Array[] | null;
  try {
    [voice, music] = await Promise.all([decode(context, options.voiceUrl), decode(context, options.music ?? options.musicUrl)]);
  } finally {
    void context.close().catch(() => undefined);
  }
  const mixed = mixSamples({ voice, music, sampleRate: SAMPLE_RATE, totalMs: plan.totalMs, speech: plan.voice?.timings ?? [] });
  if (!mixed) return null;
  return encodePcm(mixed, SAMPLE_RATE);
}

/** Encodes PCM channels to AAC with WebCodecs. Null when unsupported. */
async function encodePcm(channels: Float32Array[], sampleRate: number): Promise<EncodedAudio | null> {
  const numberOfChannels = channels.length;
  const config: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate, numberOfChannels, bitrate: 128_000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) return null;
  const frames = channels[0].length;
  const chunks: EncodedAudio["chunks"] = [];
  let failure: unknown = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => chunks.push({ chunk, meta }), error: (e) => (failure = e) });
  try {
    encoder.configure(config);
    const step = 4096;
    for (let offset = 0; offset < frames; offset += step) {
      const n = Math.min(step, frames - offset);
      const data = new Float32Array(n * numberOfChannels);
      for (let c = 0; c < numberOfChannels; c++) data.set(channels[c].subarray(offset, offset + n), c * n);
      const audio = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels, timestamp: Math.round((offset / sampleRate) * 1e6), data });
      encoder.encode(audio);
      audio.close();
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (failure || chunks.length === 0) return null;
  return { chunks, sampleRate, numberOfChannels };
}

/** Encodes every frame with WebCodecs H.264 and muxes it (plus the music, if any) into an in-memory MP4. */
async function encodeMp4(plan: VideoPlan, images: Map<string, Img>, bitrate: number, audio: EncodedAudio | null, options: RenderOptions): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  let config: VideoEncoderConfig | null = null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
    const candidate: VideoEncoderConfig = { codec, width: plan.width, height: plan.height, bitrate: Math.round(bitrate), framerate: plan.fps, avc: { format: "avc" } };
    if ((await VideoEncoder.isConfigSupported(candidate).catch(() => ({ supported: false }))).supported) {
      config = candidate;
      break;
    }
  }
  if (!config) throw new VideoRenderError("unsupported", UNSUPPORTED);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: plan.width, height: plan.height, frameRate: plan.fps },
    ...(audio ? { audio: { codec: "aac" as const, sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  const { canvas, ctx } = makeCanvas(plan);
  try {
    encoder.configure(config);
    const total = frameCount(plan);
    const duration = frameTimestampUs(1, plan.fps);
    for (let i = 0; i < total; i++) {
      checkAbort(options.signal);
      if (failure) throw failure;
      drawFrame(ctx, plan, images, (i * 1000) / plan.fps);
      const frame = new VideoFrame(canvas, { timestamp: frameTimestampUs(i, plan.fps), duration });
      try {
        encoder.encode(frame, { keyFrame: i % (plan.fps * 2) === 0 });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      options.onProgress?.((i + 1) / total * 0.98);
    }
    await encoder.flush();
    if (failure) throw failure;
    for (const { chunk, meta } of audio?.chunks ?? []) muxer.addAudioChunk(chunk, meta);
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

/** Fallback without WebCodecs: plays the timeline in real time on a real canvas and records it with MediaRecorder. */
function recordWebm(plan: VideoPlan, images: Map<string, Img>, options: RenderOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context");
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  drawFrame(ctx, plan, images, 0);
  const stream = canvas.captureStream(plan.fps);
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_LIMITS.bitrate });
  const parts: Blob[] = [];
  return new Promise<Blob>((resolve, reject) => {
    let aborted = false;
    const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onerror = (event) => {
      stopTracks();
      reject(event);
    };
    recorder.onstop = () => {
      stopTracks();
      if (aborted) reject(new VideoRenderError("aborted", "The video was cancelled."));
      else resolve(new Blob(parts, { type: "video/webm" }));
    };
    recorder.start(1000);
    const start = performance.now();
    const tick = () => {
      if (recorder.state === "inactive") return;
      if (options.signal?.aborted) {
        aborted = true;
        recorder.stop();
        return;
      }
      const t = performance.now() - start;
      drawFrame(ctx, plan, images, Math.min(t, plan.totalMs));
      options.onProgress?.(Math.min(0.99, t / plan.totalMs));
      if (t >= plan.totalMs) recorder.stop();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
