// Voice-over for the Claude video engine (docs/VIDEO_ENGINE.md, "Voice-over"). The scenes' `say` lines are spoken in
// one ElevenLabs take (eleven_multilingual_v2, "with timestamps": the time of every character), cut into one cue per
// scene, and the scenes are stretched so each lasts at least its line. In the browser, encode.ts places each cue at its
// scene and mixes the music under it, ducked while someone speaks (lib/voice/mix.ts).
// No "server-only" and no app services, so the Video Lab's server can use it (lib/ai/tts.ts cannot be bundled there);
// speakSpec takes the API key and runs on the server only. Everything else is pure and shared with the browser.
import { lineTimings, speechText } from "@/lib/voice/speech";
import { DEFAULT_VOICE_ID } from "@/lib/voice/voices";
import { SPEC_LIMITS, type MotionSpec } from "./spec";

export { SPOKEN_LANGUAGES, looksKinyarwanda, voiceLanguage, type VoiceLanguage } from "./voice-language";

export const VOICE_MODEL = "eleven_multilingual_v2";
/** ElevenLabs list price for this model, per 1,000 characters (the lab's ledger uses it). */
export const VOICE_USD_PER_1000_CHARS = 0.3;
/** At most this many characters in one voice-over (about 40 seconds of speech): later lines are left out. */
export const MAX_VOICE_CHARS = 600;
const API = "https://api.elevenlabs.io/v1";

/** How the voice sits in a scene: it starts a moment after the scene does and leaves a breath before the next one. */
export const VOICE_TIMING = { leadMs: 250, firstLeadMs: 150, tailMs: 300, endTailMs: 700, gapMs: 120 } as const;

export type VoiceLine = { scene: number; text: string };
/** A line as spoken in the take: when it starts and ends, in milliseconds from the start of the MP3. */
export type SpokenLine = VoiceLine & { startMs: number; endMs: number };
/** Play the take from `fromMs` to `toMs` at `atMs` of the video (scene `scene`). */
export type VoiceCue = { scene: number; fromMs: number; toMs: number; atMs: number };

export type SpecVoice = { audio: Uint8Array; mimeType: "audio/mpeg"; durationMs: number; characters: number; voiceId: string; model: string; lines: SpokenLine[]; costUsd: number };

export class VoiceError extends Error {
  /** True when ElevenLabs may have spoken (and charged) the characters although no answer came back. */
  constructor(message: string, readonly maybeCharged = false) {
    super(message);
    this.name = "VoiceError";
  }
}

/** A line as a sentence to speak: spaces collapsed, with a full stop when it has no end mark. */
function sentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t && !/[.!?…]$/.test(t) ? `${t}.` : t;
}

/** The lines to speak, one per scene that has a `say` line, in order, within MAX_VOICE_CHARS. */
export function voiceLines(spec: Pick<MotionSpec, "scenes">): VoiceLine[] {
  const out: VoiceLine[] = [];
  let used = 0;
  spec.scenes.forEach((s, scene) => {
    const text = sentence(s.say ?? "");
    if (!text) return;
    used += text.length + (out.length ? 1 : 0);
    if (used > MAX_VOICE_CHARS) return;
    out.push({ scene, text });
  });
  return out;
}

/** The text sent to the voice and where each line sits in it. */
export const voiceScript = (lines: readonly VoiceLine[]) => speechText(lines.map((l) => l.text));

export const voiceCostUsd = (characters: number) => Math.round(characters * VOICE_USD_PER_1000_CHARS * 1000) / 1_000_000;

const decodeBase64 = (b64: string): Uint8Array => {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

type Alignment = { character_start_times_seconds?: number[]; character_end_times_seconds?: number[] };

/**
 * Speaks every `say` line of the spec in one take. Null when the spec has no lines. Only the HTTP status is kept on
 * errors (the answer may echo the request; the key is never logged).
 */
export async function speakSpec(spec: Pick<MotionSpec, "scenes">, opts: { apiKey: string; voiceId?: string; model?: string; fetchImpl?: typeof fetch }): Promise<SpecVoice | null> {
  const lines = voiceLines(spec);
  if (lines.length === 0) return null;
  const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
  const model = opts.model || VOICE_MODEL;
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) throw new VoiceError("Unknown voice.");
  if (!opts.apiKey) throw new VoiceError("ElevenLabs is not set up (ELEVENLABS_API_KEY).");
  const { text, ranges } = voiceScript(lines);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": opts.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new VoiceError("The voice service did not answer. Try again.", timedOut);
  }
  if (!res.ok) throw new VoiceError(res.status === 401 ? "The ElevenLabs key is not valid." : res.status === 429 ? "The voice service is busy. Try again in a minute." : `The voice service refused the request (${res.status}).`);
  const data = (await res.json().catch(() => null)) as { audio_base64?: string; alignment?: Alignment; normalized_alignment?: Alignment } | null;
  const alignment = data?.alignment ?? data?.normalized_alignment;
  const ends = (alignment?.character_end_times_seconds ?? []).map((s) => Math.round(s * 1000));
  if (!data?.audio_base64 || ends.length === 0) throw new VoiceError("The voice service answered without audio.", true);
  const starts = (alignment?.character_start_times_seconds ?? []).map((s) => Math.round(s * 1000));
  const timings = lineTimings(ranges, starts, ends);
  return {
    audio: decodeBase64(data.audio_base64),
    mimeType: "audio/mpeg",
    durationMs: ends[ends.length - 1] ?? 0,
    characters: text.length,
    voiceId,
    model,
    lines: lines.map((l, i) => ({ ...l, ...timings[i] })),
    costUsd: voiceCostUsd(text.length),
  };
}

/** Start of each scene in milliseconds (as animate.ts's sceneSlots counts them). */
const sceneStarts = (scenes: { seconds: number }[]) => {
  let t = 0;
  return scenes.map((s) => {
    const at = t;
    t += Math.round(s.seconds * 1000);
    return at;
  });
};

/**
 * Fits the spec to its voice-over: each line's piece of the take (with a little air around it) becomes a cue played a
 * moment after its scene starts, and a scene that is shorter than its line is stretched (up to the longest scene). A
 * line that still does not fit runs on into the next scene, and the next line waits for it. When the video would pass
 * 30 seconds, scenes without a line are shortened first; `fits` is false when lines had to be cut. Pure.
 */
export function fitSpecToVoice(spec: MotionSpec, voice: { lines: readonly SpokenLine[]; durationMs: number }): { spec: MotionSpec; cues: VoiceCue[]; fits: boolean } {
  const scenes = spec.scenes.map((s) => ({ ...s }));
  const T = VOICE_TIMING;
  const lines = [...voice.lines].filter((l) => l.scene >= 0 && l.scene < scenes.length && l.endMs > l.startMs).sort((a, b) => a.startMs - b.startMs);
  // The piece of the take for each line: from just before its first character to just after its last one, never
  // overlapping the next line's piece.
  let prevTo = 0;
  const pieces = lines.map((l, i) => {
    const next = lines[i + 1];
    const fromMs = Math.max(0, l.startMs - 40, prevTo);
    const toMs = Math.max(fromMs + 1, Math.min(voice.durationMs || l.endMs + 120, l.endMs + 120, next ? next.startMs : Infinity));
    prevTo = toMs;
    return { scene: l.scene, fromMs, toMs };
  });
  const last = scenes.length - 1;
  for (const p of pieces) {
    const s = scenes[p.scene];
    const lead = p.scene === 0 ? T.firstLeadMs : T.leadMs;
    const need = (lead + (p.toMs - p.fromMs) + (p.scene === last ? T.endTailMs : T.tailMs)) / 1000;
    if (s.seconds < need) s.seconds = Math.min(SPEC_LIMITS.maxSceneSeconds, Math.ceil(need * 100) / 100);
  }
  const voiced = new Set(pieces.map((p) => p.scene));
  const place = () => {
    const starts = sceneStarts(scenes);
    let free = 0;
    return pieces.map((p) => {
      const atMs = Math.max(starts[p.scene] + (p.scene === 0 ? T.firstLeadMs : T.leadMs), free);
      free = atMs + (p.toMs - p.fromMs) + T.gapMs;
      return { ...p, atMs };
    });
  };
  const total = () => scenes.reduce((sum, s) => sum + Math.round(s.seconds * 1000), 0);
  let cues = place();
  // A line spilling past the end: lengthen the last scene (as far as it may go).
  const end = () => (cues.length ? cues[cues.length - 1].atMs + (cues[cues.length - 1].toMs - cues[cues.length - 1].fromMs) + T.endTailMs : 0);
  if (end() > total()) {
    scenes[last].seconds = Math.min(SPEC_LIMITS.maxSceneSeconds, Math.ceil((scenes[last].seconds + (end() - total()) / 1000) * 100) / 100);
    cues = place();
  }
  // Too long for a video: shorten the scenes without a line (down to the shortest a scene may be), then voiced ones.
  const maxMs = SPEC_LIMITS.maxTotalSeconds * 1000;
  for (const group of [scenes.filter((_, i) => !voiced.has(i)), scenes]) {
    if (total() <= maxMs) break;
    const over = total() - maxMs;
    const room = group.reduce((sum, s) => sum + Math.max(0, s.seconds - SPEC_LIMITS.minSceneSeconds), 0);
    if (room <= 0) continue;
    const cut = Math.min(1, over / 1000 / room);
    for (const s of group) s.seconds = Math.floor((s.seconds - Math.max(0, s.seconds - SPEC_LIMITS.minSceneSeconds) * cut) * 100) / 100;
    cues = place();
  }
  // Lines that still run past the end are cut there (the video never passes 30 seconds).
  const totalMs = total();
  let fits = true;
  const kept: VoiceCue[] = [];
  for (const c of cues) {
    if (c.atMs >= totalMs - 300) {
      fits = false;
      continue;
    }
    const room = totalMs - 200 - c.atMs;
    if (c.toMs - c.fromMs > room) {
      fits = false;
      kept.push({ ...c, toMs: c.fromMs + room });
    } else kept.push(c);
  }
  for (const s of scenes) s.seconds = Math.round(s.seconds * 100) / 100;
  return { spec: { ...spec, scenes }, cues: kept, fits };
}

/** When the voice speaks in the video (for ducking the music under it). */
export const cueTimings = (cues: readonly VoiceCue[]) => cues.map((c) => ({ startMs: c.atMs, endMs: c.atMs + (c.toMs - c.fromMs) }));

/** Fade at each end of a cue so cutting the take never clicks. */
const CUE_FADE_MS = 8;

/**
 * The voice track of the whole video: each cue's piece of the decoded take placed at its moment, with a short fade at
 * both ends. `take` holds the decoded channels at `sampleRate`. Pure.
 */
export function placeVoice(take: readonly Float32Array[], cues: readonly VoiceCue[], sampleRate: number, totalMs: number): Float32Array[] {
  const frames = Math.max(1, Math.round((totalMs / 1000) * sampleRate));
  const fade = Math.max(1, Math.round((CUE_FADE_MS / 1000) * sampleRate));
  return take.map((src) => {
    const out = new Float32Array(frames);
    for (const c of cues) {
      const from = Math.max(0, Math.round((c.fromMs / 1000) * sampleRate));
      const to = Math.min(src.length, Math.round((c.toMs / 1000) * sampleRate));
      const at = Math.round((c.atMs / 1000) * sampleRate);
      const n = to - from;
      for (let i = 0; i < n; i++) {
        const o = at + i;
        if (o < 0) continue;
        if (o >= frames) break;
        const g = Math.min(1, (i + 1) / fade, (n - i) / fade);
        out[o] += src[from + i] * g;
      }
    }
    return out;
  });
}
