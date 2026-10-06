import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AIProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class ClaudeTextProvider implements TextProvider {
  readonly name = "claude";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
    private effort: Effort,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async generate({ system, prompt, jsonSchema }: TextRequest): Promise<TextResult> {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: {
          effort: this.effort,
          ...(jsonSchema ? { format: { type: "json_schema", schema: jsonSchema } } : {}),
        },
        // If a safety classifier declines, the API retries on a suitable model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new AIProviderError("Claude rate limit reached", this.name, true);
      }
      if (error instanceof Anthropic.APIError) {
        const retryable = error.status === undefined || error.status >= 500;
        throw new AIProviderError(`Claude request failed (${error.status})`, this.name, retryable);
      }
      throw new AIProviderError("Claude request failed", this.name, true);
    }

    if (response.stop_reason === "refusal") {
      throw new AIProviderError("Claude declined this request", this.name);
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    if (!text) throw new AIProviderError("Claude returned no text", this.name);
    return { text, provider: this.name, model: response.model };
  }
}
