// Reading a handed-in post link (docs/CREATOR_CAMPAIGNS.md, check 1). The link alone never proves anything: it only
// says which post to look for on the creator's connected account (resolve.ts). Short share links (vm.tiktok.com,
// tiktok.com/t/, fb.watch, facebook.com/share/, instagram.com/share/) are followed to the post's own address first,
// only on these hosts.

import type { CreatorNetwork } from "../describe";

export type ParsedLink = {
  network: CreatorNetwork;
  url: string;
  /** A share link that must be followed before it names the post. */
  short: boolean;
  /** Instagram: the post's shortcode (/p/<code>, /reel/<code>). */
  shortcode?: string;
  /** TikTok: the video id (/@user/video/<id>). */
  videoId?: string;
  /** Facebook: the ids in the link (story_fbid, /posts/<id>, /reel/<id>, pfbid…), matched against the Page's posts. */
  ids: string[];
};

const HOSTS: Record<CreatorNetwork, RegExp> = {
  instagram: /^(www\.|m\.)?(instagram\.com|instagr\.am)$/,
  facebook: /^(www\.|m\.|web\.|mbasic\.|business\.)?(facebook\.com|fb\.com|fb\.watch)$/,
  tiktok: /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/,
};

/** Facebook ids in a link or a permalink: long numbers and pfbid… tokens, plus each side of "<page>_<post>". */
export function facebookIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/pfbid[0-9A-Za-z]{10,}/g)) out.add(m[0]);
  for (const m of text.matchAll(/\d{6,}/g)) out.add(m[0]);
  return [...out];
}

/** The network a link belongs to, from its host (null: not a link of a campaign network). */
export function networkOfLink(raw: string): CreatorNetwork | null {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    for (const [network, pattern] of Object.entries(HOSTS)) if (pattern.test(host)) return network as CreatorNetwork;
  } catch {}
  return null;
}

/** What a link names, or null when it is not a post link of `network`. */
export function parsePostLink(network: CreatorNetwork, raw: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS[network].test(host)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  const clean = `https://${host}${url.pathname}${network === "facebook" ? url.search : ""}`;

  if (network === "instagram") {
    if (/^\/share\//.test(path)) return { network, url: clean, short: true, ids: [] };
    const m = /^(?:\/[A-Za-z0-9._]+)?\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(path);
    return m ? { network, url: clean, short: false, shortcode: m[1], ids: [] } : null;
  }
  if (network === "tiktok") {
    if (/^(vm|vt)\./.test(host) || /^\/t\/[A-Za-z0-9]+/.test(path)) return { network, url: clean, short: true, ids: [] };
    const m = /^\/@[^/]+\/(?:video|photo)\/(\d{8,})/.exec(path) ?? /^\/v\/(\d{8,})(?:\.html)?/.exec(path);
    return m ? { network, url: clean, short: false, videoId: m[1], ids: [] } : null;
  }
  if (host.endsWith("fb.watch") || /^\/share\//.test(path)) return { network, url: clean, short: true, ids: [] };
  const ids = facebookIds(`${url.pathname}?${url.searchParams.toString()}`);
  return ids.length ? { network, url: clean, short: false, ids } : null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Follows a share link to the post's own address (at most 4 hops, every hop on a network host), then reads it again.
 * Returns null when it cannot be followed or does not end on a post.
 */
export async function expandShortLink(link: ParsedLink, fetchImpl: FetchLike = fetch): Promise<ParsedLink | null> {
  let current = link.url;
  for (let hop = 0; hop < 4; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(current, { method: "GET", redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; BuPulse/1.0)" }, signal: AbortSignal.timeout(8000) });
    } catch {
      return null;
    }
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return null;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    if (!HOSTS[link.network].test(next.hostname.toLowerCase())) return null;
    const parsed = parsePostLink(link.network, next.toString());
    if (parsed && !parsed.short) return parsed;
    current = next.toString();
  }
  return null;
}

/** Instagram: the shortcode in a permalink (https://www.instagram.com/reel/<code>/). */
export function shortcodeOf(permalink: string | null | undefined): string | null {
  return permalink ? (/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(permalink)?.[1] ?? null) : null;
}
