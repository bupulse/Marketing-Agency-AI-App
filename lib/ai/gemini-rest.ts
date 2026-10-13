// Gemini's Interactions API over plain fetch (POST /v1beta/interactions with the x-goog-api-key header), the same
// request and answer as the @google/genai SDK's `interactions.create`. The SDK brought google-auth-library, ws,
// bignumber.js and gaxios into every server bundle (about 2 MB, duplicated per route layer), too much for a
// Cloudflare Worker (docs/DEPLOY.md, bundle size).
import "server-only";

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

/** Creates one interaction (not stored); throws GeminiHttpError on an HTTP error, a timeout or a network failure. */
export async function createInteraction(apiKey: string, body: Record<string, unknown>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<Interaction> {
  let response: Response;
  try {
    response = await fetchImpl(`${GEMINI_API}/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new GeminiHttpError(undefined);
  }
  // Only the status is kept: an error body may echo the prompt.
  if (!response.ok) throw new GeminiHttpError(response.status);
  return (await response.json()) as Interaction;
}
