// Gemini's Interactions API over plain fetch (POST /v1beta/interactions with the x-goog-api-key header), the same
// request and answer as the @google/genai SDK's `interactions.create`. The SDK brought google-auth-library, ws,
// bignumber.js and gaxios into every server bundle (about 2 MB, duplicated per route layer), too much for a
// Cloudflare Worker (docs/DEPLOY.md, bundle size).
import "server-only";
import { fetchWithRetry, logProviderError } from "./http-retry";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

/** An HTTP error from Gemini: `status` decides whether a retry (or the fallback model) may help. */
export class GeminiHttpError extends Error {
  constructor(public status: number | undefined) {
    super(`Gemini answered ${status ?? "without a status"}`);
  }
}

export type InteractionContent = { type: string; text?: string; data?: string; mime_type?: string };
export type Interaction = {
  id?: string;
  status?: string;
  steps?: { type: string; content?: InteractionContent[] }[];
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
};

/**
 * Creates one interaction (not stored), with retries inside `budgetMs` (lib/ai/http-retry.ts); throws GeminiHttpError on
 * an HTTP error, a timeout, a network failure or an unreadable answer.
 */
export async function createInteraction(apiKey: string, body: Record<string, unknown>, budgetMs: number, fetchImpl: typeof fetch = fetch): Promise<Interaction> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      `${GEMINI_API}/interactions`,
      { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body) },
      { budgetMs, fetchImpl },
    );
  } catch {
    throw new GeminiHttpError(undefined);
  }
  if (!response.ok) {
    // Only the error's status code is logged and kept: the message may echo the prompt.
    await logProviderError("gemini", response, typeof body.model === "string" ? body.model : undefined);
    throw new GeminiHttpError(response.status);
  }
  try {
    return (await response.json()) as Interaction;
  } catch {
    // A body cut off by the time budget or a broken answer: worth another try.
    throw new GeminiHttpError(undefined);
  }
}
