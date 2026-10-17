// Turns a motion spec into an MP4 in the browser (docs/VIDEO_ENGINE.md): WebCodecs H.264 + mp4-muxer, the same path
// as the slideshow renderer (components/visuals/video-renderer.ts), with an optional soundtrack: the voice-over
// (voice.ts cues, each placed at its scene) at full level and the music at 85%, ducked to 20% while the voice speaks
// (lib/voice/mix.ts, the same mixer as the slideshow videos). Client-only. Fonts are loaded from the self-hosted files
// in public/fonts/video before the first frame.
import { mixSamples } from "@/lib/voice/mix";
import { frameCount, frameUs } from "./animate";
import { drawSpecFrame, type Img, type Photos } from "./draw";
import { FONTS, canvasSize, totalMs, type FontId, type MotionSpec, type Quality } from "./spec";
import { cueTimings, placeVoice, type VoiceCue } from "./voice";

const FONT_RANGES = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext": "U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
} as const;

/** Loads every font the spec uses (at most `timeoutMs`); a font that does not arrive leaves the fallback font. */
export async function loadSpecFonts(spec: MotionSpec, base = "/fonts/video", timeoutMs = 5000): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const used = new Set<FontId>(["inter"]);
  for (const s of spec.scenes) for (const l of s.layers) if (l.kind === "text") used.add(l.font);
  const loads = [...used].flatMap((id) => {
    const f = FONTS[id];
    return f.weights.flatMap((weight) =>
      (Object.keys(FONT_RANGES) as (keyof typeof FONT_RANGES)[]).map((subset) =>
        new FontFace(f.family, `url(${base}/${f.slug}-${subset}-${weight}-normal.woff2) format("woff2")`, { weight: String(weight), unicodeRange: FONT_RANGES[subset] })
          .load()
          .then((face) => void document.fonts.add(face), () => undefined),
      ),
    );
  });
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/**
 * Decodes the spec's photos from URLs (1-based numbers). A photo that fails is left out: its layers draw a colour.
 * `cutoutUrls` (same order, null for none) are the product cut-outs, kept under `${n}:cutout`; one that fails (the
 * photo cannot be cut out) is left out and the layer shows the photo as it is.
 */
export function loadPhotos(urls: string[]): Promise<Map<number, Img>>;
export function loadPhotos(urls: string[], cutoutUrls: (string | null)[]): Promise<Photos>;
export async function loadPhotos(urls: string[], cutoutUrls: (string | null)[] = []): Promise<Photos> {
  const map: Photos = new Map();
  const load = async (url: string, key: number | string) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await img.decode();
      map.set(key, img);
    } catch {
      // Drawn as a colour block (or the plain photo) instead.
    }
  };
  await Promise.all([...urls.map((url, i) => load(url, i + 1)), ...cutoutUrls.map((url, i) => (url ? load(url, `${i + 1}:cutout`) : null))]);
  return map;
}

export type EncodeOptions = {
  musicUrl?: string | null;
  /** The voice-over take (MP3 URL) and where each piece of it plays (fitSpecToVoice); the spec must be the fitted one. */
  voice?: { url: string; cues: VoiceCue[] } | null;
  quality?: Quality;
  bitrate?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/** Encodes the whole spec to an MP4 Blob. Throws when this browser has no H.264 encoder. */
export async function encodeSpecMp4(spec: MotionSpec, photos: Photos, options: EncodeOptions = {}): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser cannot make MP4 videos. Use the latest Chrome or Edge.");
  const quality = options.quality ?? "1080p";
  const { width, height } = canvasSize(spec, quality);
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  // About 0.1 bits per pixel per frame: 1080x1920 at 30 fps is ~6 Mbit/s, 720p ~2.7, 480p ~1.2.
  const bitrate = options.bitrate ?? Math.round(Math.min(8_000_000, Math.max(1_000_000, width * height * spec.fps * 0.1)));
  let config: VideoEncoderConfig | null = null;
  // H.264 level 4.0 (…28) holds up to about 1920x1088; the widest shapes (21:9 at 2520x1080) need level 5.1 (…33).
  const codecs = width * height > 2_088_960 ? ["avc1.640033", "avc1.4d0033"] : ["avc1.640028", "avc1.4d0028", "avc1.42e028"];
  for (const codec of codecs) {
    const candidate: VideoEncoderConfig = { codec, width, height, bitrate, framerate: spec.fps, avc: { format: "avc" } };
    if ((await VideoEncoder.isConfigSupported(candidate).catch(() => ({ supported: false }))).supported) {
      config = candidate;
      break;
    }
  }
  if (!config) throw new Error("This browser has no H.264 encoder. Use the latest Chrome or Edge.");
  const audio = options.musicUrl || options.voice?.cues.length ? await encodeSoundtrack(options.musicUrl ?? null, options.voice ?? null, totalMs(spec)).catch(() => null) : null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: spec.fps },
    ...(audio ? { audio: { codec: "aac" as const, sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  try {
    encoder.configure(config);
    const total = frameCount(spec);
    const duration = frameUs(1, spec.fps);
    for (let i = 0; i < total; i++) {
      if (options.signal?.aborted) throw new Error("Cancelled");
      if (failure) throw failure;
      drawSpecFrame(ctx, spec, photos, (i * 1000) / spec.fps, { quality });
      const frame = new VideoFrame(canvas, { timestamp: frameUs(i, spec.fps), duration });
      try {
        encoder.encode(frame, { keyFrame: i % (spec.fps * 2) === 0 });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      options.onProgress?.(((i + 1) / total) * 0.98);
    }
    await encoder.flush();
    if (failure) throw failure;
    for (const { chunk, meta } of audio?.chunks ?? []) muxer.addAudioChunk(chunk, meta);
    muxer.finalize();
    options.onProgress?.(1);
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

type EncodedAudio = { chunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[]; sampleRate: number; numberOfChannels: number };
const RATE = 44_100;

async function decode(context: AudioContext, url: string | null): Promise<Float32Array[] | null> {
  if (!url) return null;
  try {
    const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
    return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  } catch {
    // A track that does not load leaves the video without it (never fails the video).
    return null;
  }
}

/**
 * The soundtrack, encoded to AAC: the voice cues placed at their scenes, and the music looped to the video's length,
 * faded in 1 s and out 1.5 s, at 85% and ducked under the voice. Null when neither loads.
 */
async function encodeSoundtrack(musicUrl: string | null, voice: { url: string; cues: VoiceCue[] } | null, ms: number): Promise<EncodedAudio | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioContext === "undefined") return null;
  const context = new AudioContext({ sampleRate: RATE });
  let take: Float32Array[] | null;
  let music: Float32Array[] | null;
  try {
    [take, music] = await Promise.all([decode(context, voice?.cues.length ? voice.url : null), decode(context, musicUrl)]);
  } finally {
    void context.close().catch(() => undefined);
  }
  const placed = take && voice ? placeVoice(take, voice.cues, RATE, ms) : null;
  const out = mixSamples({ voice: placed, music, sampleRate: RATE, totalMs: ms, speech: voice ? cueTimings(voice.cues) : [] });
  if (!out) return null;
  const channels = out.length;
  const frames = out[0].length;
  const config: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: channels, bitrate: 128_000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) return null;
  const chunks: EncodedAudio["chunks"] = [];
  let failure: unknown = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => chunks.push({ chunk, meta }), error: (e) => (failure = e) });
  try {
    encoder.configure(config);
    for (let offset = 0; offset < frames; offset += 4096) {
      const n = Math.min(4096, frames - offset);
      const data = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) data.set(out[c].subarray(offset, offset + n), c * n);
      const a = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((offset / RATE) * 1e6), data });
      encoder.encode(a);
      a.close();
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  return failure || chunks.length === 0 ? null : { chunks, sampleRate: RATE, numberOfChannels: channels };
}
