export interface MetaSignedPayload {
  user_id: string;
  algorithm?: string;
  issued_at?: number;
}

const MAX_AGE_SECONDS = 24 * 60 * 60;

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Verifies a Meta `signed_request` ("<signature>.<payload>", both base64url) with the app secret
 * (HMAC-SHA256, Web Crypto, constant-time compare) and returns the payload, or null when it is
 * malformed or the signature does not match.
 */
export async function parseSignedRequest(signedRequest: string, appSecret: string, now = Date.now()): Promise<MetaSignedPayload | null> {
  const [signature, payload, ...rest] = signedRequest.split(".");
  if (!signature || !payload || rest.length > 0) return null;
  try {
    const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await globalThis.crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as MetaSignedPayload;
    // Replay protection: a request older than a day is not one Meta just sent.
    if (typeof data.issued_at === "number" && now / 1000 - data.issued_at > MAX_AGE_SECONDS) return null;
    if (data.algorithm && data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return typeof data.user_id === "string" && data.user_id ? data : null;
  } catch {
    return null;
  }
}

/** The app secrets a signed_request may be signed with: the Instagram app, the Facebook app, or the older shared one. */
export function metaSecrets(): string[] {
  return [process.env.FACEBOOK_APP_SECRET, process.env.INSTAGRAM_APP_SECRET, process.env.META_APP_SECRET].filter((s): s is string => !!s);
}

/** Verifies against every configured secret; Meta signs with the secret of the app the user removed. */
export async function verifyMetaRequest(signedRequest: string): Promise<MetaSignedPayload | null> {
  for (const secret of metaSecrets()) {
    const payload = await parseSignedRequest(signedRequest, secret);
    if (payload) return payload;
  }
  return null;
}
