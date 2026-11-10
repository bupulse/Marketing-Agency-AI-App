// The company's website on every post (the owner's decision of 10 November 2026). Instagram, Facebook and TikTok
// captions do not make links clickable (or bury them), so they get "Link in bio" in the post's language; LinkedIn and
// every other app get the address itself, which they turn into a link. Added when the post goes out (and in the
// "time to post" reminder), so every post gets it however it was made: the day's run, a rewrite, or typed by hand.
// Pure.
import type { Network } from "@/lib/social/types";

/** The apps where a link in the caption is not clickable: the caption points to the profile's bio instead. */
export const LINK_IN_BIO_NETWORKS: readonly Network[] = ["instagram", "facebook", "tiktok"];

/** "Link in bio" in the content languages BuPulse writes in most; English for the rest. */
const LINK_IN_BIO: Record<string, string> = {
  Kinyarwanda: "🔗 Link iri muri bio",
  French: "🔗 Lien dans la bio",
  Swahili: "🔗 Kiungo kiko kwenye bio",
  Spanish: "🔗 Enlace en la bio",
  Portuguese: "🔗 Link na bio",
};
const LINK_IN_BIO_DEFAULT = "🔗 Link in bio";

/** Any wording of "link in bio" already in a caption (the owner or the writer put it there). */
const MENTIONS_BIO = /\b(link|lien|enlace|kiungo)\b[^\n]{0,20}\bbio\b|\bbio\b[^\n]{0,10}\blink\b/i;

/** The website as people type it: no https://, no www., no trailing slash ("bupulse.com"). Null when there is none. */
export function displaySite(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  const bare = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
  return bare && /\.[a-z]{2,}/i.test(bare) && !/\s/.test(bare) ? bare : null;
}

/** The line added to a post on this app, or null when the business has no website. */
export function siteLine(network: string, website: string | null | undefined, contentLanguage?: string | null): string | null {
  const site = displaySite(website);
  if (!site) return null;
  if ((LINK_IN_BIO_NETWORKS as readonly string[]).includes(network)) return LINK_IN_BIO[contentLanguage ?? ""] ?? LINK_IN_BIO_DEFAULT;
  return `https://${site}`;
}

/**
 * The caption with its website line at the end. Unchanged when the business has no website, when the caption already
 * has the address (or, on Instagram, Facebook and TikTok, already says the link is in the bio), or when the line would
 * take the post past the app's limit (`maxLength`, counted with the hashtags in `reserved`).
 */
export function withSiteLine(text: string, network: string, website: string | null | undefined, contentLanguage?: string | null, limits: { maxLength?: number; reserved?: number } = {}): string {
  const line = siteLine(network, website, contentLanguage);
  if (!line) return text;
  const site = displaySite(website)!.toLowerCase();
  const body = text.trim();
  if (body.toLowerCase().includes(site)) return text;
  if ((LINK_IN_BIO_NETWORKS as readonly string[]).includes(network) && MENTIONS_BIO.test(body)) return text;
  const next = body ? `${body}\n\n${line}` : line;
  if (limits.maxLength && next.length + (limits.reserved ?? 0) > limits.maxLength) return text;
  return next;
}
