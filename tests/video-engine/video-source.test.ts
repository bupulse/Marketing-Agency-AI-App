import fs from "node:fs";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { describe, expect, it, vi } from "vitest";
import { FrameCache, VideoSource, frameIndexAt, keyframeFor, planDecode, readMp4Table, type Mp4Sample } from "@/lib/video-engine/video-source";

// A minimal avcC record (one SPS, one PPS): enough for mp4box to read the track; the frames are not real H.264.
const AVCC = new Uint8Array([1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x1f, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);

/** A 2-second, 30 fps MP4 with a keyframe every 15 frames; `reorder` adds B-frame-like presentation offsets. */
function tinyMp4(reorder = false): ArrayBuffer {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width: 320, height: 568 }, fastStart: "in-memory" });
  const frame = 1_000_000 / 30;
  for (let i = 0; i < 60; i++) {
    const key = i % 15 === 0;
    // With reorder, like B-frames: in each keyframe interval the odd frames (decode order) are shown after the next
    // one. Every time moves one frame later so no offset is negative. mp4-muxer takes the presentation time and the
    // offset to the decode time.
    const j = i % 15;
    const dts = i * frame;
    const pts = !reorder ? dts : j === 0 ? dts + frame : j % 2 === 1 ? dts + 2 * frame : dts;
    muxer.addVideoChunkRaw(new Uint8Array([i, i, i, i]), key ? "key" : "delta", Math.round(pts), Math.round(frame), i === 0 ? { decoderConfig: { codec: "avc1.64001f", codedWidth: 320, codedHeight: 568, description: AVCC } } : undefined, Math.round(pts - dts));
  }
  muxer.finalize();
  return target.buffer;
}

describe("reading an MP4's sample table", () => {
  it("gives the codec, size, length, keyframes, byte ranges and the decoder description", () => {
    const t = readMp4Table(tinyMp4());
    expect(t).toMatchObject({ codec: "avc1.64001f", width: 320, height: 568 });
    expect(t.durationMs).toBeGreaterThanOrEqual(1990);
    expect(t.durationMs).toBeLessThanOrEqual(2010);
    expect(t.samples).toHaveLength(60);
    expect(t.samples.filter((s) => s.key).map((s) => s.index)).toEqual([0, 15, 30, 45]);
    expect(t.samples[1]).toMatchObject({ size: 4, key: false });
    expect(t.samples[1].ptsUs).toBeCloseTo(33_333, -1);
    expect(Array.from(t.description ?? [])).toEqual(Array.from(AVCC));
    // The byte ranges point at each frame's own bytes.
    const bytes = new Uint8Array(tinyMp4());
    expect(Array.from(bytes.slice(t.samples[7].offset, t.samples[7].offset + t.samples[7].size))).toEqual([7, 7, 7, 7]);
  });

  it("refuses a file that is not an MP4, in plain words", () => {
    expect(() => readMp4Table(new TextEncoder().encode("not a video at all").buffer as ArrayBuffer)).toThrow(/not a readable MP4|no video track/);
  });

  const real = "/private/tmp/claude-502/-Users-macbook1-BuPulse-video/quality/loop5/motion/hypermotion.mp4";
  it.runIf(fs.existsSync(real))("reads a real H.264 clip made by the engine", () => {
    const b = fs.readFileSync(real);
    const t = readMp4Table(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(t.codec).toMatch(/^avc1\./);
    expect(t.samples.length).toBeGreaterThan(100);
    expect(t.samples[0].key).toBe(true);
    expect(t.description?.[0]).toBe(1); // avcC configurationVersion
  });
});

describe("timing", () => {
  it("finds the frame shown at a time, clamped to the clip", () => {
    const t = readMp4Table(tinyMp4());
    expect(frameIndexAt(t, 0)).toBe(0);
    expect(frameIndexAt(t, 34)).toBe(1);
    expect(frameIndexAt(t, 1000)).toBe(30);
    expect(frameIndexAt(t, -50)).toBe(0);
    expect(frameIndexAt(t, 99_999)).toBe(59);
  });

  it("follows presentation time, not decode order, when frames are reordered", () => {
    const t = readMp4Table(tinyMp4(true));
    const shown = t.byPts.map((i) => t.samples[i].ptsUs);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
    // Shown at 33, 67, 100 ms: samples 0, 2, 1 (decode order).
    expect(frameIndexAt(t, 40)).toBe(0);
    expect(frameIndexAt(t, 70)).toBe(2);
    expect(frameIndexAt(t, 101)).toBe(1);
    expect(t.byPts.slice(0, 3)).toEqual([0, 2, 1]);
  });

  it("decodes front to back from the keyframe, and restarts only on a seek back or a jump", () => {
    const samples = readMp4Table(tinyMp4()).samples as Mp4Sample[];
    expect(keyframeFor(samples, 20)).toBe(15);
    expect(planDecode(samples, null, 20)).toEqual({ reset: true, from: 15 });
    expect(planDecode(samples, { from: 15, next: 21 }, 25)).toEqual({ reset: false, from: 21 }); // ahead, same run
    expect(planDecode(samples, { from: 15, next: 30 }, 31)).toEqual({ reset: false, from: 30 }); // next keyframe is next
    expect(planDecode(samples, { from: 15, next: 21 }, 50)).toEqual({ reset: true, from: 45 }); // jump ahead
    expect(planDecode(samples, { from: 15, next: 21 }, 3)).toEqual({ reset: true, from: 0 }); // seek back
  });
});

describe("the frame cache", () => {
  const frame = () => ({ close: vi.fn() });

  it("keeps a few frames and closes the oldest", () => {
    const cache = new FrameCache(2);
    const [a, b, c] = [frame(), frame(), frame()];
    cache.put(0, a);
    cache.put(33, b);
    cache.put(66, c);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
    expect(cache.get(0)).toBeNull();
    expect(cache.atOrBefore(50)).toBe(b);
    expect(cache.atOrBefore(10)).toBeNull();
    expect(cache.reached(66)).toBe(true);
    expect(cache.reached(67)).toBe(false);
    cache.clear();
    expect(b.close).toHaveBeenCalled();
    expect(c.close).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it("replacing a frame at the same time closes the old one", () => {
    const cache = new FrameCache(4);
    const [a, b] = [frame(), frame()];
    cache.put(0, a);
    cache.put(0, b);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(cache.get(0)).toBe(b);
  });
});

/**
 * A stand-in for WebCodecs' VideoDecoder that behaves like a cold hardware decoder: its first frame comes `coldMs` after
 * configure, then it outputs everything it holds in one burst, in presentation order (as Chrome's decoder did with a
 * real 1080p clip). Its queue is always reported empty (hardware takes the samples at once), the case that fed the old
 * source a dozen frames ahead and pushed the frame asked for out of its 8-frame cache.
 */
class ColdDecoder {
  static coldMs = 260;
  static isConfigSupported = async () => ({ supported: true });
  static frames: { timestamp: number; closed: boolean; close(): void }[] = [];
  state = "unconfigured";
  decodeQueueSize = 0;
  private pending: number[] = [];
  private readyAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly init: { output: (f: unknown) => void; error: (e: unknown) => void }) {}
  configure() {
    this.state = "configured";
    this.readyAt = Date.now() + ColdDecoder.coldMs;
  }
  decode(chunk: { timestamp: number }) {
    this.pending.push(chunk.timestamp);
    this.pending.sort((a, b) => a - b);
    this.pump();
  }
  private pump() {
    if (this.timer || this.state === "closed") return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state === "closed") return;
      for (const timestamp of this.pending.splice(0)) {
        const frame = { timestamp, closed: false, close() { this.closed = true; } };
        ColdDecoder.frames.push(frame);
        this.init.output(frame);
      }
    }, Math.max(1, this.readyAt - Date.now()));
  }
  async flush() {
    while (this.pending.length) await new Promise((r) => setTimeout(r, 5));
  }
  close() {
    this.state = "closed";
  }
}

describe("decoding a clip for drawing (a cold decoder)", () => {
  it("never closes the frame asked for while a slow first frame lets samples pile up, and does not flood the decoder", async () => {
    vi.stubGlobal("VideoDecoder", ColdDecoder);
    vi.stubGlobal("EncodedVideoChunk", class { timestamp: number; constructor(init: { timestamp: number }) { this.timestamp = init.timestamp; } });
    ColdDecoder.frames = [];
    const bytes = tinyMp4();
    const source = await VideoSource.open("https://x.test/clip.mp4", (async () => new Response(bytes)) as unknown as typeof fetch);
    const table = readMp4Table(bytes);
    try {
      // An encode's requests: every output frame of the first second (30 fps), with a transition's earlier time asked
      // for between them (the scene going out), as a 3-scene overlay does.
      for (let i = 0; i < 30; i++) {
        const t = (i * 1000) / 30;
        const frame = (await source.frameAt(t)) as unknown as { timestamp: number; closed: boolean };
        expect(frame.closed, `frame at ${Math.round(t)} ms`).toBe(false);
        expect(frame.timestamp).toBe(table.samples[frameIndexAt(table, t)].ptsUs);
      }
      // The cold start fed no more than the lookahead: the decoder did not run a dozen frames ahead of the first one.
      expect(ColdDecoder.frames.filter((f) => f.timestamp <= 400_000).length).toBeLessThanOrEqual(13);
    } finally {
      source.close();
      vi.unstubAllGlobals();
    }
  }, 20_000);

  it("the cache keeps the frame asked for and the ones after it, whatever its capacity", () => {
    const closed: number[] = [];
    const frame = (ts: number) => ({ ts, close: () => closed.push(ts) });
    const cache = new FrameCache<ReturnType<typeof frame>>(2, 6);
    cache.keepAtOrAfter(10);
    for (const ts of [0, 5, 10, 11, 12, 13]) cache.put(ts, frame(ts));
    // Room is made from the frames before 10 only.
    expect(closed).toEqual([0, 5]);
    expect(cache.get(10)).not.toBeNull();
    // Past the hard limit the frame furthest ahead goes, never the one asked for.
    for (const ts of [14, 15, 16]) cache.put(ts, frame(ts));
    expect(cache.get(10)).not.toBeNull();
    expect(cache.size).toBeLessThanOrEqual(6);
  });
});
