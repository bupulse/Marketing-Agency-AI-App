// The Captioner (docs/IMAGE_ENGINE.md): writes the post caption that goes with each picture, from its concept, in one
// call per batch. Sentences with a number the facts do not have are dropped (never an invented price or statistic).
// The pure parts are exported for tests; captionBatch calls the AI and never throws (no caption is not an error).
import "server-only";
import { getTextProvider } from "@/lib/ai";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { logError } from "@/lib/errors";
import { readCaptions, captionPrompt, CAPTION_SCHEMA, CAPTION_SYSTEM, type CaptionInput } from "./captions";

export async function captionBatch(owner: { userId: string; businessId: string }, input: CaptionInput): Promise<(string | null)[]> {
  if (!input.concepts.length) return [];
  try {
    const provider = getTextProvider();
    const model = provider.name === "claude" ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5") : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL);
    const result = await withLedger(
      { ...owner, feature: "imageEngine" },
      { provider: provider.name, model },
      () => provider.generate({ system: CAPTION_SYSTEM, prompt: captionPrompt(input), jsonSchema: CAPTION_SCHEMA, maxOutputTokens: 400 * input.concepts.length + 300 }),
      (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
    );
    return readCaptions(result.text, input);
  } catch (error) {
    await logError(error, { source: "image-engine.captions", level: "warn", businessId: owner.businessId });
    return input.concepts.map(() => null);
  }
}
