// Estimated provider prices in USD, for the AI cost ledger (AiCall.costUsd). Update when
// providers change prices; unknown models fall back to zero and are flagged in the admin view.
// Prices per 1M tokens unless noted.

type ModelPrice = { input: number; output: number; perImage?: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Gemini 3.8 Flash doubles to 1.5 / 7.5 on 2027-01-01.
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.1-flash-image": { input: 0.5, output: 60, perImage: 0.067 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash-image": { input: 0.3, output: 30, perImage: 0.039 },
  "claude-opus-5-5": { input: 5, output: 25 },
  // ElevenLabs text to speech, per 1M characters (the ledger records characters as input tokens): about $0.30 per
  // 1,000 characters at the paid plans' overage rate; included plan characters cost less (docs/VOICE_AND_MUSIC.md).
  eleven_multilingual_v2: { input: 300, output: 0 },
  // ElevenLabs Music, per 1M seconds of music (the ledger records seconds as input tokens): an estimate of about
  // $0.60 a minute on the paid plan; check it against the ElevenLabs invoice (docs/VOICE_AND_MUSIC.md).
  music_v1: { input: 10_000, output: 0 },
  "claude-sonnet-5-5": { input: 3, output: 15 },
};

export function estimateCostUsd(model: string, usage: { inputTokens?: number; outputTokens?: number; images?: number }): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const tokens = ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) / 1_000_000;
  // Image models bill generated images as output tokens; perImage is used only when tokens are not reported.
  const images = price.perImage && !usage.outputTokens ? (usage.images ?? 0) * price.perImage : 0;
  return Math.round((tokens + images) * 1_000_000) / 1_000_000;
}
