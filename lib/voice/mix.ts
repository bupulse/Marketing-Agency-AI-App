// The soundtrack of a video (docs/VOICE_AND_MUSIC.md): the voiceover at full level and the music under it, ducked while
// someone speaks (lib/voice/speech.ts musicEnvelope). Plain sample maths, pure, so the browser and the video robot mix
// exactly the same way and the tests can check it.
import { gainAt, musicEnvelope, type Timing } from "./speech";

export interface MixInput {
  /** Decoded channels at `sampleRate`; the voice starts at 0. */
  voice?: Float32Array[] | null;
  /** Decoded music channels at `sampleRate`; looped when shorter than the video. */
  music?: Float32Array[] | null;
  sampleRate: number;
  totalMs: number;
  /** When the voice speaks (for ducking the music). */
  speech: readonly Timing[];
}

/** Stereo (or mono when both sources are mono) samples of the whole video, clipped to [-1, 1]. Null when silent. */
export function mixSamples({ voice, music, sampleRate, totalMs, speech }: MixInput): Float32Array[] | null {
  if (!voice?.length && !music?.length) return null;
  const frames = Math.max(1, Math.round((totalMs / 1000) * sampleRate));
  const channels = Math.max(voice?.length ?? 1, music?.length ?? 1) >= 2 ? 2 : 1;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const envelope = music?.length ? musicEnvelope(totalMs, voice?.length ? speech : []) : [];
  // The envelope is evaluated every 10 ms and held in between (the ramps are 250 ms or longer).
  const step = Math.max(1, Math.round(sampleRate / 100));
  for (let c = 0; c < channels; c++) {
    const v = voice?.length ? voice[Math.min(c, voice.length - 1)] : null;
    const m = music?.length ? music[Math.min(c, music.length - 1)] : null;
    const o = out[c];
    let gain = 0;
    for (let i = 0; i < frames; i++) {
      if (m && i % step === 0) gain = gainAt(envelope, (i / sampleRate) * 1000);
      let s = v && i < v.length ? v[i] : 0;
      if (m && m.length) s += m[i % m.length] * gain;
      o[i] = s > 1 ? 1 : s < -1 ? -1 : s;
    }
  }
  return out;
}
