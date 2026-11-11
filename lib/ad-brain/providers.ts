// The Ad Brain's paid providers over plain fetch (docs/AD_BRAIN.md, section 4; facts checked on 10 Nov 2026):
//   Nano Banana 2.1   gemini-nano-banana-2.1, Interactions API, image out; a reference photo + "keep framing, replace X"
//                     keeps pose and room (identity edits)
//   Lyria 3 Clip      lyria-3-clip-preview, generateContent with responseModalities AUDIO: a 30 s MP3; ignores timing
//   Gemini TTS        gemini-3.8-flash-tts: reads EVERYTHING aloud (no style words), 24 kHz 16-bit PCM back
//   Gemini 3.8 Flash  word timings of a clip or line, and the judge (watches and listens to the MP4)
// Omni Flash clips go through lib/video-engine/veo.ts (submitVeo / getVeoOperation / veoClipBytes).
// The callers wrap every call in withLedger (feature "adBrain"); nothing here logs a prompt or a key.
import "server-only";
import { GEMINI_API } from "@/lib/ai/gemini-rest";
import type { TokenUsage } from "@/lib/ai/types";
import type { Word } from "./edl";

export const MODELS = {
  image: () => process.env.AD_BRAIN_IMAGE_MODEL?.trim() || "gemini-nano-banana-2.1",
  music: () => process.env.AD_BRAIN_MUSIC_MODEL?.trim() || "lyria-3-clip-preview",
  tts: () => process.env.AD_BRAIN_TTS_MODEL?.trim() || "gemini-3.8-flash-tts",
  think: () => process.env.AD_BRAIN_TEXT_MODEL?.trim() || "gemini-3.8-flash",
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

type F = typeof fetch;
const headers = (key: string) => ({ "content-type": "application/json", "x-goog-api-key": key });

async function post(url: string, key: string, body: unknown, timeoutMs: number, f: F): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: headers(key), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ProviderError("Google did not answer in time.", undefined, true);
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // no body
  }
  if (!res.ok) {
    // Google's message is not passed on (it can echo the prompt); the status says enough.
    throw new ProviderError(res.status === 429 ? "Google is at its limit right now; it is tried again later." : `Google refused the request (${res.status}).`, res.status, res.status === 429 || res.status >= 500);
  }
  return json;
}

type GenUsage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
const genUsage = (u: GenUsage | undefined): TokenUsage => ({ inputTokens: u?.promptTokenCount ?? 0, outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) });
type Part = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };
const partsOf = (b: Record<string, unknown>): Part[] => ((b.candidates as { content?: { parts?: Part[] } }[] | undefined)?.[0]?.content?.parts ?? []) as Part[];

export type Bytes = { bytes: Buffer; mimeType: string; usage: TokenUsage; model: string };

/** One 9:16 image (a portrait from text, or an edit of `reference`). */
export async function makeImage(key: string, input: { prompt: string; reference?: { bytes: Buffer; mimeType: string } | null }, f: F = fetch): Promise<Bytes> {
  const model = MODELS.image();
  const parts: unknown[] = [];
  if (input.reference) parts.push({ type: "image", data: input.reference.bytes.toString("base64"), mime_type: input.reference.mimeType });
  parts.push({ type: "text", text: input.prompt });
  const b = await post(`${GEMINI_API}/interactions`, key, { model, input: parts, store: false, response_format: { type: "image", aspect_ratio: "9:16" } }, 150_000, f);
  const items = ((b.steps as { content?: { type?: string; data?: string; mime_type?: string }[] }[] | undefined) ?? []).flatMap((s) => s.content ?? []);
  const img = items.find((c) => c.type === "image" && c.data);
  const u = b.usage as { total_input_tokens?: number; total_output_tokens?: number } | undefined;
  const usage = { inputTokens: u?.total_input_tokens ?? 0, outputTokens: u?.total_output_tokens ?? 0 };
  if (!img?.data) throw new ProviderError("The image model answered without a picture (it may have declined the prompt).");
  return { bytes: Buffer.from(img.data, "base64"), mimeType: img.mime_type?.includes("jpeg") ? "image/jpeg" : (img.mime_type ?? "image/png"), usage, model };
}

/** One instrumental track (about 30 s, MP3). */
export async function makeMusic(key: string, prompt: string, f: F = fetch): Promise<Bytes> {
  const model = MODELS.music();
  const b = await post(`${GEMINI_API}/models/${model}:generateContent`, key, { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"] } }, 150_000, f);
  const audio = partsOf(b).map((p) => p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined)).find((d) => d?.data);
  if (!audio?.data) throw new ProviderError("The music model answered without a track.");
  return { bytes: Buffer.from(audio.data, "base64"), mimeType: audio.mimeType?.includes("wav") ? "audio/wav" : "audio/mpeg", usage: genUsage(b.usageMetadata as GenUsage), model };
}

/** 16-bit mono PCM wrapped as a WAV file. */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** One spoken line (plain text only: Gemini TTS reads style words aloud). */
export async function makeSpeech(key: string, input: { text: string; voice: string }, f: F = fetch): Promise<Bytes> {
  const model = MODELS.tts();
  const b = await post(`${GEMINI_API}/models/${model}:generateContent`, key, { contents: [{ role: "user", parts: [{ text: input.text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } } } }, 90_000, f);
  const audio = partsOf(b).map((p) => p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined)).find((d) => d?.data);
  if (!audio?.data) throw new ProviderError("The voice model answered without sound.");
  const raw = Buffer.from(audio.data, "base64");
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType ?? "")?.[1] ?? 24_000);
  const wav = raw.subarray(0, 4).toString("latin1") === "RIFF" ? raw : pcmToWav(raw, rate);
  return { bytes: wav, mimeType: "audio/wav", usage: genUsage(b.usageMetadata as GenUsage), model };
}

/** Gemini 3.8 Flash on a media file with a JSON answer (word timings, the judge). */
export async function askAboutMedia<T>(key: string, input: { bytes: Buffer; mimeType: string; prompt: string }, f: F = fetch): Promise<{ answer: T; usage: TokenUsage; model: string }> {
  const model = MODELS.think();
  const b = await post(`${GEMINI_API}/models/${model}:generateContent`, key, { contents: [{ parts: [{ inline_data: { mime_type: input.mimeType, data: input.bytes.toString("base64") } }, { text: input.prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }, 150_000, f);
  const text = partsOf(b).map((p) => p.text ?? "").join("");
  try {
    return { answer: JSON.parse(text) as T, usage: genUsage(b.usageMetadata as GenUsage), model };
  } catch {
    throw new ProviderError("Gemini's answer about the file could not be read.");
  }
}

/** The exact words heard in a clip or line, with start and end seconds. */
export async function wordTimings(key: string, file: { bytes: Buffer; mimeType: string }, intended: string, f: F = fetch): Promise<{ words: Word[]; usage: TokenUsage; model: string }> {
  const prompt = `Transcribe the speech in this file exactly as spoken, with timings. The intended line was: "${intended.slice(0, 300)}". Return JSON only: {"words": [{"w": word as spoken, "s": start seconds, "e": end seconds}]}. Times are seconds from the start of the file. No speech: {"words": []}.`;
  const { answer, usage, model } = await askAboutMedia<{ words?: { w?: unknown; s?: unknown; e?: unknown }[] }>(key, { ...file, prompt }, f);
  const words = (answer.words ?? [])
    .map((w) => ({ w: String(w.w ?? "").slice(0, 60), s: Number(w.s), e: Number(w.e) }))
    // Some answers come in milliseconds: anything past a minute is read as ms.
    .map((w) => (w.e > 60 ? { ...w, s: w.s / 1000, e: w.e / 1000 } : w))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e) && w.e >= w.s);
  return { words, usage, model };
}
