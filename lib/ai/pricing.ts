// Estimated provider prices in USD, for the AI cost ledger (AiCall.costUsd). Update when
// providers change prices; unknown models fall back to zero and are flagged in the admin view.
// Prices per 1M tokens unless noted.

type ModelPrice = { input: number; output: number; perImage?: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash-image": { input: 0.3, output: 30, perImage: 0.039 },
  "claude-opus-5-5": { input: 5, output: 25 },
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
