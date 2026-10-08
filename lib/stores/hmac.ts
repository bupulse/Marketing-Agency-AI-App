// HMAC-SHA256 helpers (Web Crypto, so they run on Workers) for Shopify's OAuth and webhook checks.

const encoder = new TextEncoder();

async function sign(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return Array.from(new Uint8Array(await sign(secret, message)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacBase64(secret: string, message: string): Promise<string> {
  let binary = "";
  for (const byte of new Uint8Array(await sign(secret, message))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
