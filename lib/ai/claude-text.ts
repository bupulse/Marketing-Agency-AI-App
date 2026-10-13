import "server-only";
import { AIProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The Messages API over plain fetch: the @anthropic-ai/sdk package is too heavy for a Cloudflare Worker (docs/DEPLOY.md). */
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages?beta=true";
/** If a safety classifier declines, the API retries on a suitable model. */
export const CLAUDE_BETAS = ["server-side-fallback-2026-07-01"];

type MessageResponse = {
  model: string;
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export class ClaudeTextProvider implements TextProvider {
  readonly name = "claude";

  constructor(
    private apiKey: string,
    private model: string,
    private effort: Effort,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async generate({ system, prompt, jsonSchema }: TextRequest): Promise<TextResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": CLAUDE_BETAS.join(",") },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system,
          messages: [{ role: "user", content: prompt }],
          output_config: {
            effort: this.effort,
            ...(jsonSchema ? { format: { type: "json_schema", schema: jsonSchema } } : {}),
          },
          fallbacks: "default",
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new AIProviderError("Claude request failed", this.name, true);
    }
    if (res.status === 429) throw new AIProviderError("Claude rate limit reached", this.name, true);
    if (!res.ok) throw new AIProviderError(`Claude request failed (${res.status})`, this.name, res.status >= 500);

    const response = (await res.json()) as MessageResponse;
    const usage = { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
    if (response.stop_reason === "refusal") {
      throw new AIProviderError("Claude declined this request", this.name, false, usage, response.model);
    }
    const text = (response.content ?? []).flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("");
    if (!text) throw new AIProviderError("Claude returned no text", this.name, false, usage, response.model);
    return { text, provider: this.name, model: response.model, usage };
  }
}
