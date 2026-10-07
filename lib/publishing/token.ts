import "server-only";

// Signed links for the "I posted it" button in reminder emails. The link works without signing in
// (people open it on their phone after posting), so it carries a signature instead of a session.

const DAY_MS = 24 * 60 * 60 * 1000;
export const MARK_POSTED_DAYS = 30;

const encoder = new TextEncoder();

function secret(): string {
  const key = process.env.ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!key) throw new Error("ENCRYPTION_KEY is not set");
  return key;
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A key derived (HKDF) from ENCRYPTION_KEY for this one purpose, so no extra secret is needed and the raw key is never used to sign. */
async function signingKey(): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret()), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode("bupulse:mark-posted:v1") },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

async function sign(payload: string): Promise<string> {
  return toBase64Url(await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(payload)));
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createMarkPostedToken(postId: string, now = new Date()): Promise<string> {
  const payload = `${postId}.${Math.floor((now.getTime() + MARK_POSTED_DAYS * DAY_MS) / 1000)}`;
  return `${payload}.${await sign(payload)}`;
}

/** The post id a valid, unexpired token was made for, else null. */
export async function readMarkPostedToken(token: string, now = new Date()): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [postId, expires, signature] = parts;
  if (!postId || !/^\d+$/.test(expires)) return null;
  if (!safeEqual(signature, await sign(`${postId}.${expires}`))) return null;
  if (Number(expires) * 1000 < now.getTime()) return null;
  return postId;
}
