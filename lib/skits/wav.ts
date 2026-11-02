// WAV encoding for the voice notes: the browser decodes what it recorded (WebM/Opus, MP4) or the picked file (a WhatsApp
// .ogg/.opus, an iPhone .m4a) and sends 16 kHz mono 16-bit WAV, which every video engine takes (Seedance's reference
// audio is MP3 or WAV). A 15 s note is about 480 KB. Pure, so the tests check the bytes.

export const WAV_SAMPLE_RATE = 16_000;

/** 16-bit PCM WAV bytes of mono samples in -1..1. */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** The channels averaged into one. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** Leading and trailing near-silence cut off (a recording often starts with a second of nothing), with a little kept. */
export function trimSilence(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE, threshold = 0.02, keepSeconds = 0.15): Float32Array {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--;
  if (end <= start) return samples;
  const keep = Math.round(keepSeconds * sampleRate);
  return samples.subarray(Math.max(0, start - keep), Math.min(samples.length, end + keep));
}
