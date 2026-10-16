// The "Use my location" result: a short-lived cookie holding a country code, signed so a visitor cannot write
// their own (an HMAC-SHA256 key derived from ENCRYPTION_KEY, not the key itself). Web Crypto only, so it runs on
// Cloudflare Workers and Node alike. The cookie holds the country and the time it was issued, never coordinates.

export const GEO_COOKIE = "bp-geo";
export const GEO_MAX_AGE_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();
const CONTEXT = "bupulse:geo-cookie:v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** HMAC key = HMAC-SHA256(ENCRYPTION_KEY, context). Null when ENCRYPTION_KEY is not set (nothing can be signed or trusted). */
async function signingKey(): Promise<CryptoKey | null> {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) return null;
  const root = await globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await globalThis.crypto.subtle.sign("HMAC", root, encoder.encode(CONTEXT));
  return globalThis.crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** `<COUNTRY>.<issued-at seconds>.<signature>`, or null when no key is configured. */
export async function signGeoCookie(country: string, nowMs = Date.now()): Promise<string | null> {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const key = await signingKey();
  if (!key) return null;
  const payload = `${code}.${Math.floor(nowMs / 1000)}`;
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/** The country in a genuine, unexpired cookie; null for anything else (missing, tampered, expired, from the future). */
export async function verifyGeoCookie(value: string | null | undefined, nowMs = Date.now()): Promise<string | null> {
  const m = /^([A-Z]{2})\.(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/.exec(value ?? "");
  if (!m) return null;
  const issued = Number(m[2]) * 1000;
  const age = nowMs - issued;
  if (age < -60_000 || age > GEO_MAX_AGE_SECONDS * 1000) return null;
  const sig = fromBase64Url(m[3]);
  const key = await signingKey();
  if (!sig || !key) return null;
  const ok = await globalThis.crypto.subtle.verify("HMAC", key, sig, encoder.encode(`${m[1]}.${m[2]}`));
  return ok ? m[1] : null;
}
