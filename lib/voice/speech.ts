// Voiceover maths (docs/VOICE_AND_MUSIC.md), pure and unit tested: what is spoken (one sentence per scene, from the
// captions, which carry no scene directions), when each sentence is spoken (from the provider's character timings),
// how the scenes are timed so captions follow the voice, and how loud the music is under it.
import { scriptLines } from "@/lib/visuals/video-plan";
import { totalDuration } from "@/lib/visuals/timeline";
import { VIDEO_LIMITS, type VideoPlan } from "@/lib/visuals/types";

/** Speech this long fits a video with a short tail; longer is shortened first. */
export const MAX_SPEECH_MS = VIDEO_LIMITS.maxMs - 1200;
/** Quiet time after the last word before the video ends. */
export const VOICE_TAIL_MS = 900;
/** About 15 characters a second for a clear advertising voice. */
export const MS_PER_CHAR = 66;

export type Timing = { startMs: number; endMs: number };

/** A caption as a sentence to speak: trimmed, with a full stop when it has no end mark. */
function sentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t && !/[.!?…]$/.test(t) ? `${t}.` : t;
}

/** The spoken lines of a video plan: its scene captions (scriptLines already removed timestamps and directions). */
export function spokenLines(plan: Pick<VideoPlan, "scenes">): string[] {
  return plan.scenes.map((s) => sentence(scriptLines(s.text).join(" ") || s.text));
}

/** The text sent to the voice, and where each line starts and ends in it. */
export function speechText(lines: readonly string[]): { text: string; ranges: { from: number; to: number }[] } {
  const ranges: { from: number; to: number }[] = [];
  let text = "";
  for (const line of lines) {
    if (text) text += " ";
    ranges.push({ from: text.length, to: text.length + line.length });
    text += line;
  }
  return { text, ranges };
}

export function estimateSpeechMs(text: string): number {
  return text.length * MS_PER_CHAR;
}

/** When each line is spoken, from the provider's per-character start and end times. */
export function lineTimings(ranges: readonly { from: number; to: number }[], charStartsMs: readonly number[], charEndsMs: readonly number[]): Timing[] {
  const last = charEndsMs.length - 1;
  return ranges.map((r) => {
    const from = Math.min(r.from, last);
    const to = Math.min(Math.max(r.to - 1, r.from), last);
    return { startMs: charStartsMs[from] ?? 0, endMs: charEndsMs[to] ?? charEndsMs[last] ?? 0 };
  });
}

/**
 * Times the scenes to the voice: scene i's caption shows while line i is spoken (a scene starts one crossfade before
 * its line, so the photo has faded in when the words begin), and the video ends a moment after the last word.
 * Returns null when the voice does not fit 30 seconds.
 */
export function fitPlanToVoice(plan: VideoPlan, timings: readonly Timing[], voiceMs: number): VideoPlan | null {
  if (timings.length !== plan.scenes.length || timings.length === 0) return null;
  const end = Math.max(voiceMs, timings[timings.length - 1].endMs) + VOICE_TAIL_MS;
  if (end > VIDEO_LIMITS.maxMs) return null;
  const cf = plan.crossfadeMs;
  const starts = timings.map((t, i) => (i === 0 ? 0 : Math.max(0, t.startMs - cf)));
  const scenes = plan.scenes.map((s, i) => {
    const next = i < starts.length - 1 ? starts[i + 1] : end;
    const durationMs = Math.max(cf * 2 + 200, Math.round(next - starts[i] + (i < starts.length - 1 ? cf : 0)));
    return { ...s, durationMs };
  });
  const totalMs = Math.max(VIDEO_LIMITS.minMs, totalDuration(scenes, cf));
  // A very short voice still makes a 10-second video: the last scene holds.
  if (totalMs > totalDuration(scenes, cf)) scenes[scenes.length - 1].durationMs += totalMs - totalDuration(scenes, cf);
  return totalMs > VIDEO_LIMITS.maxMs ? null : { ...plan, scenes, totalMs };
}

/** Music level: alone, under speech (about 22%: owner decision 20 to 25%), and the fades. */
export const MUSIC_LEVEL = { alone: 0.85, underSpeech: 0.2, fadeInMs: 1000, fadeOutMs: 1500, duckRampMs: 250 } as const;

/**
 * The music's gain over time, as points to ramp between: a fade in, ducked under every spoken stretch (lines closer
 * than half a second count as one stretch), back up between them, and a fade out at the end. Sorted, deduplicated.
 */
export function musicEnvelope(totalMs: number, speech: readonly Timing[], level = MUSIC_LEVEL): { tMs: number; gain: number }[] {
  const stretches: Timing[] = [];
  for (const t of [...speech].sort((a, b) => a.startMs - b.startMs)) {
    const last = stretches[stretches.length - 1];
    if (last && t.startMs - last.endMs < 500) last.endMs = Math.max(last.endMs, t.endMs);
    else stretches.push({ ...t });
  }
  const ramp = level.duckRampMs;
  const points: { tMs: number; gain: number }[] = [{ tMs: 0, gain: 0 }];
  const up = (t: number) => (t < level.fadeInMs ? level.alone * (t / level.fadeInMs) : level.alone);
  if (stretches.length === 0 || stretches[0].startMs - ramp > level.fadeInMs) points.push({ tMs: Math.min(level.fadeInMs, totalMs), gain: level.alone });
  for (const s of stretches) {
    const from = Math.max(0, s.startMs - ramp);
    points.push({ tMs: from, gain: s.startMs - ramp <= 0 ? level.underSpeech : up(from) });
    points.push({ tMs: Math.max(from, s.startMs), gain: level.underSpeech });
    points.push({ tMs: s.endMs, gain: level.underSpeech });
    points.push({ tMs: Math.min(totalMs, s.endMs + ramp), gain: up(s.endMs + ramp) });
  }
  const fadeStart = Math.max(0, totalMs - level.fadeOutMs);
  const kept = points.filter((p) => p.tMs <= fadeStart);
  const before = [...points].reverse().find((p) => p.tMs <= fadeStart);
  kept.push({ tMs: fadeStart, gain: before?.gain ?? level.alone }, { tMs: totalMs, gain: 0 });
  const out: { tMs: number; gain: number }[] = [];
  for (const p of kept.sort((a, b) => a.tMs - b.tMs)) {
    if (out.length && out[out.length - 1].tMs === p.tMs) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** The music's gain at one moment, by straight lines between the envelope's points. */
export function gainAt(points: readonly { tMs: number; gain: number }[], tMs: number): number {
  if (points.length === 0) return 0;
  if (tMs <= points[0].tMs) return points[0].gain;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (tMs <= b.tMs) return b.tMs === a.tMs ? b.gain : a.gain + ((b.gain - a.gain) * (tMs - a.tMs)) / (b.tMs - a.tMs);
  }
  return points[points.length - 1].gain;
}
