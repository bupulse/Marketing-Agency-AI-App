import { describe, expect, it } from "vitest";
import { mixSamples } from "@/lib/voice/mix";
import { estimateSpeechMs, fitPlanToVoice, gainAt, lineTimings, MUSIC_LEVEL, musicEnvelope, speechText, spokenLines } from "@/lib/voice/speech";
import { captionAlphas, sceneStarts, totalDuration } from "@/lib/visuals/timeline";
import { buildVideoPlan } from "@/lib/visuals/video-plan";
import { VIDEO_LIMITS } from "@/lib/visuals/types";

const plan = () =>
  buildVideoPlan({ script: "[0-3s] Hook: Tired of slow phones?\n(Close-up of the phone)\nVO: Meet the Aero, fast all day.\nCTA: Visit us in Kigali!", hook: "Tired of slow phones?", businessName: "Kigali Phones", photos: ["u/gallery/a.jpg"], pack: "clean" });

describe("what is spoken", () => {
  it("one sentence per scene, from the captions: no timestamps, labels or stage directions, each with an end mark", () => {
    const lines = spokenLines(plan());
    expect(lines).toEqual(["Tired of slow phones?", "Meet the Aero, fast all day.", "Visit us in Kigali!", "Kigali Phones."]);
    const { text, ranges } = speechText(lines);
    expect(text).toBe("Tired of slow phones? Meet the Aero, fast all day. Visit us in Kigali! Kigali Phones.");
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual(lines);
    expect(estimateSpeechMs(text)).toBeGreaterThan(4000);
  });
});

describe("timing scenes to the voice", () => {
  const p = plan();
  const { text, ranges } = speechText(spokenLines(p));
  // A fake voice: 70 ms per character, with a 300 ms pause after each line.
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    starts.push(t);
    t += 70;
    ends.push(t);
    if (ranges.some((r) => r.to === i + 1)) t += 300;
  }
  const timings = lineTimings(ranges, starts, ends);

  it("knows when each line starts and ends", () => {
    expect(timings[0]).toEqual({ startMs: 0, endMs: 21 * 70 });
    expect(timings[1].startMs).toBe(timings[0].endMs + 300 + 70); // the space after the pause
    expect(timings.at(-1)!.endMs).toBe(ends.at(-1));
  });

  it("each caption shows while its line is spoken; the video ends shortly after the last word, within 10-30 s", () => {
    const fitted = fitPlanToVoice(p, timings, ends.at(-1)!)!;
    expect(fitted).not.toBeNull();
    expect(fitted.totalMs).toBe(totalDuration(fitted.scenes, fitted.crossfadeMs));
    expect(fitted.totalMs).toBeGreaterThanOrEqual(VIDEO_LIMITS.minMs);
    expect(fitted.totalMs).toBeLessThanOrEqual(VIDEO_LIMITS.maxMs);
    const sceneStart = sceneStarts(fitted);
    for (let i = 1; i < timings.length; i++) {
      // The scene's caption appears when its line starts.
      expect(sceneStart[i] + fitted.crossfadeMs).toBe(timings[i].startMs);
      const mid = (timings[i].startMs + timings[i].endMs) / 2;
      expect(captionAlphas(fitted, mid).findIndex((a) => a === 1)).toBe(i);
    }
  });

  it("a voice longer than 30 seconds does not fit (the service shortens the lines first)", () => {
    expect(fitPlanToVoice(p, timings.map((x) => ({ startMs: x.startMs * 3, endMs: x.endMs * 3 })), 31_000)).toBeNull();
    expect(fitPlanToVoice(p, timings.slice(1), 9000)).toBeNull(); // lines and scenes must match
  });
});

describe("music under the voice", () => {
  const speech = [{ startMs: 2000, endMs: 5000 }, { startMs: 5200, endMs: 8000 }, { startMs: 12_000, endMs: 14_000 }];
  const env = musicEnvelope(20_000, speech);

  it("fades in, ducks to about a fifth under speech, comes back up between lines, fades out", () => {
    expect(gainAt(env, 0)).toBe(0);
    expect(gainAt(env, 1000)).toBeCloseTo(MUSIC_LEVEL.alone);
    expect(gainAt(env, 3000)).toBeCloseTo(0.2);
    expect(gainAt(env, 5100)).toBeCloseTo(0.2); // a 200 ms gap is one stretch: no pumping
    expect(gainAt(env, 10_000)).toBeCloseTo(MUSIC_LEVEL.alone);
    expect(gainAt(env, 13_000)).toBeCloseTo(0.2);
    expect(gainAt(env, 20_000)).toBe(0);
    expect(gainAt(env, 19_250)).toBeGreaterThan(0);
    expect(gainAt(env, 19_250)).toBeLessThan(MUSIC_LEVEL.alone);
    expect(MUSIC_LEVEL.underSpeech).toBeGreaterThanOrEqual(0.2);
    expect(MUSIC_LEVEL.underSpeech).toBeLessThanOrEqual(0.25);
    expect(env.map((p) => p.tMs)).toEqual([...env.map((p) => p.tMs)].sort((a, b) => a - b));
  });

  it("without a voice the music just fades in and out", () => {
    const alone = musicEnvelope(10_000, []);
    expect(gainAt(alone, 5000)).toBeCloseTo(MUSIC_LEVEL.alone);
    expect(gainAt(alone, 10_000)).toBe(0);
  });

  it("mixes the voice at full level over the ducked, looped music, clipped to [-1, 1]", () => {
    const rate = 1000; // 1 sample per ms keeps the arithmetic readable
    const voice = [new Float32Array(20_000).fill(0)];
    for (let i = 2000; i < 5000; i++) voice[0][i] = 0.5;
    const music = [new Float32Array(1000).fill(0.4), new Float32Array(1000).fill(0.4)];
    const out = mixSamples({ voice, music, sampleRate: rate, totalMs: 20_000, speech })!;
    expect(out).toHaveLength(2);
    expect(out[0][3000]).toBeCloseTo(0.5 + 0.4 * 0.2, 2); // voice + ducked music (looped from a 1 s track)
    expect(out[1][10_000]).toBeCloseTo(0.4 * MUSIC_LEVEL.alone, 2);
    const loud = mixSamples({ voice: [new Float32Array(100).fill(0.95)], music: [new Float32Array(100).fill(0.9)], sampleRate: rate, totalMs: 100, speech: [] })!;
    expect(Math.max(...loud[0])).toBeLessThanOrEqual(1);
    expect(mixSamples({ voice: null, music: null, sampleRate: rate, totalMs: 1000, speech: [] })).toBeNull();
    // A mono voice alone stays mono.
    expect(mixSamples({ voice: [new Float32Array(10)], music: null, sampleRate: rate, totalMs: 10, speech: [] })).toHaveLength(1);
  });
});
