import { SocialError, type Network } from "./types";

// Shared by the Instagram and Facebook providers: Graph API version, one fetch helper and the mapping of
// Graph errors to SocialError kinds so the publisher knows whether to retry, fail or ask for a reconnect.

/** Graph API version used by both Meta providers. Bump here when Meta retires it. */
export const GRAPH_VERSION = "v23.0";

type GraphError = { message?: string; code?: number; error_subcode?: number; type?: string };

const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 368, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const AUTH_CODES = new Set([102, 190, 200, 459, 463, 467]);

export function mapGraphError(network: Network, status: number, error: GraphError | undefined): SocialError {
  const message = error?.message || `${network} request failed (${status})`;
  const code = error?.code;
  if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
    return new SocialError(message, "auth", network);
  }
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) return new SocialError(message, "rate_limit", network, 3600);
  if (status >= 500 || code === 1 || code === 2) return new SocialError(message, "temporary", network);
  return new SocialError(message, "invalid", network);
}

/** Calls a Graph endpoint and returns its JSON, throwing a SocialError for any failure. */
export async function graphJson<T = Record<string, unknown>>(network: Network, url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
  } catch {
    throw new SocialError(`Could not reach ${network}`, "temporary", network);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: GraphError };
  if (!response.ok || body.error) throw mapGraphError(network, response.status, body.error);
  return body;
}

export function formBody(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out.set(k, String(v));
  return out;
}

type Params = Record<string, string | number | boolean | undefined>;

/**
 * On graph.facebook.com, moves an access token into an Authorization: Bearer header so it stays out of URLs and logs. Token exchange
 * and refresh calls (they carry grant_type) and the OAuth code exchange keep their documented parameters.
 */
function withBearer(url: string, params: Params): { params: Params; headers: Record<string, string> } {
  const { access_token: token, ...rest } = params;
  // graph.instagram.com: Meta's Instagram Login docs only show access_token as a query/body parameter and never
  // mention a Bearer header (checked get-started page), so it stays a parameter there. graph.facebook.com accepts the header.
  if (typeof token !== "string" || params.grant_type !== undefined || new URL(url).hostname !== "graph.facebook.com") return { params, headers: {} };
  return { params: rest, headers: { Authorization: `Bearer ${token}` } };
}

export function graphPost<T = Record<string, unknown>>(network: Network, url: string, params: Params) {
  const { params: body, headers } = withBearer(url, params);
  return graphJson<T>(network, url, { method: "POST", body: formBody(body), headers });
}

export function graphGet<T = Record<string, unknown>>(network: Network, url: string, params: Params) {
  const { params: query, headers } = withBearer(url, params);
  return graphJson<T>(network, `${url}?${formBody(query)}`, { headers });
}

