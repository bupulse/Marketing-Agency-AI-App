import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prisma: { adminSetting: { findUnique: vi.fn(), upsert: vi.fn() }, $transaction: vi.fn() }, audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: mocks.audit }));

import { GeminiTtsProvider } from "@/lib/ai/tts-gemini";
import { getTtsProvider } from "@/lib/ai/tts";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { estimateCharTimings, pcmFromWav, pcmRate, speechShape, wavFromPcm } from "@/lib/voice/pcm";
import { DEFAULT_ENGLISH_VOICE, pickVoice, readEnglishVoice, setEnglishVoice } from "@/lib/voice/provider-setting";
import { DEFAULT_VOICE_ID, isVoiceId, providerOfVoice, providerVoiceName } from "@/lib/voice/voices";
import { lineTimings, speechText } from "@/lib/voice/speech";

const RATE = 24_000;

/** 16-bit mono PCM: loud tone for each [startMs, endMs] stretch, silence elsewhere. */
function pcmWith(stretches: [number, number][], totalMs: number): Uint8Array {
  const n = Math.round((totalMs / 1000) * RATE);
  const out = new Int16Array(n);
  for (const [a, b] of stretches) for (let i = Math.round((a / 1000) * RATE); i < Math.round((b / 1000) * RATE) && i < n; i++) out[i] = Math.round(Math.sin(i / 5) * 12_000);
  return new Uint8Array(out.buffer);
}

describe("PCM helpers", () => {
  it("wraps PCM as a WAV file and reads it back", () => {
    const pcm = pcmWith([[0, 100]], 200);
    const wav = wavFromPcm(pcm, RATE);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(wav.length).toBe(44 + pcm.length);
    const back = pcmFromWav(wav)!;
    expect(back.sampleRate).toBe(RATE);
    expect(back.pcm).toEqual(pcm);
    expect(pcmFromWav(pcm)).toBeNull();
    expect(pcmRate("audio/L16;codec=pcm;rate=16000")).toBe(16_000);
    expect(pcmRate(undefined)).toBe(24_000);
  });

  it("finds the speech and its pauses", () => {
    const shape = speechShape(pcmWith([[200, 1500], [1900, 3000]], 3400), RATE);
    expect(shape.startMs).toBe(200);
    expect(shape.endMs).toBe(3000);
    expect(shape.durationMs).toBe(3400);
    expect(shape.gaps).toEqual([{ startMs: 1500, endMs: 1900 }]);
  });

  it("pins each sentence end to the pause, so a caption changes when the voice pauses", () => {
    const text = "Short one. A much longer second sentence follows here.";
    // The voice really pauses at 1.5 s, earlier than the characters' share (about 0.9 s) would put it.
    const shape = speechShape(pcmWith([[0, 1500], [1900, 4000]], 4200), RATE);
    const { starts, ends } = estimateCharTimings(text, shape);
    expect(starts).toHaveLength(text.length);
    const { ranges } = speechText(["Short one.", "A much longer second sentence follows here."]);
    const [first, second] = lineTimings(ranges, starts, ends);
    expect(first.endMs).toBe(1500);
    expect(second.startMs).toBe(1900);
    expect(second.endMs).toBe(4000);
    expect(ends.every((e, i) => e >= starts[i])).toBe(true);
  });

  it("without pauses, shares the speech by character weight", () => {
    const { starts, ends } = estimateCharTimings("Hello there.", { gaps: [], startMs: 100, endMs: 1100 });
    expect(starts[0]).toBe(100);
    expect(ends.at(-1)).toBe(1100);
  });
});

describe("Gemini text-to-speech", () => {
  it("asks for audio with the prebuilt voice and returns a WAV with timings and token usage", async () => {
    const pcm = pcmWith([[0, 900], [1200, 2200]], 2400);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent");
      const body = JSON.parse(String(init!.body));
      expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
      expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
      expect(body.contents[0].parts[0].text).toContain("Hi there. Visit us.");
      expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(pcm).toString("base64") } }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 60 } }));
    });
    const r = await new GeminiTtsProvider("k", undefined, fetchImpl as unknown as typeof fetch).speak({ text: "Hi there. Visit us.", voiceId: "Kore" });
    expect(r.mimeType).toBe("audio/wav");
    expect(String.fromCharCode(...r.audio.subarray(0, 4))).toBe("RIFF");
    expect(r.durationMs).toBe(2400);
    expect(r.charStartsMs).toHaveLength("Hi there. Visit us.".length);
    expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 60 });
    expect(r.provider).toBe("gemini");
  });

  it("accepts a WAV answer too, and refuses unknown voices and errors without echoing the answer", async () => {
    const wav = wavFromPcm(pcmWith([[0, 500]], 600), RATE);
    const ok = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } }] } }] })));
    const r = await new GeminiTtsProvider("k", "gemini-3.8-flash-tts", ok as unknown as typeof fetch).speak({ text: "Hi.", voiceId: "Puck" });
    expect(r.durationMs).toBe(600);
    await expect(new GeminiTtsProvider("k", undefined, ok as unknown as typeof fetch).speak({ text: "Hi.", voiceId: "../evil" })).rejects.toThrow("Unknown voice");
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "secret stuff" } }), { status: 402 }));
    await expect(new GeminiTtsProvider("k", undefined, refused as unknown as typeof fetch).speak({ text: "Hi.", voiceId: "Kore" })).rejects.toThrow("refused the request (402)");
  });

  it("is built from GEMINI_API_KEY, and its tokens are priced (about $0.007 for 30 seconds)", () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(getTtsProvider("gemini")?.model).toBe("gemini-3.8-flash-tts");
    vi.unstubAllEnvs();
    const cost = estimateCostUsd("gemini-3.8-flash-tts", { inputTokens: 100, outputTokens: 750 });
    expect(cost).toBeCloseTo((100 * 0.5 + 750 * 9) / 1e6, 6);
  });
});

describe("English voice setting", () => {
  it("defaults to ElevenLabs JB Pro and refuses a voice from the other provider", () => {
    expect(readEnglishVoice(null)).toEqual(DEFAULT_ENGLISH_VOICE);
    expect(readEnglishVoice({ provider: "gemini", voiceId: "gemini:Kore" })).toEqual({ provider: "gemini", voiceId: "gemini:Kore" });
    expect(readEnglishVoice({ provider: "gemini", voiceId: DEFAULT_VOICE_ID })).toEqual(DEFAULT_ENGLISH_VOICE);
    expect(isVoiceId("gemini:Kore")).toBe(true);
    expect(providerOfVoice("gemini:Kore")).toBe("gemini");
    expect(providerVoiceName("gemini:Kore")).toBe("Kore");
  });

  it("picks the video's or the business's voice of the active provider, else the admin's voice", () => {
    const gemini = { provider: "gemini" as const, voiceId: "gemini:Sulafat" };
    expect(pickVoice(gemini, DEFAULT_VOICE_ID, DEFAULT_VOICE_ID)).toBe("gemini:Sulafat");
    expect(pickVoice(gemini, "gemini:Puck", null)).toBe("gemini:Puck");
    expect(pickVoice(DEFAULT_ENGLISH_VOICE, "EXAVITQu4vr4xnSDxMaL")).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(pickVoice(DEFAULT_ENGLISH_VOICE, "gemini:Puck", null)).toBe(DEFAULT_VOICE_ID);
    // A new ElevenLabs default replaces the old default every business had.
    expect(pickVoice({ provider: "elevenlabs", voiceId: "4SFJvuIUvxaPLgk8FoK3" }, DEFAULT_VOICE_ID)).toBe("4SFJvuIUvxaPLgk8FoK3");
  });

  it("saves the admin's choice with an audit row, only a voice of that provider", async () => {
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.prisma));
    mocks.prisma.adminSetting.findUnique.mockResolvedValue(null);
    const ctx = { actor: "admin", ip: null, viaApi: false } as never;
    await expect(setEnglishVoice(ctx, { provider: "gemini", voiceId: "gemini:Kore" })).resolves.toEqual({ provider: "gemini", voiceId: "gemini:Kore" });
    expect(mocks.prisma.adminSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "voice.english" } }));
    expect(mocks.audit).toHaveBeenCalledWith(mocks.prisma, ctx, "update_setting", "setting:voice.english", DEFAULT_ENGLISH_VOICE, { provider: "gemini", voiceId: "gemini:Kore" });
    await expect(setEnglishVoice(ctx, { provider: "gemini", voiceId: DEFAULT_VOICE_ID })).rejects.toThrow("that provider");
    await expect(setEnglishVoice(ctx, { provider: "azure", voiceId: "x" })).rejects.toThrow("ElevenLabs or Gemini");
  });
});
