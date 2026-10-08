// Outgoing webhooks (shared by every event): signing, the SSRF guard and one delivery run with quick retries.
//
// Every request is a POST with a JSON body and these headers:
//   X-BuPulse-Event:     the event name (lead.created, content.generated, post.published, post.failed, webhook.test)
//   X-BuPulse-Signature: t=<unix seconds>,v1=<hex>
// where v1 = HMAC-SHA256(secret, `${t}.${body}`), the body being the exact raw bytes sent.
// Receivers should recompute v1, compare in constant time and reject timestamps older than 5 minutes.
// The secret (whsec_...) is shown once on Connectors > Webhooks. A 2xx answer means delivered; timeouts,
// 429 and 5xx are retried (3 attempts, after 1 s and 4 s), then once an hour for up to 24 hours. Delivery is at
// least once: if a slow success is not seen in time the same event can arrive again with a new t. Receivers
// should dedupe on lead.id. Redirects are followed only to safe https URLs.

// Worst case 3 x 5 s + 1 s + 4 s = 20 s, inside the ~30 s Cloudflare gives a waitUntil task after the response.
// A delivery that still fails stays "pending" in WebhookDelivery and the hourly cron retries it for 24 hours (lib/webhooks/retry.ts).
export const WEBHOOK_TIMEOUT_MS = 5_000;
export const WEBHOOK_RETRY_DELAYS_MS = [1_000, 4_000];
const MAX_REDIRECTS = 3;

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** The X-BuPulse-Signature header value for a body. */
export async function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

/** What a receiver does: true when the header matches the body and is at most `toleranceSeconds` old. */
export async function verifyWebhookSignature(secret: string, body: string, header: string, toleranceSeconds = 300, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

/** A new signing secret, shown to the owner once. */
export function generateWebhookSecret(): string {
  return `whsec_${toHex(crypto.getRandomValues(new Uint8Array(24)).buffer)}`;
}

// ---- SSRF guard ----------------------------------------------------------------------------------------------

function ipv4Blocked(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 and documentation ranges
    (a === 198 && (b === 18 || b === 19))
  );
}

/** True for localhost, internal names and private, loopback, link-local or reserved IP literals (v4 and v6). */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host.includes(":")) {
    // IPv6. The URL parser has already compressed and lower-cased it.
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      return ipv4Blocked(hi >> 8, hi & 255);
    }
    const dotted = host.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (dotted) return ipv4Blocked(Number(dotted[1]), Number(dotted[2]));
    if (host === "::" || host === "::1") return true;
    const first = parseInt(host.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    return ipv4Blocked(a, b);
  }
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/.test(host)) return true; // odd numeric forms the parser did not normalise
  if (!host.includes(".")) return true; // "localhost", "intranet", "metadata"
  return /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example)$/.test(host);
}

/**
 * TEST ONLY: lets browser and end-to-end checks deliver to a listener on this computer. It needs BOTH
 * BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS=1 and a site address (NEXT_PUBLIC_SITE_URL) that is itself localhost, so a
 * production deployment (bupulse.com) ignores it even if the variable is set by mistake. Only 127.0.0.1 and
 * localhost are allowed, never other private addresses.
 */
export function localTestAllowed(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  if (env.BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS !== "1") return false;
  let site: URL;
  try {
    site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
  } catch {
    return false;
  }
  if (site.hostname !== "localhost" && site.hostname !== "127.0.0.1") return false;
  return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** The rules for a webhook URL: https only, port 443, no credentials, no private or local targets. */
export function checkWebhookUrl(input: string, options: { allowLocalTest?: boolean } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: "That does not look like a web address. Use the full address, starting with https://." };
  }
  // The test-only local allowance is opt-in per call: only webhook delivery asks for it. Store and image fetchers
  // share this guard and must never get it.
  if (options.allowLocalTest && localTestAllowed(url)) return { ok: true, url };
  if (url.protocol !== "https:") return { ok: false, error: "The address must start with https://." };
  if (url.username || url.password) return { ok: false, error: "Remove the username and password from the address." };
  if (url.port && url.port !== "443") return { ok: false, error: "Use the standard https port (443)." };
  if (isBlockedHost(url.hostname)) return { ok: false, error: "That address points to a private or local network, which is not allowed." };
  if (url.toString().length > 500) return { ok: false, error: "That address is too long." };
  return { ok: true, url };
}

// ---- Delivery ------------------------------------------------------------------------------------------------

/** `retryable`: the last failure looked temporary (timeout, 429, 5xx), so trying again later makes sense. */
export type DeliveryResult = { ok: boolean; status?: number; attempts: number; error?: string; retryable: boolean };

type DeliverOptions = {
  url: string;
  secret: string;
  event: string;
  body: string;
  retryDelaysMs?: number[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

/** One attempt. Follows redirects by hand so each hop passes the same guard. */
async function attempt(opts: DeliverOptions): Promise<{ ok: boolean; retry: boolean; status?: number; error?: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let target = checkWebhookUrl(opts.url, { allowLocalTest: true }); // redirects below get no allowance
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!target.ok) return { ok: false, retry: false, error: target.error };
    const signature = await signWebhook(opts.secret, opts.body);
    let response: Response;
    try {
      response = await doFetch(target.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "user-agent": "BuPulse-Webhooks/1.0",
          "x-bupulse-event": opts.event,
          "x-bupulse-signature": signature,
        },
        body: opts.body,
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { ok: false, retry: true, error: timedOut ? "The server took too long to answer." : "Could not connect to the server." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, retry: false, status: response.status, error: "Redirect without a location." };
      let next: string;
      try {
        next = new URL(location, target.url).toString();
      } catch {
        return { ok: false, retry: false, status: response.status, error: "Invalid redirect." };
      }
      target = checkWebhookUrl(next);
      continue; // 307-style: the same POST goes to the new place, if it is safe
    }
    if (response.ok) return { ok: true, retry: false, status: response.status };
    return { ok: false, retry: response.status >= 500 || response.status === 429 || response.status === 408, status: response.status, error: `The server answered ${response.status}.` };
  }
  return { ok: false, retry: false, error: "Too many redirects." };
}

/** POSTs the body, retrying transient failures with back-off. Never throws. */
export async function deliverWebhook(opts: DeliverOptions): Promise<DeliveryResult> {
  const delays = opts.retryDelaysMs ?? WEBHOOK_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: Awaited<ReturnType<typeof attempt>> = { ok: false, retry: false };
  for (let i = 0; i <= delays.length; i++) {
    last = await attempt(opts);
    if (last.ok || !last.retry || i === delays.length) return { ok: last.ok, status: last.status, error: last.error, attempts: i + 1, retryable: last.retry };
    await sleep(delays[i]);
  }
  return { ok: false, attempts: delays.length + 1, error: last.error, retryable: last.retry };
}

