// The Captioner (docs/IMAGE_ENGINE.md): writes the post caption that goes with each picture, from its concept, in one
// call per batch. Sentences with a number the facts do not have are dropped (never an invented price or statistic).
// The pure parts are exported for tests; captionBatch calls the AI and never throws (no caption is not an error).
// The Training Lab team's Caption writer: with the owner's saved brain it asks the router (runText, which logs its own
// runs); without one it works as it always has, on the site's text provider, and logs one run.
import "server-only";
import { getTextProvider } from "@/lib/ai";
import { DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/ai/gemini-text";
import { withLedger } from "@/lib/ai/ledger";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { logError } from "@/lib/errors";
import { runText, savedBrain } from "@/lib/training-lab/brains";
import { recordRun } from "@/lib/training-lab/runs";
import { readCaptions, captionPrompt, CAPTION_SCHEMA, CAPTION_SYSTEM, type CaptionInput } from "./captions";
import { logged, type TeamRef } from "./planner";

export async function captionBatch(owner: { userId: string; businessId: string }, input: CaptionInput, team: TeamRef = {}): Promise<(string | null)[]> {
  if (!input.concepts.length) return [];
  const maxOutputTokens = 400 * input.concepts.length + 300;
  try {
    if (await savedBrain("caption-writer")) {
      const run = await runText("caption-writer", { system: CAPTION_SYSTEM, prompt: captionPrompt(input), jsonSchema: CAPTION_SCHEMA, maxOutputTokens, feature: "imageEngine", owner, exampleIds: team.exampleIds, resultRef: team.resultRef });
      if (run) return readCaptions(run.text, input);
      // The router reached the rules: there are no rule-written captions, so the pictures go without one (as on an error).
      await recordRun({ agentId: "caption-writer", brain: "rules", feature: "imageEngine", businessId: owner.businessId, ok: true, exampleIds: team.exampleIds ?? [], resultRef: team.resultRef ?? null });
      return input.concepts.map(() => null);
    }
    const provider = getTextProvider();
    const model = provider.name === "claude" ? (process.env.CLAUDE_TEXT_MODEL ?? "claude-opus-5-5") : (process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL);
    return await logged("caption-writer", owner, team, provider.name === "claude" ? "anthropic" : "gemini", async () => {
      const result = await withLedger(
        { ...owner, feature: "imageEngine" },
        { provider: provider.name, model },
        () => provider.generate({ system: CAPTION_SYSTEM, prompt: captionPrompt(input), jsonSchema: CAPTION_SCHEMA, maxOutputTokens }),
        (r) => ({ provider: r.provider, model: r.model, usage: r.usage }),
      );
      const value = readCaptions(result.text, input);
      return { value, ok: value.some(Boolean), model: result.model, costUsd: estimateCostUsd(result.model, result.usage) };
    });
  } catch (error) {
    await logError(error, { source: "image-engine.captions", level: "warn", businessId: owner.businessId });
    return input.concepts.map(() => null);
  }
}
