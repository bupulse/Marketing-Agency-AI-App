import { createHmac, timingSafeEqual } from "node:crypto";

export interface MetaSignedPayload {
  user_id: string;
  algorithm?: string;
  issued_at?: number;
}

/**
 * Verifies a Meta `signed_request` ("<signature>.<payload>", both base64url) with the app secret
 * and returns the payload, or null when it is malformed or the signature does not match.
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): MetaSignedPayload | null {
  const [signature, payload, ...rest] = signedRequest.split(".");
  if (!signature || !payload || rest.length > 0) return null;

  const expected = createHmac("sha256", appSecret).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MetaSignedPayload;
    if (data.algorithm && data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return typeof data.user_id === "string" && data.user_id ? data : null;
  } catch {
    return null;
  }
}
