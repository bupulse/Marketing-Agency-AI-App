// AES-256-GCM for stored third-party secrets (OAuth tokens, users' own Composio keys).
// Uses Web Crypto, so it runs on Cloudflare Workers and Node alike.
//
// Format: v1:<key id>:<iv base64>:<ciphertext base64>
// Keys: ENCRYPTION_KEY is the current key and ENCRYPTION_KEY_ID names it (default "1").
// To rotate, set a new ENCRYPTION_KEY_ID, put the new key in ENCRYPTION_KEY and keep the
// old one as ENCRYPTION_KEY_<old id>. Old payloads still decrypt; re-encrypt them lazily.

const VERSION = "v1";
const DEFAULT_KEY_ID = "1";
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function currentKeyId(): string {
  return process.env.ENCRYPTION_KEY_ID || DEFAULT_KEY_ID;
}

function keyMaterial(keyId: string): string {
  const name =
    keyId === currentKeyId() ? "ENCRYPTION_KEY" : `ENCRYPTION_KEY_${keyId}`;
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function importKey(keyId: string): Promise<CryptoKey> {
  const raw = fromBase64(keyMaterial(keyId));
  if (raw.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (base64)");
  }
  return globalThis.crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(plaintext: string): Promise<string> {
  const keyId = currentKeyId();
  const key = await importKey(keyId);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return [VERSION, keyId, toBase64(iv), toBase64(new Uint8Array(ciphertext))].join(
    ":",
  );
}

export async function decrypt(payload: string): Promise<string> {
  const [version, keyId, iv, ciphertext, ...rest] = payload.split(":");
  if (version !== VERSION || !keyId || !iv || !ciphertext || rest.length) {
    throw new Error("Unsupported encrypted payload");
  }
  const key = await importKey(keyId);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  );
  return decoder.decode(plaintext);
}

// True when the payload was encrypted with a key other than the current one.
export function needsReencryption(payload: string): boolean {
  return payload.split(":")[1] !== currentKeyId();
}
