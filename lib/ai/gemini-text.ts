import "server-only";
import { createInteraction, type Interaction } from "./gemini-rest";
import { AIProviderError, type TextProvider, type TextRequest, type TextResult, type TokenUsage } from "./types";

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.8-flash";
// Used when the main model is busy (429/5xx). Cheaper, and usually has spare capacity.
export const DEFAULT_GEMINI_TEXT_FALLBACK = "gemini-3.1-flash-lite";

function isRetryable(status: number | undefined) {
  return status === 429 || (status !== undefined && status >= 500);
}

function outputText(interaction: Interaction): string | undefined {
  const parts = (interaction.steps ?? [])
    .flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
    .flatMap((content) => (content.type === "text" && content.text ? [content.text] : []));
  return parts.length > 0 ? parts.join("") : undefined;
}

function usageOf(interaction: Interaction): TokenUsage {
  const usage = interaction.usage;
  return {
    inputTokens: usage?.total_input_tokens ?? 0,
    // Thinking tokens are billed as output.
    outputTokens: (usage?.total_output_tokens ?? 0) + (usage?.total_thought_tokens ?? 0),
  };
}

/** Gemini text through the Interactions API (newer Gemini models are not served by generateContent). */
export class GeminiTextProvider implements TextProvider {
  readonly name = "gemini";

  constructor(
    private apiKey: string,
    private model: string,
    private fallbackModel?: string,
  ) {}

  async generate(request: TextRequest): Promise<TextResult> {
    try {
      return await this.generateWith(this.model, request);
    } catch (error) {
      if (!(error instanceof AIProviderError) || !error.retryable || !this.fallbackModel || this.fallbackModel === this.model) throw error;
      return this.generateWith(this.fallbackModel, request);
    }
  }

  private async generateWith(model: string, { system, prompt, jsonSchema }: TextRequest): Promise<TextResult> {
    let interaction: Interaction;
    try {
      interaction = await createInteraction(
        this.apiKey,
        {
          model,
          system_instruction: system,
          input: prompt,
          store: false,
          generation_config: { max_output_tokens: 4096, thinking_level: "low" },
          ...(jsonSchema ? { response_format: { type: "text", mime_type: "application/json", schema: jsonSchema } } : {}),
        },
        90_000,
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new AIProviderError(`Gemini request failed${status ? ` (${status})` : ""}`, this.name, isRetryable(status), undefined, model);
    }
    const usage = usageOf(interaction);
    const text = outputText(interaction);
    if (!text) throw new AIProviderError("Gemini returned no text", this.name, false, usage, model);
    return { text, provider: this.name, model, usage };
  }
}
