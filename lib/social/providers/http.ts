import { SocialError, type Network } from "../types";

// Shared by the network providers: fetch with a timeout, and the HTTP error to SocialError mapping.

const DEFAULT_TIMEOUT_MS = 20_000;

/** Network-level failures (timeout, DNS, connection reset) are temporary: the publisher retries later. */
export async function socialFetch(network: Network, url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new SocialError(timedOut ? `${network} did not answer in time` : `Could not reach ${network}`, "temporary", network);
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export type ErrorHints = {
  /** Provider error codes that mean the token is no longer good, whatever the HTTP status. */
  auth?: readonly string[];
  /** Provider error codes that mean "slow down", whatever the HTTP status. */
  rateLimit?: readonly string[];
  /** Provider error codes that mean the post itself is rejected, even when the status (403) would suggest auth. */
  invalid?: readonly string[];
};

type ErrorBody = {
  message?: string;
  code?: string | number;
  error?: string | { code?: string; message?: string; errors?: { reason?: string; message?: string }[] };
  error_description?: string;
};

/** Reads a provider error body (LinkedIn, TikTok and Google each shape it differently) into a message and a code. */
export function describeError(body: ErrorBody | null, fallback: string): { message: string; code: string | null } {
  if (!body) return { message: fallback, code: null };
  const nested = typeof body.error === "object" && body.error ? body.error : null;
  const code = nested?.errors?.[0]?.reason ?? nested?.code ?? (typeof body.error === "string" ? body.error : null) ?? (body.code != null ? String(body.code) : null);
  const message = nested?.message ?? body.error_description ?? body.message ?? fallback;
  return { message, code: code === "ok" ? null : code };
}

/** Maps a failed response (already parsed or not) to the SocialError kind the publisher acts on. */
export async function errorFrom(network: Network, response: Response, hints: ErrorHints = {}): Promise<SocialError> {
  let body: ErrorBody | null = null;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {}
  const { message, code } = describeError(body, `${network} returned ${response.status}`);
  return classify(network, response.status, message, code, hints, retryAfterSeconds(response));
}

export function classify(network: Network, status: number, message: string, code: string | null, hints: ErrorHints = {}, retryAfter?: number): SocialError {
  if (code && hints.rateLimit?.includes(code)) return new SocialError(message, "rate_limit", network, retryAfter);
  if (code && hints.auth?.includes(code)) return new SocialError(message, "auth", network);
  if (code && hints.invalid?.includes(code)) return new SocialError(message, "invalid", network);
  if (status === 401 || status === 403) return new SocialError(message, "auth", network);
  if (status === 429) return new SocialError(message, "rate_limit", network, retryAfter);
  if (status === 408 || status >= 500) return new SocialError(message, "temporary", network);
  return new SocialError(message, "invalid", network);
}
