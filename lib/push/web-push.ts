// Web Push without a library: VAPID (RFC 8292) and the aes128gcm message encryption of RFC 8291 / RFC 8188, on
// WebCrypto only. The web-push package needs Node's crypto and https modules; this runs the same in Node, on Netlify
// and in the Cloudflare Worker, and adds a few KB to the Worker instead of a dependency tree. Pure: no database, no
// environment reads (lib/push/service.ts does those).

/** A browser's subscription, as PushSubscription.toJSON() gives it: where to send, and its two public keys. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/** The application server keys (base64url): the uncompressed P-256 public key, its 32-byte private scalar, and a contact. */
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushResult = { ok: boolean; status: number; /** The push service says the subscription no longer exists. */ gone: boolean };

/** Push services accept 4096 bytes of encrypted body; the record overhead is 103 bytes, so stay well under. */
export const MAX_PAYLOAD_BYTES = 3000;
const RECORD_SIZE = 4096;

type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Bytes {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** HKDF-SHA-256 extract and expand in one step. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

function publicKeyBytes(publicKey: string): Bytes {
  const bytes = base64UrlDecode(publicKey);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("The VAPID public key must be an uncompressed P-256 key (65 bytes, base64url).");
  return bytes;
}

/** True when the pair is well formed: a 65-byte uncompressed public key and a 32-byte private key, base64url. */
export function vapidKeysWellFormed(publicKey: string, privateKey: string): boolean {
  try {
    publicKeyBytes(publicKey);
    return base64UrlDecode(privateKey).length === 32;
  } catch {
    return false;
  }
}

/** The Authorization header for one push service: `vapid t=<ES256 JWT>, k=<public key>` (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now(), ttlSeconds = 12 * 60 * 60): Promise<string> {
  const pub = publicKeyBytes(keys.publicKey);
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: base64UrlEncode(pub.subarray(1, 33)), y: base64UrlEncode(pub.subarray(33, 65)), d: keys.privateKey };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (value: object) => base64UrlEncode(enc.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + ttlSeconds, sub: keys.subject })}`;
  // WebCrypto signs ECDSA as r||s (64 bytes), which is exactly the JWS form of ES256.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${keys.publicKey}`;
}

/**
 * Encrypts a payload for one subscription (RFC 8291, aes128gcm): an ephemeral ECDH key with the browser's key, mixed
 * with its auth secret, gives the content key and nonce; the body is the RFC 8188 header (salt, record size, our
 * public key) and one record. `salt` and `serverKeys` are for tests; they are random otherwise.
 */
export async function encryptPayload(target: Pick<PushTarget, "p256dh" | "auth">, payload: Uint8Array, opts: { salt?: Bytes; serverKeys?: CryptoKeyPair } = {}): Promise<Bytes> {
  if (payload.length > MAX_PAYLOAD_BYTES) throw new Error(`Push payload is over ${MAX_PAYLOAD_BYTES} bytes.`);
  const uaPublic = base64UrlDecode(target.p256dh);
  const authSecret = base64UrlDecode(target.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const serverKeys = opts.serverKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the payload, then the 0x02 delimiter that marks the last record (no padding).
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, record);
}

/** Sends one push message. Throws only on bad keys or a network failure; a refusal comes back as `ok: false`. */
export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; timeoutMs?: number } = {},
): Promise<PushResult> {
  const body = await encryptPayload(target, enc.encode(typeof payload === "string" ? payload : JSON.stringify(payload)));
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttlSeconds ?? 24 * 60 * 60),
      Urgency: opts.urgency ?? "high",
    },
    body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
  });
  // The body is not needed; drain it so the connection is released.
  await response.arrayBuffer().catch(() => undefined);
  return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
}
