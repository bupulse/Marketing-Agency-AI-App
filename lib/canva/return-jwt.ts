import { CANVA_KEYS_URL, canvaConfig } from "./config";

export class ReturnTokenError extends Error {}

type Jwk = JsonWebKey & { kid?: string; alg?: string };

let cachedKeys: { keys: Jwk[]; fetchedAt: number } | null = null;
const KEYS_TTL_MS = 60 * 60 * 1000;

/** For tests. */
export function resetKeyCache() {
  cachedKeys = null;
  lastForcedFetch = 0;
}

const FORCED_REFETCH_MS = 60 * 1000;
let lastForcedFetch = 0;

/** Keys are cached for an hour; an unknown signature may refetch them, but at most once a minute. */
async function canvaKeys(force = false): Promise<Jwk[]> {
  if (!force && cachedKeys && Date.now() - cachedKeys.fetchedAt < KEYS_TTL_MS) return cachedKeys.keys;
  if (force && cachedKeys && Date.now() - lastForcedFetch < FORCED_REFETCH_MS) return cachedKeys.keys;
  if (force) lastForcedFetch = Date.now();
  const response = await fetch(CANVA_KEYS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ReturnTokenError("Could not load Canva's signing keys");
  const body = (await response.json()) as { keys?: Jwk[] };
  cachedKeys = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return cachedKeys.keys;
}

function decode(part: string): Uint8Array<ArrayBuffer> {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const json = <T>(part: string) => JSON.parse(new TextDecoder().decode(decode(part))) as T;

export type ReturnClaims = { aud: string; nbf?: number; sub?: string; team_id?: string; design_id: string; correlation_state: string; exp: number; type: string };

async function verifySignature(alg: string, jwk: Jwk, data: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>) {
  if (alg === "RS256") {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  }
  if (alg === "ES256") {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
  }
  throw new ReturnTokenError("Unsupported token algorithm");
}

/**
 * Checks the correlation_jwt Canva puts on the return URL: signature against Canva's published keys,
 * audience (our client id), type "rti" and expiry. Returns the claims.
 */
export async function verifyReturnJwt(token: string, now = Date.now()): Promise<ReturnClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ReturnTokenError("Malformed token");
  let header: { alg?: string; kid?: string };
  let claims: ReturnClaims;
  try {
    header = json(parts[0]);
    claims = json(parts[1]);
  } catch {
    throw new ReturnTokenError("Malformed token");
  }
  const alg = header.alg ?? "";
  // Only the two algorithms Canva uses; "none" and symmetric algorithms are never accepted.
  if (alg !== "RS256" && alg !== "ES256") throw new ReturnTokenError("Unsupported token algorithm");
  const kty = alg === "RS256" ? "RSA" : "EC";
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as Uint8Array<ArrayBuffer>;
  const signature = decode(parts[2]);

  let valid = false;
  for (const force of [false, true]) {
    const candidates = (await canvaKeys(force)).filter((k) => k.kty === kty && (!k.alg || k.alg === alg) && (!header.kid || k.kid === header.kid));
    for (const jwk of candidates) {
      try {
        if (await verifySignature(alg, jwk, data, signature)) valid = true;
      } catch (error) {
        if (error instanceof ReturnTokenError) throw error;
      }
      if (valid) break;
    }
    if (valid) break;
  }
  if (!valid) throw new ReturnTokenError("Bad token signature");

  if (claims.type !== "rti") throw new ReturnTokenError("Wrong token type");
  if (claims.aud !== canvaConfig().clientId) throw new ReturnTokenError("Token is for another app");
  if (typeof claims.nbf === "number" && claims.nbf * 1000 > now + 60_000) throw new ReturnTokenError("Token not valid yet");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) throw new ReturnTokenError("Token expired");
  if (typeof claims.correlation_state !== "string" || !claims.correlation_state) throw new ReturnTokenError("No state in token");
  return claims;
}

/** The query value is the JWT; accept it also when wrapped in one more layer of base64url. */
export function unwrapJwt(value: string): string {
  if (value.split(".").length === 3) return value;
  try {
    const inner = new TextDecoder().decode(decode(value));
    if (inner.split(".").length === 3) return inner;
  } catch {}
  return value;
}
