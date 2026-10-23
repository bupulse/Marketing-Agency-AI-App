// The music's beat for the reel's edits (docs/REEL_ENGINE.md): the music library has no tempo for its tracks, so the
// browser finds it from the sound itself before it joins the reel. Pure maths on the samples (an onset curve, its
// autocorrelation for the tempo, then the phase), so it is tested on made-up click tracks.
import type { MusicBeat } from "./story";

const HOP = 512;

/** The beat of up to the first 30 seconds of a mono track: seconds between beats (70 to 170 BPM) and the first beat. */
export function findBeat(samples: Float32Array, sampleRate: number): MusicBeat {
  const frames = Math.min(Math.floor(samples.length / HOP), Math.floor((30 * sampleRate) / HOP));
  if (frames < 64) return null;
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += samples[i] * samples[i];
    energy[f] = Math.sqrt(sum / HOP);
  }
  // How much louder each frame got: drums and plucks stand out, a held note does not.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  const mean = onset.reduce((s, v) => s + v, 0) / frames;
  if (!(mean > 0)) return null;

  const secPerFrame = HOP / sampleRate;
  const minLag = Math.max(2, Math.floor(60 / 170 / secPerFrame));
  const maxLag = Math.ceil(60 / 70 / secPerFrame);
  const scores = new Map<number, number>();
  let best = { lag: 0, score: 0 };
  for (let lag = minLag; lag <= maxLag && lag < frames / 2; lag++) {
    let sum = 0;
    // A frame either side counts too: a beat between two frames would otherwise favour twice its length.
    for (let f = lag + 1; f < frames; f++) sum += onset[f] * Math.max(onset[f - lag], 0.7 * onset[f - lag - 1], 0.7 * (onset[f - lag + 1] ?? 0));
    const bpm = 60 / (lag * secPerFrame);
    // A gentle preference for the tempos dance and pop music sit at, so a half or double tempo does not win by a hair.
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = (sum / (frames - lag)) * weight;
    scores.set(lag, score);
    if (score > best.score) best = { lag, score };
  }
  if (!best.lag) return null;
  // The beat rarely falls on a whole number of frames: the peak between the best lag and its neighbours, so the beats
  // do not drift over 30 seconds.
  const before = scores.get(best.lag - 1) ?? 0;
  const after = scores.get(best.lag + 1) ?? 0;
  const bend = before - 2 * best.score + after;
  const lag = best.lag + (bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / bend)) : 0);
  let phase = { at: 0, score: -1 };
  for (let p = 0; p < lag; p += 0.25) {
    let sum = 0;
    for (let t = p; t < frames; t += lag) {
      const f = Math.round(t);
      sum += Math.max(onset[f] ?? 0, 0.5 * (onset[f - 1] ?? 0), 0.5 * (onset[f + 1] ?? 0));
    }
    if (sum > phase.score) phase = { at: p, score: sum };
  }
  return { period: lag * secPerFrame, offset: phase.at * secPerFrame };
}

/** In the browser: the beat of the reel's music track, or null when it cannot be read (the edits then use plain times). */
export async function beatOfTrack(url: string | null): Promise<MusicBeat> {
  if (!url || typeof window === "undefined") return null;
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(data);
    void ctx.close();
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
    return findBeat(mono, audio.sampleRate);
  } catch {
    return null;
  }
}
