// The spoken calls to action (owner, 11 Nov 2026): the actor still SAYS one at the end (hard rule 2), but it can sound
// like content, not an ad: "click the link in bio", "comment AD and we'll DM you", "save this for later"... The list is
// docs/research/ad-formats.json `ctas` (a test keeps them in step), each with how the actor says it. The CTA is a planned
// choice: the code picks it (rotating, never one of the last ads' CTAs, soft ones for content videos), the brain writes
// the line around it, and the checks accept it as the spoken CTA. Pure.

import type { AdKind } from "./recipes";

export type Cta = {
  id: string;
  /** As in docs/research/ad-formats.json. */
  text: string;
  /** How the actor says it at the end (plain words; the site's name is said "Boo-pulse dot com"). */
  spoken: string;
  /** "soft" sounds like content (save, follow, comment); "direct" asks for the sale (quote, link). */
  tone: "soft" | "direct";
  /** Words that show the line carries this CTA (lower case), for the checks. */
  marks: readonly string[];
};

export const CTAS: readonly Cta[] = [
  { id: "link-in-bio", text: "Click the link in bio", spoken: "Click the link in bio to try BuPulse.", tone: "direct", marks: ["link in bio", "link in my bio", "link in our bio"] },
  { id: "comment-ad", text: "Comment AD and we'll DM you", spoken: "Comment AD and we'll send you the link.", tone: "soft", marks: ["comment ad", "comment bupulse", "comment \"ad\"", "and we'll dm you", "we'll send you the link"] },
  { id: "request-quote", text: "Request a quote", spoken: "Request a quote on BuPulse dot com and we'll set it up.", tone: "direct", marks: ["request a quote", "ask for a quote", "get a quote", "free quote"] },
  { id: "save-this", text: "Save this for later", spoken: "Save this for later.", tone: "soft", marks: ["save this"] },
  { id: "send-this", text: "Send this to someone who posts for a shop", spoken: "Send this to someone who posts for a shop.", tone: "soft", marks: ["send this to"] },
  { id: "follow-next", text: "Follow for the next part", spoken: "Follow for the next part.", tone: "soft", marks: ["follow for"] },
  { id: "whatsapp", text: "Message us on WhatsApp", spoken: "Message us on WhatsApp, the number is in our bio.", tone: "direct", marks: ["whatsapp"] },
  { id: "tap-link", text: "Tap the link, it takes a minute", spoken: "Tap the link, it takes a minute.", tone: "direct", marks: ["tap the link"] },
  { id: "comments-which", text: "Tell me in the comments which one you'd try", spoken: "Tell me in the comments which one you'd try.", tone: "soft", marks: ["in the comments", "tell me in the comments"] },
  { id: "try-it", text: "Try it and tell us what you think", spoken: "Try BuPulse and tell us what you think.", tone: "soft", marks: ["try it and tell", "and tell us what you think"] },
];

const BY_ID = new Map(CTAS.map((c) => [c.id, c]));
export const ctaById = (id: string | null | undefined) => (id ? BY_ID.get(id) : undefined);

/** How many past ads' CTAs are avoided. */
export const RECENT_CTAS = 3;

/**
 * The CTA for a new video: never one of the last RECENT_CTAS used; content videos take soft ones (they must not
 * sound like an ad), ads may take any but lean direct. Deterministic for a given `rng`.
 */
export function pickCta(input: { kind: AdKind; recent: readonly string[]; rng: () => number; preferred?: readonly string[] }): Cta {
  const recent = new Set(input.recent.slice(0, RECENT_CTAS));
  const fits = (c: Cta) => (input.kind === "content" ? c.tone === "soft" : true);
  // A format's own CTAs (from the research) come first when they are free to use.
  const preferred = (input.preferred ?? []).map((id) => BY_ID.get(id)).filter((c): c is Cta => !!c && fits(c) && !recent.has(c.id));
  let pool = preferred.length ? preferred : CTAS.filter((c) => fits(c) && !recent.has(c.id));
  if (!pool.length) pool = CTAS.filter(fits);
  const weight = (c: Cta) => (input.kind === "ad" && c.tone === "direct" ? 2 : 1);
  const total = pool.reduce((s, c) => s + weight(c), 0);
  let x = input.rng() * total;
  for (const c of pool) {
    x -= weight(c);
    if (x <= 0) return c;
  }
  return pool[pool.length - 1];
}

/** True when a spoken line carries this CTA (its own words), whatever else it says around it. */
export function carriesCta(text: string, cta: Cta): boolean {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")} `;
  return cta.marks.some((m) => t.includes(m));
}

/** The CTA a spoken line carries, if any (for lines written before a CTA was planned). */
export const ctaOf = (text: string): Cta | undefined => CTAS.find((c) => carriesCta(text, c));
