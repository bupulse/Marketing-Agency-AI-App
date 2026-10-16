import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { base64UrlDecode, base64UrlEncode, encryptPayload, MAX_PAYLOAD_BYTES, sendWebPush, vapidAuthorization, vapidKeysWellFormed } from "@/lib/push/web-push";

// The encryption is checked by decrypting with node:crypto, step by step from RFC 8291 / RFC 8188 (an implementation
// independent of the WebCrypto one under test). It was also cross-checked once against http_ece, the reference
// implementation by the author of RFC 8188.

function browser() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, target: { endpoint: "https://fcm.googleapis.com/fcm/send/abc:def", p256dh: base64UrlEncode(ecdh.getPublicKey()), auth: base64UrlEncode(auth) } };
}

function serverKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: base64UrlEncode(ecdh.getPublicKey()), privateKey: base64UrlEncode(ecdh.getPrivateKey()), subject: "mailto:office@bupulse.com", raw: ecdh.getPublicKey() };
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));

/** The browser's side: RFC 8291 decryption with the subscription's private key. */
function decrypt(body: Uint8Array, ua: ReturnType<typeof browser>) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const cipher = buf.subarray(21 + idlen);
  const secret = ua.ecdh.computeSecret(asPublic);
  const ikm = hkdf(ua.auth, secret, Buffer.concat([Buffer.from("WebPush: info\0"), ua.ecdh.getPublicKey(), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  return { rs, idlen, delimiter: plain[plain.length - 1], text: plain.subarray(0, plain.length - 1).toString("utf8") };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Web Push encryption (aes128gcm)", () => {
  it("the browser can decrypt what we send", async () => {
    const ua = browser();
    const message = JSON.stringify({ title: "New lead: Jane Uwase", body: "Do you have the Galaxy A15 in blue? ✓", url: "https://bupulse.com/dashboard/leads/l1" });
    const out = decrypt(await encryptPayload(ua.target, new TextEncoder().encode(message)), ua);
    expect(out).toEqual({ rs: 4096, idlen: 65, delimiter: 2, text: message });
  });

  it("uses a fresh key and salt for every message", async () => {
    const ua = browser();
    const payload = new TextEncoder().encode("same");
    const [a, b] = await Promise.all([encryptPayload(ua.target, payload), encryptPayload(ua.target, payload)]);
    expect(Buffer.from(a.subarray(0, 86)).equals(Buffer.from(b.subarray(0, 86)))).toBe(false);
  });

  it("refuses a payload too big for the push services", async () => {
    await expect(encryptPayload(browser().target, new Uint8Array(MAX_PAYLOAD_BYTES + 1))).rejects.toThrow(/over/);
  });
});

describe("VAPID", () => {
  it("signs an ES256 token for the push service's origin that verifies with the public key", async () => {
    const keys = serverKeys();
    const now = Date.UTC(2026, 9, 14, 12);
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, now);
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(base64UrlDecode(h)).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(base64UrlDecode(c)).toString());
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 60 * 60, sub: "mailto:office@bupulse.com" });
    const publicKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: base64UrlEncode(keys.raw.subarray(1, 33)), y: base64UrlEncode(keys.raw.subarray(33)) }, format: "jwk" });
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(base64UrlDecode(s)))).toBe(true);
  });

  it("knows a well-formed key pair", () => {
    const keys = serverKeys();
    expect(vapidKeysWellFormed(keys.publicKey, keys.privateKey)).toBe(true);
    expect(vapidKeysWellFormed(keys.privateKey, keys.privateKey)).toBe(false);
    expect(vapidKeysWellFormed(keys.publicKey, "short")).toBe(false);
  });
});

describe("sendWebPush", () => {
  it("posts the encrypted body with the Web Push headers and says when the subscription is gone", async () => {
    const ua = browser();
    const keys = serverKeys();
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendWebPush(ua.target, { title: "Hi" }, keys)).toEqual({ ok: true, status: 201, gone: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string>; body: Uint8Array }];
    expect(url).toBe(ua.target.endpoint);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" });
    expect(init.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(decrypt(init.body, ua).text).toBe('{"title":"Hi"}');

    for (const status of [404, 410]) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      expect(await sendWebPush(ua.target, "x", keys)).toEqual({ ok: false, status, gone: true });
    }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await sendWebPush(ua.target, "x", keys)).toEqual({ ok: false, status: 500, gone: false });
  });
});
