// Frames of an MP4 for a "video" layer (docs/VIDEO_ENGINE.md, "Seedance overlay"): the renderer asks for the frame at
// a time and gets a VideoFrame to draw (ctx.drawImage takes it). The MP4 is read with mp4box (the sample table: where
// each frame's bytes are, its times, which are keyframes) and decoded with WebCodecs' VideoDecoder, in decode order
// from the nearest keyframe, so rendering a video front to back decodes each frame once. A few decoded frames are kept
// and the rest are closed (each VideoFrame holds GPU memory until closed).
// The sample table, the timing and the cache are plain code (unit-tested in node); VideoSource needs a browser.
import { DataStream, Endianness, MP4BoxBuffer, createFile, type Movie } from "mp4box";

/** One frame's entry, in decode order. Times in microseconds (WebCodecs' unit). */
export type Mp4Sample = { index: number; ptsUs: number; dtsUs: number; durationUs: number; key: boolean; offset: number; size: number };
export type Mp4Table = {
  codec: string;
  width: number;
  height: number;
  durationMs: number;
  /** The decoder configuration record (avcC, hvcC, vpcC or av1C body) for VideoDecoder.configure. */
  description: Uint8Array | null;
  /** Decode order. */
  samples: Mp4Sample[];
  /** Sample indexes sorted by presentation time. */
  byPts: number[];
};

const toUs = (t: number, timescale: number) => Math.round((t * 1_000_000) / timescale);

/** Reads the video track's sample table from a whole MP4 file (no decoding). Throws in plain English when there is none. */
export function readMp4Table(bytes: ArrayBuffer): Mp4Table {
  const file = createFile();
  let movie: Movie | null = null;
  let failure: string | null = null;
  file.onReady = (info) => {
    movie = info;
  };
  file.onError = (_module: string, message: string) => {
    failure = message;
  };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes, 0));
  file.flush();
  const info = movie as Movie | null;
  if (!info) throw new Error(`This file is not a readable MP4${failure ? ` (${failure})` : ""}.`);
  const track = info.videoTracks[0];
  if (!track) throw new Error("This MP4 has no video track.");
  const timescale = track.timescale;
  const raw = file.getTrackSamplesInfo(track.id);
  const samples: Mp4Sample[] = raw.map((s, index) => ({ index, ptsUs: toUs(s.cts, timescale), dtsUs: toUs(s.dts, timescale), durationUs: toUs(s.duration, timescale), key: s.is_sync, offset: s.offset, size: s.size }));
  const byPts = samples.map((s) => s.index).sort((a, b) => samples[a].ptsUs - samples[b].ptsUs);
  return {
    codec: track.codec,
    width: track.video?.width ?? track.track_width,
    height: track.video?.height ?? track.track_height,
    durationMs: Math.round((track.duration / timescale) * 1000) || Math.round((info.duration / info.timescale) * 1000),
    description: decoderDescription(file, track.id),
    samples,
    byPts,
  };
}

/** The codec configuration box's body (without its 8-byte header), as VideoDecoder wants it. */
function decoderDescription(file: ReturnType<typeof createFile>, trackId: number): Uint8Array | null {
  const trak = file.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const e = entry as unknown as Record<string, { write(stream: unknown): void } | undefined>;
    const box = e.avcC ?? e.hvcC ?? e.vpcC ?? e.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array((stream as unknown as { buffer: ArrayBuffer }).buffer, 8);
  }
  return null;
}

/** The frame shown at `tMs` (decode-order index): the last one whose presentation time is at or before it. */
export function frameIndexAt(table: Pick<Mp4Table, "samples" | "byPts">, tMs: number): number {
  const t = Math.max(0, tMs) * 1000;
  const { byPts, samples } = table;
  let lo = 0;
  let hi = byPts.length - 1;
  if (t <= samples[byPts[0]].ptsUs) return byPts[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[byPts[mid]].ptsUs <= t) lo = mid;
    else hi = mid - 1;
  }
  return byPts[lo];
}

/** The keyframe decoding must start from to show sample `index` (decode order). */
export function keyframeFor(samples: Mp4Sample[], index: number): number {
  for (let i = index; i >= 0; i--) if (samples[i].key) return i;
  return 0;
}

/**
 * What the decoder must do to show sample `target`, given the decode-order range already fed, [fedFrom, next).
 * Continue when the target is ahead in the same run and getting there costs at most a few samples more than starting
 * from its keyframe (so a source asked two nearby times in turn keeps its run and the frames it has), or when it is
 * already fed but not output yet; otherwise reset and start again from the target's keyframe (a seek back, or a jump
 * past whole keyframe intervals). `passed`: the decoder has already output a frame after the target's time, so the target came out
 * earlier and is no longer kept (the cache let it go): it never comes again in this run, so a new run is needed.
 */
export function planDecode(samples: Mp4Sample[], fed: { from: number; next: number } | null, target: number, passed = false): { reset: boolean; from: number } {
  const key = keyframeFor(samples, target);
  if (!fed || fed.next <= fed.from) return { reset: true, from: key };
  if (target >= fed.next && target - fed.next <= target - key + CONTINUE_SLACK) return { reset: false, from: fed.next };
  if (target >= fed.from && target < fed.next && key >= fed.from && !passed) return { reset: false, from: fed.next };
  return { reset: true, from: key };
}

/** Samples a run may decode past its target's keyframe rather than start again there (and lose its frames). */
const CONTINUE_SLACK = 6;

type Closable = { close(): void };
/**
 * A few decoded frames by presentation time. Over capacity the oldest frame before the kept time is closed; frames at
 * or after it (the frame being waited for or just handed out, and the ones after it) are never closed for room, so a
 * decoder that runs ahead cannot push out the frame asked for. Only past `hardLimit` is the frame furthest ahead
 * dropped (it is decoded again when it is needed).
 */
export class FrameCache<F extends Closable> {
  private frames = new Map<number, F>();
  // Infinity: nothing is kept (no request yet).
  private keepFrom = Infinity;
  constructor(
    readonly capacity = 8,
    readonly hardLimit = capacity * 8,
  ) {}
  get size(): number {
    return this.frames.size;
  }
  /** Keeps every frame at or after `ts` (the time being asked for); earlier ones may be closed for room. */
  keepAtOrAfter(ts: number): void {
    this.keepFrom = ts;
    this.trim();
  }
  put(ts: number, frame: F): void {
    const old = this.frames.get(ts);
    if (old && old !== frame) old.close();
    this.frames.delete(ts);
    this.frames.set(ts, frame);
    this.trim();
  }
  private trim(): void {
    while (this.frames.size > this.capacity) {
      let victim: number | null = null;
      for (const k of this.frames.keys()) {
        if (k < this.keepFrom) {
          victim = k;
          break;
        }
      }
      if (victim === null) {
        if (this.frames.size <= this.hardLimit) return;
        victim = Math.max(...this.frames.keys());
        if (victim <= this.keepFrom) return;
      }
      const f = this.frames.get(victim) as F;
      this.frames.delete(victim);
      f.close();
    }
  }
  get(ts: number): F | null {
    return this.frames.get(ts) ?? null;
  }
  /** The latest frame at or before `ts` (null when every kept frame is later). */
  atOrBefore(ts: number): F | null {
    let best: [number, F] | null = null;
    for (const e of this.frames) if (e[0] <= ts && (!best || e[0] > best[0])) best = e;
    return best ? best[1] : null;
  }
  /** Whether a frame at or after `ts` has arrived (decoders output in presentation order: then `ts` is in too). */
  reached(ts: number): boolean {
    for (const k of this.frames.keys()) if (k >= ts) return true;
    return false;
  }
  clear(): void {
    for (const f of this.frames.values()) f.close();
    this.frames.clear();
    this.keepFrom = Infinity;
  }
}

/** Samples fed past the target, so a decoder that reorders (B-frames) or holds a few frames can output the target. */
const LOOKAHEAD = 6;
/** How long without any output before a decoder counts as stalled (fed one more sample, or flushed at the end). */
const OUTPUT_WAIT_MS = 1500;
/** How often a waiting request looks at the decoder. */
const STEP_MS = 30;

/**
 * An MP4 opened for drawing (browser only). `frameAt(tMs)` gives the frame shown at that time; the frame belongs to
 * the source and stays valid until the next `frameAt` or `close` (do not close it yourself).
 */
export class VideoSource {
  private decoder: VideoDecoder | null = null;
  private cache = new FrameCache<VideoFrame>(8);
  private fed: { from: number; next: number } | null = null;
  private waiters: (() => void)[] = [];
  /** Frames output by the current decoder (0: it is still cold, its first frame takes a few hundred ms). */
  private outputs = 0;
  /**
   * The time of the frame the previous request handed out. It and the frames after it are kept too, so a caller that
   * alternates between two times (a transition draws the scene going out and the one coming in) never makes the cache
   * let go of the earlier one and the decoder start again for every frame.
   */
  private lastOut: number | null = null;
  private failure: Error | null = null;
  private closed = false;

  private constructor(
    readonly table: Mp4Table,
    private readonly bytes: ArrayBuffer,
  ) {}

  get width(): number {
    return this.table.width;
  }
  get height(): number {
    return this.table.height;
  }
  get durationMs(): number {
    return this.table.durationMs;
  }

  /** Downloads and reads the MP4; checks the browser can decode it. */
  static async open(url: string, fetchImpl: typeof fetch = fetch): Promise<VideoSource> {
    if (typeof VideoDecoder === "undefined") throw new Error("This browser cannot decode video here (WebCodecs is missing). Use a recent Chrome or Edge.");
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`The clip could not be loaded (${res.status}).`);
    const bytes = await res.arrayBuffer();
    const source = new VideoSource(readMp4Table(bytes), bytes);
    const support = await VideoDecoder.isConfigSupported(source.config());
    if (!support.supported) throw new Error(`This browser cannot decode this clip (${source.table.codec}).`);
    return source;
  }

  private config(): VideoDecoderConfig {
    return { codec: this.table.codec, codedWidth: this.table.width, codedHeight: this.table.height, ...(this.table.description ? { description: this.table.description } : {}), optimizeForLatency: true };
  }

  private restart(): void {
    this.decoder?.close();
    this.cache.clear();
    this.failure = null;
    this.outputs = 0;
    this.lastOut = null;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed) return frame.close();
        this.outputs += 1;
        this.cache.put(frame.timestamp, frame);
        for (const w of this.waiters.splice(0)) w();
      },
      error: (e) => {
        this.failure = e instanceof Error ? e : new Error(String(e));
        for (const w of this.waiters.splice(0)) w();
      },
    });
    this.decoder.configure(this.config());
  }

  private feed(i: number): void {
    const s = this.table.samples[i];
    (this.decoder as VideoDecoder).decode(new EncodedVideoChunk({ type: s.key ? "key" : "delta", timestamp: s.ptsUs, duration: s.durationUs, data: new Uint8Array(this.bytes, s.offset, s.size) }));
  }

  private waitOutput(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** The frame shown at `tMs` (clamped to the clip). */
  async frameAt(tMs: number): Promise<VideoFrame> {
    if (this.closed) throw new Error("The clip is closed.");
    const samples = this.table.samples;
    const target = frameIndexAt(this.table, tMs);
    const ts = samples[target].ptsUs;
    const hit = this.cache.get(ts);
    if (hit) return this.handOut(hit);
    // Not in the cache although a later frame has come out: the target was output before and let go (a seek back).
    const plan = planDecode(samples, this.fed, target, this.cache.reached(ts));
    if (plan.reset || !this.decoder) {
      this.restart();
      this.fed = { from: plan.from, next: plan.from };
    }
    const fed = this.fed as { from: number; next: number };
    // The target and everything after it (and the previous request's frame onward) stay while the decoder catches up.
    this.cache.keepAtOrAfter(Math.min(ts, this.lastOut ?? ts));
    const until = Math.min(samples.length, target + 1 + LOOKAHEAD);
    while (fed.next < until) this.feed(fed.next++);
    // Then wait for output. One more sample is fed only when a warm decoder is hungry (nothing queued, no output for a
    // step: it holds frames until it gets more input) or when it is stalled; a cold decoder, whose first frame takes a
    // few hundred ms, is not fed more meanwhile (it would run ahead of the frame asked for).
    let seen = this.outputs;
    let progressAt = Date.now();
    while (!this.cache.reached(ts) && !this.failure) {
      await this.waitOutput(STEP_MS);
      if (this.cache.reached(ts) || this.failure) break;
      const decoder = this.decoder as VideoDecoder;
      if (this.outputs !== seen) {
        seen = this.outputs;
        progressAt = Date.now();
        continue;
      }
      const stalled = Date.now() - progressAt > OUTPUT_WAIT_MS;
      const hungry = this.outputs > 0 && decoder.decodeQueueSize === 0;
      if (!hungry && !stalled) continue;
      if (fed.next < samples.length) {
        this.feed(fed.next++);
        progressAt = Date.now();
        continue;
      }
      // The end of the clip: flush out what the decoder holds. After a flush it needs a keyframe, so the next
      // request starts a new run.
      await Promise.race([decoder.flush(), this.waitOutput(OUTPUT_WAIT_MS)]);
      this.fed = null;
      break;
    }
    if (this.failure) throw new Error(`The clip could not be decoded: ${this.failure.message}`);
    const frame = this.cache.get(ts) ?? this.cache.atOrBefore(ts);
    if (!frame) throw new Error("The clip's frame did not decode in time.");
    return this.handOut(frame);
  }

  /** The frame handed out stays valid until the next request: frames still arriving cannot close it. */
  private handOut(frame: VideoFrame): VideoFrame {
    this.cache.keepAtOrAfter(Math.min(frame.timestamp, this.lastOut ?? frame.timestamp));
    this.lastOut = frame.timestamp;
    return frame;
  }

  close(): void {
    this.closed = true;
    this.cache.clear();
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.waiters.splice(0);
  }
}
