// Estimated provider prices in USD, for the AI cost ledger (AiCall.costUsd). Update when providers change prices.
// Prices per 1M tokens unless noted. How the estimate is made, and what it can still miss: docs/AI_COSTS.md.
//
// Model names are matched loosely (resolvePrice): "models/" prefixes and "-preview", "-latest", "-001" or dated
// suffixes are ignored, so "gemini-3.1-flash-image-preview" is priced like "gemini-3.1-flash-image". A name that is
// still unknown is priced at the dearest model of its family (flash-lite, flash, pro, image, Claude...), never at zero,
// and the admin AI page lists it, so a renamed model can only over-count until it is added here.

type ModelPrice = { input: number; output: number; perImage?: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Gemini 3.8 Flash doubles to 1.5 / 7.5 on 2027-01-01.
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.1-pro": { input: 2, output: 12 },
  "gemini-3.1-flash-image": { input: 0.5, output: 60, perImage: 0.067 },
  "gemini-3-pro-image": { input: 2, output: 120, perImage: 0.134 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  // 1,290 output tokens per image at $30 per 1M.
  "gemini-2.5-flash-image": { input: 0.3, output: 30, perImage: 0.039 },
  "claude-opus-5-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 1, output: 5 },
  // ElevenLabs text to speech, per 1M characters (the ledger records characters as input tokens): about $0.30 per
  // 1,000 characters at the paid plans' overage rate; included plan characters cost less (docs/VOICE_AND_MUSIC.md).
  // The Flash and Turbo models use half a credit per character.
  eleven_multilingual_v2: { input: 300, output: 0 },
  eleven_v3: { input: 300, output: 0 },
  eleven_flash_v2_5: { input: 150, output: 0 },
  eleven_turbo_v2_5: { input: 150, output: 0 },
  // ElevenLabs Music, per 1M seconds of music (the ledger records seconds as input tokens): an estimate of about
  // $0.60 a minute on the paid plan; check it against the ElevenLabs invoice (docs/VOICE_AND_MUSIC.md).
  music_v1: { input: 10_000, output: 0 },
  // ElevenLabs Sound Effects (sales screen sounds), per 1M seconds (seconds recorded as input tokens): an estimate of
  // about 40 credits a second, $0.012 a second at the overage rate; check it against the ElevenLabs invoice.
  sound_effects: { input: 12_000, output: 0 },
};

/** Lower case, no "models/" prefix, no "-preview", "-latest", "-exp", "-001" or date suffix. */
export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase().replace(/^models\//, "");
  for (let i = 0; i < 4; i++) {
    const next = m
      .replace(/-(preview|latest|exp|experimental)$/, "")
      .replace(/-\d{2}-\d{4}$/, "") // -09-2025
      .replace(/-\d{8}$/, "") // -20260101
      .replace(/-\d{3}$/, "") // -001
      .replace(/@\d{8}$/, "");
    if (next === m) break;
    m = next;
  }
  return m;
}

/** The dearest known model of each family, for a name not in the table (checked in this order). */
const FAMILIES: [RegExp, string][] = [
  [/pro.*image|image.*pro/, "gemini-3-pro-image"],
  [/gemini.*image|imagen/, "gemini-3.1-flash-image"],
  [/gemini.*flash-lite/, "gemini-3.1-flash-lite"],
  [/gemini.*flash/, "gemini-3.5-flash"],
  [/gemini.*pro/, "gemini-3.1-pro"],
  [/claude.*haiku/, "claude-haiku-5-5"],
  [/claude.*sonnet/, "claude-sonnet-5-5"],
  [/claude/, "claude-opus-5-5"],
  [/^eleven_|elevenlabs/, "eleven_multilingual_v2"],
  [/^music/, "music_v1"],
];

export type ResolvedPrice = { price: ModelPrice; key: string; match: "exact" | "normalized" | "family" } | null;

/** The price of a model: exact, after normalizing its name, or its family's dearest; null when nothing fits. */
export function resolvePrice(model: string): ResolvedPrice {
  if (MODEL_PRICES[model]) return { price: MODEL_PRICES[model], key: model, match: "exact" };
  const n = normalizeModel(model);
  if (MODEL_PRICES[n]) return { price: MODEL_PRICES[n], key: n, match: "normalized" };
  const family = FAMILIES.find(([re]) => re.test(n));
  return family ? { price: MODEL_PRICES[family[1]], key: family[1], match: "family" } : null;
}

/** True when a model is priced only by its family (or not at all): the admin AI page asks for it to be added. */
export function isApproximatePrice(model: string): boolean {
  const r = resolvePrice(model);
  return !r || r.match === "family";
}

export function estimateCostUsd(model: string, usage: { inputTokens?: number; outputTokens?: number; images?: number }): number {
  const price = resolvePrice(model)?.price;
  if (!price) return 0;
  const input = ((usage.inputTokens ?? 0) * price.input) / 1_000_000;
  const outputByTokens = ((usage.outputTokens ?? 0) * price.output) / 1_000_000;
  // Image models bill each generated image as output tokens (about 1,290 for 2.5 Flash Image). When the reported
  // output is less than the images' own price (only the text part reported, or nothing), the per-image price is the
  // floor, so an image is never recorded for a fraction of a cent.
  const outputByImages = price.perImage ? (usage.images ?? 0) * price.perImage : 0;
  return Math.round((input + Math.max(outputByTokens, outputByImages)) * 1_000_000) / 1_000_000;
}

/** A rough token count for text we sent, for a call that timed out before the provider reported its usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Output tokens assumed for a text call that timed out (a typical answer, thinking included). */
export const TIMEOUT_OUTPUT_TOKENS = 1_000;
