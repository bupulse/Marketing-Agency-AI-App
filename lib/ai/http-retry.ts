import "server-only";
import { logError } from "@/lib/errors";

// Retries for the AI providers called over plain fetch (Claude, Gemini text and images), in place of the retries the
// SDKs used to make: up to 2 more attempts on 408, 409, 429, 5xx and network errors, after a short exponential
// backoff with jitter (or the provider's retry-after, capped), all inside the call's own time budget.

export const AI_RETRIES = 2;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
/** A retry needs at least this much of the budget left, or the last answer is returned as it is. */
const MIN_ATTEMPT_MS = 5_000;

export function isRetryableStatus(status: number | undefined): boolean {
  return status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
}

/** retry-after in ms (seconds or an HTTP date), or null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Wait before retry `attempt` (1-based): 500 ms, 1 s (plus up to 50% jitter), or retry-after; at most 8 s. */
export function backoffMs(attempt: number, retryAfter: number | null, random: () => number = Math.random): number {
  const exp = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(MAX_DELAY_MS, Math.max(retryAfter ?? 0, exp + exp * 0.5 * random()));
}

export type RetryOptions = {
  /** The whole call, retries and waits included. */
  budgetMs: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

/**
 * fetch with retries. Resolves with the last response (which may be an error status) or rejects with the last
 * network error or timeout. Each attempt is aborted at the end of the budget.
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const { budgetMs, retries = AI_RETRIES, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random, now = Date.now } = options;
  const deadline = now() + budgetMs;
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(Math.max(1, deadline - now())) });
    } catch (error) {
      failure = error;
    }
    if (response && !isRetryableStatus(response.status)) return response;
    const timedOut = failure instanceof Error && (failure.name === "TimeoutError" || failure.name === "AbortError");
    const wait = backoffMs(attempt + 1, response ? retryAfterMs(response.headers.get("retry-after")) : null, random);
    if (attempt >= retries || timedOut || deadline - now() - wait < MIN_ATTEMPT_MS) {
      if (response) return response;
      throw failure;
    }
    // The body of a failed attempt is not needed; release it.
    await response?.body?.cancel().catch(() => undefined);
    await sleep(wait);
  }
}

/**
 * Logs a provider's 4xx answer by its error type or code only (never the message, which may echo the prompt), so
 * billing, key and schema problems show in Admin, Errors. Never throws.
 */
export async function logProviderError(provider: string, response: Response, model?: string): Promise<void> {
  if (response.status < 400 || response.status >= 500) return;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: { type?: unknown; status?: unknown; code?: unknown } };
    const raw = body?.error?.type ?? body?.error?.status ?? body?.error?.code;
    if ((typeof raw === "string" || typeof raw === "number") && /^[A-Za-z0-9_.-]{1,64}$/.test(String(raw))) code = String(raw);
  } catch {
    // No JSON body: the status is enough.
  }
  await logError(new Error(`${provider} answered ${response.status}${code ? ` (${code})` : ""}`), { source: `ai.${provider}`, level: "warn", status: response.status, code, model });
}
