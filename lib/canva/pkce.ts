import { decrypt, encrypt } from "@/lib/crypto";
import { CANVA_AUTHORIZE_URL, CANVA_SCOPES, canvaConfig } from "./config";

export const OAUTH_COOKIE = "canva_oauth";
const OAUTH_TTL_MS = 10 * 60 * 1000;

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE: 32 random bytes give a 43-character verifier (allowed: 43-128 URL-safe characters). */
export const newCodeVerifier = () => randomToken(32);

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export type OAuthState = { state: string; verifier: string; userId: string; next: string; expiresAt: number };

/**
 * The PKCE verifier must stay secret from the browser, so the pending login lives in an httpOnly cookie
 * sealed with AES-GCM (secret and tamper-proof). It is tied to the user and expires after 10 minutes.
 */
export async function sealOAuthState(data: Omit<OAuthState, "expiresAt">, now = Date.now()): Promise<string> {
  return encrypt(JSON.stringify({ ...data, expiresAt: now + OAUTH_TTL_MS } satisfies OAuthState));
}

/** The pending login, or null when the cookie is missing, forged, expired or not this user's. */
export async function openOAuthState(sealed: string | undefined, userId: string, now = Date.now()): Promise<OAuthState | null> {
  if (!sealed) return null;
  try {
    const data = JSON.parse(await decrypt(sealed)) as OAuthState;
    if (typeof data.state !== "string" || typeof data.verifier !== "string" || data.userId !== userId || data.expiresAt < now) return null;
    return data;
  } catch {
    return null;
  }
}

/** Constant-time string comparison for the state parameter. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function buildAuthorizeUrl(state: string, verifier: string): Promise<string> {
  const { clientId, redirectUri } = canvaConfig();
  const url = new URL(CANVA_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: CANVA_SCOPES.join(" "),
    redirect_uri: redirectUri,
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
