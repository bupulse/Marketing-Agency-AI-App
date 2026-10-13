import "server-only";
import { fetchWithRetry, isRetryableStatus, logProviderError } from "./http-retry";
import { AIProviderError, type TextProvider, type TextRequest, type TextResult } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The Messages API over plain fetch: the @anthropic-ai/sdk package is too heavy for a Cloudflare Worker (docs/DEPLOY.md). */
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages?beta=true";
/** If a safety classifier declines, the API retries on a suitable model. */
export const CLAUDE_BETAS = ["server-side-fallback-2026-07-01"];
/** One call, retries and their waits included (lib/ai/http-retry.ts). */
export const CLAUDE_BUDGET_MS = 120_000;

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
      res = await fetchWithRetry(
        ANTHROPIC_MESSAGES_URL,
        {
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
        },
        { budgetMs: CLAUDE_BUDGET_MS, fetchImpl: this.fetchImpl },
      );
    } catch {
      throw new AIProviderError("Claude request failed", this.name, true);
    }
    if (res.status === 429) throw new AIProviderError("Claude rate limit reached", this.name, true);
    if (!res.ok) {
      // Only the error type is logged (billing, key, schema problems), never the message.
      await logProviderError("claude", res, this.model);
      throw new AIProviderError(`Claude request failed (${res.status})`, this.name, isRetryableStatus(res.status));
    }

    let response: MessageResponse;
    try {
      response = (await res.json()) as MessageResponse;
    } catch {
      // Cut off by the time budget, or not JSON: another try may work.
      throw new AIProviderError("Claude answer could not be read", this.name, true);
    }
    const usage = { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
    if (response.stop_reason === "refusal") {
      throw new AIProviderError("Claude declined this request", this.name, false, usage, response.model);
    }
    const text = (response.content ?? []).flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("");
    if (!text) throw new AIProviderError("Claude returned no text", this.name, false, usage, response.model);
    return { text, provider: this.name, model: response.model, usage };
  }
}
