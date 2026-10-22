// Server-side downloads from addresses a third party gave us (Dropbox direct links, Drive media, a pasted link).
// Only https on allow-listed hosts, every redirect re-checked, bounded in size and time. Uses fetch and
// web streams only, so it runs on Cloudflare Workers; a link to any website adds a DNS check and a connection pinned
// to the checked addresses on Node (lib/media/public-dns.ts) through `checkHost` and `fetcher`.

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

/** Makes one request; redirects come back as they are (safeFetchResponse follows them by hand). */
export type Fetcher = (url: URL, init: { headers?: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

type Options = {
  allowHost: HostRule;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Sent to the first host only (a token). */
  headers?: Record<string, string>;
  /** Sent on every hop (a User-Agent). */
  hopHeaders?: Record<string, string>;
  /** Runs on every hop's host name before it is requested (a DNS check); false refuses the address. */
  checkHost?: (hostname: string) => Promise<boolean>;
  /** Instead of the global fetch. */
  fetcher?: Fetcher;
};

/** Reads the body, refusing it past `maxBytes` (by its Content-Length first, then as it streams). */
export async function readCapped(response: Response, maxBytes: number, tooBig: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new SafeFetchError(tooBig, "too_big");
  const reader = response.body?.getReader();
  if (!reader) throw new SafeFetchError("The file could not be downloaded.", "network");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new SafeFetchError("The download took too long.", "timeout");
      throw new SafeFetchError("The file could not be downloaded.", "network");
    }
    const { done, value } = chunk;
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
  const { allowHost, timeoutMs = 30_000, maxRedirects = 3, headers, hopHeaders, checkHost, fetcher } = options;
  const deadline = Date.now() + timeoutMs;
  let url = allowedUrl(value, allowHost);
  let hop = 0;
  while (url) {
    const left = deadline - Date.now();
    if (left <= 0) throw new SafeFetchError("The download took too long.", "timeout");
    let response: Response;
    try {
      if (checkHost && !(await checkHost(url.hostname))) break;
      const sent = hop === 0 && headers ? { ...hopHeaders, ...headers } : hopHeaders;
      const signal = AbortSignal.timeout(left);
      response = fetcher ? await fetcher(url, { headers: sent, signal }) : await fetch(url, { redirect: "manual", headers: sent, signal });
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
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
