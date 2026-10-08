// SSRF-safe fetching for store data. Reuses the host rules of the lead webhook (lib/leads/webhook.ts):
// https only, port 443, no credentials, no localhost or private/reserved addresses. Redirects are followed by
// hand and every hop is checked again. On Cloudflare Workers `global_fetch_strictly_public` (wrangler.jsonc)
// additionally stops a public name that resolves to a private address.
import { sniffMediaType } from "@/lib/media/rules";
import { checkWebhookUrl, isBlockedHost } from "@/lib/leads/webhook";

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 12_000;
const API_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

/** Hosts Shopify serves product images from. */
export function isShopifyImageHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "cdn.shopify.com" || h.endsWith(".shopifycdn.com") || h.endsWith(".myshopify.com") || h.endsWith(".shopifycloud.com");
}

export type HostRule = (host: string) => boolean;

/** https URL on a public host that passes `rule`, or null. */
export function checkImageUrl(input: string, rule?: HostRule): URL | null {
  const checked = checkWebhookUrl(input);
  if (!checked.ok) return null;
  if (isBlockedHost(checked.url.hostname)) return null;
  if (rule && !rule(checked.url.hostname)) return null;
  return checked.url;
}

export type ImageResult = { ok: true; bytes: Uint8Array<ArrayBuffer>; mimeType: "image/jpeg" | "image/png" | "image/webp" } | { ok: false; reason: string };

async function readCapped(response: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Downloads one product image. The type is decided by the file's first bytes (not the server's header),
 * only JPEG, PNG and WebP are kept, and the size is capped while streaming.
 */
export async function fetchImage(input: string, rule?: HostRule, fetchImpl: typeof fetch = fetch): Promise<ImageResult> {
  const first = checkImageUrl(input, rule);
  if (!first) return { ok: false, reason: "That image address is not allowed." };
  let url: URL = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), headers: { accept: "image/*" } });
    } catch {
      return { ok: false, reason: "The image could not be downloaded." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next: URL | null = location ? checkImageUrl(new URL(location, url).toString(), rule) : null;
      if (!next) return { ok: false, reason: "The image redirected somewhere that is not allowed." };
      url = next;
      continue;
    }
    if (!response.ok) return { ok: false, reason: `The image answered ${response.status}.` };
    const bytes = await readCapped(response, IMAGE_MAX_BYTES).catch(() => null);
    if (!bytes) return { ok: false, reason: "The image is too large." };
    const type = sniffMediaType(bytes);
    if (!type) return { ok: false, reason: "Only JPG, PNG and WebP images are supported." };
    return { ok: true, bytes, mimeType: type };
  }
  return { ok: false, reason: "The image redirected too many times." };
}

/**
 * Calls a store API on a user-supplied address. Redirects to the same host and port are followed (http to https is
 * not allowed because the URL is https already); a redirect to another host is refused so the keys are never sent
 * there.
 */
export async function storeApiFetch(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let current = checkWebhookUrl(url);
  if (!current.ok) throw new Error(current.error);
  const host = current.url.hostname;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current.url.toString(), { ...init, redirect: "manual", signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = checkWebhookUrl(new URL(location, current.url).toString());
    if (!next.ok || next.url.hostname !== host) throw new Error("The store redirected somewhere else, so the request was stopped.");
    current = next;
  }
  throw new Error("The store redirected too many times.");
}
