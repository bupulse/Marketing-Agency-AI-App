// Raw speech audio helpers (docs/VOICE_AND_MUSIC.md, "Voice providers"), pure and unit tested. Gemini text-to-speech
// answers raw 16-bit PCM (24 kHz, mono) and no character timings, while the video needs a playable file and to know
// when each caption is spoken (lib/voice/speech.ts lineTimings). So: the PCM is wrapped as a WAV file (every browser and
// the video robot's Chrome decode it), and the character timings are estimated from the text and the pauses heard in
// the audio: characters share the speech by weight (a comma or a full stop is a short pause), and each sentence end is
// pinned to the silence nearest to where it was expected, so captions change when the voice really pauses.

/** A WAV file (PCM, little-endian) around raw samples. */
export function wavFromPcm(pcm: Uint8Array, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  const blockAlign = (channels * bitsPerSample) / 8;
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  text(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * The samples and rate of a 16-bit WAV file (Gemini's unary answers are WAV in the current docs, raw PCM in older
 * models); null when the bytes are not a WAV file, so the caller treats them as raw PCM.
 */
export function pcmFromWav(bytes: Uint8Array): { pcm: Uint8Array; sampleRate: number } | null {
  const ascii = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 44 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate = 24_000;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = ascii(o);
    const size = view.getUint32(o + 4, true);
    if (id === "fmt ") sampleRate = view.getUint32(o + 12, true);
    if (id === "data") return { pcm: bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size)), sampleRate };
    o += 8 + size + (size % 2);
  }
  return null;
}

/** The sample rate in a PCM mime type such as "audio/L16;codec=pcm;rate=24000" (24 kHz when it does not say). */
export function pcmRate(mimeType: string | null | undefined): number {
  const m = /rate=(\d{4,6})/.exec(mimeType ?? "");
  return m ? Number(m[1]) : 24_000;
}

export type Gap = { startMs: number; endMs: number };

/**
 * Loudness every 10 ms of 16-bit mono PCM, and the quiet stretches of at least `minMs`: where the voice pauses.
 * Also the first and last loud moments (speech start and end).
 */
export function speechShape(pcm: Uint8Array, sampleRate: number, minMs = 160): { gaps: Gap[]; startMs: number; endMs: number; durationMs: number } {
  const samples = Math.floor(pcm.length / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  const frame = Math.max(1, Math.round(sampleRate / 100));
  const frames = Math.ceil(samples / frame);
  const rms: number[] = [];
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const end = Math.min(samples, (f + 1) * frame);
    for (let i = f * frame; i < end; i++) {
      const v = view.getInt16(i * 2, true) / 32768;
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / Math.max(1, end - f * frame)));
  }
  const durationMs = Math.round((samples / sampleRate) * 1000);
  const peak = Math.max(0, ...rms);
  if (peak === 0) return { gaps: [], startMs: 0, endMs: durationMs, durationMs };
  // Quiet: under 6% of the loudest 10 ms (about -24 dB), which leaves breaths and room tone out of the speech.
  const quiet = rms.map((r) => r < peak * 0.06);
  const first = quiet.indexOf(false);
  const last = quiet.lastIndexOf(false);
  const gaps: Gap[] = [];
  let runStart = -1;
  for (let f = first; f <= last + 1; f++) {
    if (f <= last && quiet[f]) {
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      if ((f - runStart) * 10 >= minMs) gaps.push({ startMs: runStart * 10, endMs: f * 10 });
      runStart = -1;
    }
  }
  return { gaps, startMs: first * 10, endMs: (last + 1) * 10, durationMs };
}

const weight = (c: string): number => (/[.!?…]/.test(c) ? 6 : /[,;:]/.test(c) ? 3 : /\s/.test(c) ? 0.6 : 1);

/**
 * Start and end of each character of `text` in the audio, estimated: the speech (from its first to its last loud
 * moment) is shared by character weight, then every sentence end is pinned to a pause near it (within 900 ms) and the
 * characters between two pins are spread again. Good enough for captions that change with each spoken line.
 */
export function estimateCharTimings(text: string, shape: { gaps: Gap[]; startMs: number; endMs: number }): { starts: number[]; ends: number[] } {
  const chars = [...text];
  const n = chars.length;
  if (n === 0) return { starts: [], ends: [] };
  // Anchors: character index -> time (the end of that character). Speech start before 0, speech end after the last.
  const anchors: { index: number; ms: number }[] = [{ index: -1, ms: shape.startMs }];
  const weights = chars.map(weight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(1, shape.endMs - shape.startMs);
  let acc = 0;
  const free = [...shape.gaps];
  for (let i = 0; i < n; i++) {
    acc += weights[i];
    if (!/[.!?…]/.test(chars[i]) || i === n - 1 || /[.!?…]/.test(chars[i + 1] ?? "")) continue;
    const expected = shape.startMs + (acc / total) * span;
    let best = -1;
    for (let g = 0; g < free.length; g++) {
      const mid = (free[g].startMs + free[g].endMs) / 2;
      if (Math.abs(mid - expected) <= 900 && (best < 0 || Math.abs(mid - expected) < Math.abs((free[best].startMs + free[best].endMs) / 2 - expected))) best = g;
    }
    if (best < 0) continue;
    const gap = free[best];
    // The sentence ends when the pause starts; only later pauses stay usable (the order of sentences is kept).
    if (gap.startMs <= anchors[anchors.length - 1].ms) continue;
    anchors.push({ index: i, ms: gap.startMs });
    free.splice(0, best + 1);
  }
  anchors.push({ index: n - 1, ms: shape.endMs });
  const starts = new Array<number>(n);
  const ends = new Array<number>(n);
  for (let a = 1; a < anchors.length; a++) {
    const from = anchors[a - 1];
    const to = anchors[a];
    // Characters from.index+1 .. to.index fill the time between the two anchors, by weight; the spaces right after a
    // pinned sentence end take no time (the pause already is that space).
    let lead = from.index + 1;
    if (a > 1) while (lead <= to.index && /\s/.test(chars[lead])) weights[lead++] = 0;
    let w = 0;
    for (let i = from.index + 1; i <= to.index; i++) w += weights[i];
    let t = from.ms;
    // After a pinned sentence end, the next sentence starts when the pause ends.
    if (a > 1) {
      const gap = shape.gaps.find((g) => g.startMs === from.ms);
      if (gap && gap.endMs < to.ms) t = gap.endMs;
    }
    const room = Math.max(0, to.ms - t);
    for (let i = from.index + 1; i <= to.index; i++) {
      starts[i] = Math.round(t);
      t += w > 0 ? (weights[i] / w) * room : 0;
      ends[i] = Math.round(t);
    }
  }
  return { starts, ends };
}
