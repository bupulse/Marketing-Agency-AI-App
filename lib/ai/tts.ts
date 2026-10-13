// The text-to-speech seam (docs/VOICE_AND_MUSIC.md). Feature code depends on TtsProvider only; ElevenLabs is the
// provider today (ELEVENLABS_API_KEY, server-side only, never logged). Each call returns the MP3 and when every
// character is spoken, so captions and scenes can follow the voice.
import "server-only";
import { AIProviderError } from "./types";

export interface TtsRequest {
  text: string;
  voiceId: string;
}

export interface TtsResult {
  /** MP3 bytes. */
  audio: Uint8Array;
  mimeType: "audio/mpeg";
  /** Start and end of each character of `text`, in milliseconds. */
  charStartsMs: number[];
  charEndsMs: number[];
  durationMs: number;
  characters: number;
  provider: string;
  model: string;
}

export interface TtsProvider {
  readonly name: string;
  readonly model: string;
  speak(request: TtsRequest): Promise<TtsResult>;
}

export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
const API = "https://api.elevenlabs.io/v1";

type Alignment = { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] };

/** ElevenLabs "with timestamps": the audio as base64 and the timing of every character. */
export class ElevenLabsProvider implements TtsProvider {
  readonly name = "elevenlabs";
  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_ELEVENLABS_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async speak({ text, voiceId }: TtsRequest): Promise<TtsResult> {
    if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) throw new AIProviderError("Unknown voice", this.name, false, undefined, this.model);
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text, model_id: this.model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new AIProviderError("The voice service did not answer", this.name, true, undefined, this.model);
    }
    if (!response.ok) {
      // Only the status is kept: the answer may echo the request.
      throw new AIProviderError(`The voice service refused the request (${response.status})`, this.name, response.status === 429 || response.status >= 500, { inputTokens: 0, outputTokens: 0 }, this.model);
    }
    const data = (await response.json().catch(() => null)) as { audio_base64?: string; alignment?: Alignment; normalized_alignment?: Alignment } | null;
    const alignment = data?.alignment ?? data?.normalized_alignment;
    if (!data?.audio_base64 || !alignment?.character_end_times_seconds?.length) throw new AIProviderError("The voice service answered without audio", this.name, true, undefined, this.model);
    const audio = Uint8Array.from(Buffer.from(data.audio_base64, "base64"));
    const starts = (alignment.character_start_times_seconds ?? []).map((s) => Math.round(s * 1000));
    const ends = alignment.character_end_times_seconds.map((s) => Math.round(s * 1000));
    return { audio, mimeType: "audio/mpeg", charStartsMs: starts, charEndsMs: ends, durationMs: ends[ends.length - 1] ?? 0, characters: text.length, provider: this.name, model: this.model };
  }
}

let provider: TtsProvider | null | undefined;

/** The configured voice provider, or null when ELEVENLABS_API_KEY is not set (videos then have no voiceover). */
export function getTtsProvider(): TtsProvider | null {
  if (provider !== undefined) return provider;
  const key = process.env.ELEVENLABS_API_KEY;
  provider = key ? new ElevenLabsProvider(key, process.env.ELEVENLABS_MODEL || DEFAULT_ELEVENLABS_MODEL) : null;
  return provider;
}

/** Tests replace the provider. */
export function setTtsProvider(next: TtsProvider | null | undefined) {
  provider = next;
}

/** A voice's public sample (ElevenLabs returns a preview URL per voice; listening to it costs no characters). */
export async function voicePreviewUrl(voiceId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !/^[A-Za-z0-9]{8,40}$/.test(voiceId)) return null;
  try {
    const response = await fetchImpl(`${API}/voices/${voiceId}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { preview_url?: unknown };
    return typeof data.preview_url === "string" && /^https:\/\//.test(data.preview_url) ? data.preview_url : null;
  } catch {
    return null;
  }
}
