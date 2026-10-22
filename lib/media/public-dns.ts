// Downloads from any public website ("Import from a link", docs/MEDIA.md). A pasted link is the visitor's choice, so a
// host name that looks public can still point at a private address (a DNS record for 10.0.0.1, or the cloud metadata
// address 169.254.169.254). Every hop's name is resolved and each address checked, and on Node the connection is
// made to exactly the addresses that were checked, so a name that changes its answer between the check and the
// connection (DNS rebinding) cannot slip through.
//
// Where BuPulse runs (lib/platform/detect.ts): Netlify Functions and `next start` are Node, where node:dns and
// node:https exist. Cloudflare Workers has no usable DNS lookup, but there fetch itself refuses private addresses
// (`global_fetch_strictly_public` in wrangler.jsonc), so only the name check runs and the platform does the rest.
import "server-only";
import type { LookupAddress, LookupOptions } from "node:dns";
import { currentPlatform } from "@/lib/platform/detect";
import { isBlockedHost } from "@/lib/webhooks/core";
import { SafeFetchError, type Fetcher } from "./safe-fetch";

const DNS_TIMEOUT_MS = 5_000;
/** Some hosts (Wikimedia among them) refuse requests without a User-Agent that says who is asking. */
export const LINK_USER_AGENT = "BuPulse-MediaImport/1.0 (+https://bupulse.com)";

/** False for private, loopback, link-local, carrier-grade NAT, multicast and reserved addresses (v4 and v6). */
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase();
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address inside: refused rather than unpacked.
  if (ip.startsWith("64:ff9b:") || ip.startsWith("2002:")) return false;
  return !isBlockedHost(ip.includes(":") ? `[${ip}]` : ip);
}

const blocked = () => new SafeFetchError("That link points to a private or local address, which BuPulse can't open.", "blocked");

/** Every address `hostname` resolves to, after checking that all of them are public. Throws a "blocked" SafeFetchError otherwise. */
export async function resolvePublic(hostname: string): Promise<LookupAddress[]> {
  if (isBlockedHost(hostname)) throw blocked();
  const { lookup } = await import("node:dns/promises");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: LookupAddress[];
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SafeFetchError("The download took too long.", "timeout")), DNS_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError("BuPulse could not find that website. Check the link and try again.", "network");
  } finally {
    clearTimeout(timer);
  }
  // One private address among public ones is enough to refuse: the connection could pick any of them.
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) throw blocked();
  return addresses;
}

/** The host check safeFetchResponse runs on every hop, before any request is sent. */
export async function hostIsPublic(hostname: string): Promise<boolean> {
  if (currentPlatform() === "cloudflare") return !isBlockedHost(hostname);
  await resolvePublic(hostname);
  return true;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** node:https's `lookup`: the connection only ever goes to addresses resolvePublic accepted. */
export function publicLookup(hostname: string, options: LookupOptions | number | undefined, callback: LookupCallback): void {
  const opts = typeof options === "object" && options ? options : {};
  const family = typeof options === "number" ? options : opts.family === "IPv4" ? 4 : opts.family === "IPv6" ? 6 : opts.family;
  resolvePublic(hostname).then(
    (all) => {
      const list = family === 4 || family === 6 ? all.filter((a) => a.family === family) : all;
      if (list.length === 0) return callback(Object.assign(new Error(`No public address for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
      if (opts.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    },
    (error: Error) => callback(Object.assign(new Error(error.message), { code: error instanceof SafeFetchError && error.code === "blocked" ? "EBLOCKED" : "ENOTFOUND" }), "", 0),
  );
}

/**
 * A GET over node:https that connects through publicLookup, answered as a web Response (redirects are not followed:
 * safeFetchResponse checks each one). No Accept-Encoding is sent, so the size limit counts the real file.
 */
export const pinnedFetch: Fetcher = async (url, init) => {
  const https = await import("node:https");
  const { Readable } = await import("node:stream");
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(url, { method: "GET", headers: init.headers, signal: init.signal, lookup: publicLookup as never }, (res) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      const status = res.statusCode ?? 502;
      if (status < 200 || status > 599 || [204, 205, 304].includes(status)) {
        res.resume();
        return resolve(new Response(null, { status: status < 200 || status > 599 ? 502 : status, headers }));
      }
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EBLOCKED") reject(blocked());
      else reject(error);
    });
    request.end();
  });
};

/** The safeFetch options for a link to any public website, for the host BuPulse runs on. */
export function publicFetchOptions(): { allowHost: (host: string) => boolean; checkHost: (host: string) => Promise<boolean>; fetcher?: Fetcher; hopHeaders: Record<string, string> } {
  const node = currentPlatform() !== "cloudflare";
  return { allowHost: (host) => !isBlockedHost(host), checkHost: hostIsPublic, fetcher: node ? pinnedFetch : undefined, hopHeaders: { "User-Agent": LINK_USER_AGENT, Accept: "*/*" } };
}
