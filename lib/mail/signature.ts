// The signature on POST /api/mail/inbound: the Cloudflare Email Worker (workers/mail-inbound) signs every message it
// hands over with MAIL_INBOUND_SECRET, so nobody else can drop mail into our mailboxes.
//
// Header: X-BuPulse-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<recipient>.<sha256 hex of the body>">
// A signature older or newer than MAX_SKEW_SECONDS is refused (replays); a replay inside that window stores nothing new
// because the Message-ID is unique per mailbox. Web Crypto only, so the same code runs in the Worker and in Node.

export const SIGNATURE_HEADER = "x-bupulse-signature";
export const RECIPIENT_HEADER = "x-bupulse-recipient";
export const MAX_SKEW_SECONDS = 5 * 60;

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(body: ArrayBuffer | Uint8Array): Promise<string> {
  const view = body instanceof Uint8Array ? body : new Uint8Array(body);
  return hex(await crypto.subtle.digest("SHA-256", view as Uint8Array<ArrayBuffer>));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function signInbound(secret: string, recipient: string, body: ArrayBuffer | Uint8Array, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const digest = await sha256Hex(body);
  return `t=${nowSeconds},v1=${await hmacHex(secret, `${nowSeconds}.${recipient.toLowerCase()}.${digest}`)}`;
}

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "no_secret" | "missing" | "malformed" | "stale" | "mismatch" };

export async function verifyInbound(opts: {
  secret: string | undefined;
  header: string | null;
  recipient: string;
  body: ArrayBuffer | Uint8Array;
  nowSeconds?: number;
}): Promise<SignatureCheck> {
  const secret = (opts.secret ?? "").trim();
  if (secret.length < 16) return { ok: false, reason: "no_secret" };
  if (!opts.header) return { ok: false, reason: "missing" };
  const parts = Object.fromEntries(opts.header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v1 = (parts.v1 ?? "").toLowerCase();
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: "malformed" };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  const expected = await hmacHex(secret, `${t}.${opts.recipient.toLowerCase()}.${await sha256Hex(opts.body)}`);
  return sameHex(expected, v1) ? { ok: true } : { ok: false, reason: "mismatch" };
}
