// Gemini text-to-speech (docs/VOICE_AND_MUSIC.md, "Voice providers"): the second voice provider beside ElevenLabs,
// chosen in Admin -> Settings -> Voices ("English voice-over"). One generateContent call with an AUDIO answer and a
// prebuilt voice; the answer is raw 24 kHz PCM, wrapped as WAV here, with character timings estimated from the text
// and the pauses (lib/voice/pcm.ts), because Gemini gives none. The key is GEMINI_API_KEY (server-side, never logged).
import "server-only";
import { estimateCharTimings, pcmFromWav, pcmRate, speechShape, wavFromPcm } from "@/lib/voice/pcm";
import type { TtsProvider, TtsRequest, TtsResult } from "./tts";
import { AIProviderError } from "./types";

/** The default Gemini speech model (GA, cheapest good voice at the time of writing); GEMINI_TTS_MODEL overrides it. */
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

/** How the voice should sound: said once before the text; Gemini follows it and does not read it out. */
export const GEMINI_STYLE = "Read this short social media advert in clear, natural English, warm and confident, at a lively but easy pace:";

const isTimeout = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

type Answer = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export class GeminiTtsProvider implements TtsProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_GEMINI_TTS_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly style: string = GEMINI_STYLE,
  ) {}

  async speak({ text, voiceId }: TtsRequest): Promise<TtsResult> {
    // Prebuilt voice names: one capitalised word such as "Kore" or "Sadachbia".
    if (!/^[A-Z][a-z]{2,20}$/.test(voiceId)) throw new AIProviderError("Unknown voice", this.name, false, undefined, this.model);
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}/${this.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${this.style}\n${text}` }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } } },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      const timedOut = isTimeout(error);
      // Timed out: Google may still have made (and charged) the audio; about 25 audio tokens a second, 15 characters a second.
      throw new AIProviderError("The voice service did not answer", this.name, true, timedOut ? { inputTokens: Math.ceil(text.length / 4), outputTokens: Math.ceil(text.length / 15) * 25 } : undefined, this.model, undefined, timedOut);
    }
    if (!response.ok) {
      throw new AIProviderError(`The voice service refused the request (${response.status})`, this.name, response.status === 429 || response.status >= 500, { inputTokens: 0, outputTokens: 0 }, this.model);
    }
    const data = (await response.json().catch(() => null)) as Answer | null;
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new AIProviderError("The voice service answered without audio", this.name, true, undefined, this.model);
    const bytes = Uint8Array.from(Buffer.from(part.inlineData.data, "base64"));
    // A WAV answer (current models) or raw 16-bit PCM with its rate in the mime type (older ones).
    const wav = pcmFromWav(bytes);
    const pcm = wav?.pcm ?? bytes;
    const rate = wav?.sampleRate ?? pcmRate(part.inlineData.mimeType);
    if (pcm.length < 2) throw new AIProviderError("The voice service answered without audio", this.name, true, undefined, this.model);
    const shape = speechShape(pcm, rate);
    const { starts, ends } = estimateCharTimings(text, shape);
    const usage = { inputTokens: data?.usageMetadata?.promptTokenCount ?? Math.ceil((this.style.length + text.length) / 4), outputTokens: data?.usageMetadata?.candidatesTokenCount ?? Math.ceil(shape.durationMs / 40) };
    return { audio: wavFromPcm(pcm, rate), mimeType: "audio/wav", charStartsMs: starts, charEndsMs: ends, durationMs: shape.durationMs, characters: text.length, provider: this.name, model: this.model, usage };
  }
}
