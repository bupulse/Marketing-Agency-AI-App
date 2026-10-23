// Secrets of the support chat. Web Crypto only, so it runs on Cloudflare Workers and Node alike.
// - The visit token (sent as X-Support-Visit and to the heartbeat RPC): 256 random bits; only its SHA-256 is stored.
// - The visitor's real-time topic `sv:<secret>`: 128 bits, derived from the visitor id with an HMAC key that is itself
//   derived from ENCRYPTION_KEY, so the server can always broadcast to it without storing it. One topic per visitor, so
//   a chat an agent starts reaches a panel that is already open. Each conversation also keeps the hash of its own
//   derived secret (SupportConversation.topicTokenHash, unique).

const encoder = new TextEncoder();
const TOPIC_CONTEXT = "bupulse:support-topic:v1";

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Lower-case hex SHA-256, the same as Postgres' encode(sha256(convert_to(x, 'UTF8')), 'hex') in support_heartbeat. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A cuid-like id made before the row exists (the topic hash needs the conversation id at insert). */
export function newId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `c${[...bytes].map((b) => (b % 36).toString(36)).join("")}${Date.now().toString(36)}`.slice(0, 25);
}

let topicKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function topicSigningKey(): Promise<CryptoKey> {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("ENCRYPTION_KEY is not set (see .env.example): the support chat cannot make real-time topics");
  if (topicKey?.secret !== secret) {
    const key = (async () => {
      const root = await globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const derived = await globalThis.crypto.subtle.sign("HMAC", root, encoder.encode(TOPIC_CONTEXT));
      return globalThis.crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    })();
    topicKey = { secret, key };
  }
  return topicKey.key;
}

/** A derived 128-bit secret for `id` (a conversation id: its topicTokenHash). */
export async function topicSecret(id: string): Promise<string> {
  const sig = await globalThis.crypto.subtle.sign("HMAC", await topicSigningKey(), encoder.encode(id));
  return toBase64Url(new Uint8Array(sig).slice(0, 16));
}

/** The secret part of a visitor's public topic (contract.ts visitorTopic). */
export function visitorTopicSecret(visitorId: string): Promise<string> {
  return topicSecret(`visitor:${visitorId}`);
}
