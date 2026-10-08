// Server-side downloads from addresses a third party gave us (Dropbox direct links, Drive media).
// Only https on allow-listed hosts, every redirect re-checked, bounded in size and time. Uses fetch and
// web streams only, so it runs on Cloudflare Workers.

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public code: "blocked" | "too_big" | "timeout" | "http" | "network",
    public status?: number,
  ) {
    super(message);
  }
}

export type HostRule = (hostname: string) => boolean;

/** A host rule for exact names and their subdomains: `hostIn("dropbox.com")` accepts www.dropbox.com too. */
export const hostIn =
  (...domains: string[]): HostRule =>
  (host) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`));

/** Dropbox serves Chooser direct links and their redirects from these. */
export const isDropboxHost = hostIn("dropbox.com", "dropboxusercontent.com");
export const isGoogleApiHost = hostIn("googleapis.com", "googleusercontent.com");

/** Parses `value` and returns the URL when it is a plain https address on an allowed host; otherwise null. */
export function allowedUrl(value: string, allowHost: HostRule): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  // IP literals (v4 and v6) are never a provider's content host.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  return allowHost(host) ? url : null;
}

type Options = {
  allowHost: HostRule;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
};

async function readCapped(response: Response, maxBytes: number, tooBig: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new SafeFetchError(tooBig, "too_big");
  const reader = response.body?.getReader();
  if (!reader) throw new SafeFetchError("The file could not be downloaded.", "network");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError(tooBig, "too_big");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Follows redirects by hand, re-checking each hop. Request headers (a token) go to the first host only. */
export async function safeFetchResponse(value: string, options: Options): Promise<Response> {
  const { allowHost, timeoutMs = 30_000, maxRedirects = 3, headers } = options;
  const deadline = Date.now() + timeoutMs;
  let url = allowedUrl(value, allowHost);
  let hop = 0;
  while (url) {
    const left = deadline - Date.now();
    if (left <= 0) throw new SafeFetchError("The download took too long.", "timeout");
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", headers: hop === 0 ? headers : undefined, signal: AbortSignal.timeout(left) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new SafeFetchError("The download took too long.", "timeout");
      throw new SafeFetchError("The file could not be downloaded.", "network");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location || hop >= maxRedirects) throw new SafeFetchError("The file could not be downloaded.", "blocked");
      url = allowedUrl(new URL(location, url).toString(), allowHost);
      hop += 1;
      continue;
    }
    return response;
  }
  throw new SafeFetchError("That download address is not allowed.", "blocked");
}

/** Downloads `value` into memory under the rules above. */
export async function safeFetchBytes(value: string, options: Options, tooBigMessage = "The file is too large."): Promise<Uint8Array> {
  const response = await safeFetchResponse(value, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SafeFetchError("The file could not be downloaded.", "http", response.status);
  }
  return readCapped(response, options.maxBytes, tooBigMessage);
}
