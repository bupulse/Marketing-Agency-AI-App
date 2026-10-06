// Per-network versions of one piece of generated content (length, hashtags, aspect ratio).
// Pure functions: no I/O, so they are cheap to recompute whenever the owner edits the text.

export type Network = "instagram" | "facebook" | "tiktok" | "linkedin" | "x";
export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

export interface NetworkVariant {
  network: Network;
  /** The caption body. Hashtags are listed separately and appended when posting. */
  caption: string;
  hashtags: string[];
  aspectRatio: AspectRatio;
  /** Length of the text as posted: caption plus hashtags. */
  characterCount: number;
  /** The network's limit for that text. */
  limit: number;
  /** TikTok only: the video script to film from. */
  videoScript?: string;
}

export interface VariantSource {
  caption: string;
  hashtags: string[];
  videoScript: string;
}

const RULES: Record<
  Network,
  { limit: number; maxHashtags: number; aspectRatio: AspectRatio; plainText?: boolean }
> = {
  instagram: { limit: 2200, maxHashtags: 15, aspectRatio: "4:5" },
  facebook: { limit: 63206, maxHashtags: 3, aspectRatio: "1:1" },
  tiktok: { limit: 2200, maxHashtags: 5, aspectRatio: "9:16" },
  linkedin: { limit: 3000, maxHashtags: 3, aspectRatio: "1:1", plainText: true },
  x: { limit: 280, maxHashtags: 2, aspectRatio: "16:9" },
};

export const NETWORKS = Object.keys(RULES) as Network[];

const ELLIPSIS = "…";

/** Normalises hashtags: "#" prefix, no spaces, no duplicates (case-insensitive). */
export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const body = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!body) continue;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${body}`);
  }
  return out;
}

/**
 * Shortens `text` to at most `max` characters (including the "…"), cutting at the last
 * sentence end if there is one in the second half of the text, else at the last word.
 */
export function truncateSmart(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  if (max <= 1) return ELLIPSIS.slice(0, max);

  const room = clean.slice(0, max - ELLIPSIS.length);
  const sentence = Math.max(room.lastIndexOf(". "), room.lastIndexOf("! "), room.lastIndexOf("? "));
  if (sentence >= room.length / 2) return `${room.slice(0, sentence + 1).trimEnd()}${ELLIPSIS}`;

  const space = room.lastIndexOf(" ");
  const cut = space >= room.length / 2 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:.\-–—]+$/, "")}${ELLIPSIS}`;
}

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;

function stripEmoji(text: string) {
  return text.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

/** Characters the posted text takes: caption, a blank line, then the hashtags. */
export function postedLength(caption: string, hashtags: string[]) {
  return hashtags.length === 0 ? caption.length : caption.length + 2 + hashtags.join(" ").length;
}

function buildVariant(network: Network, source: VariantSource): NetworkVariant {
  const rule = RULES[network];
  const hashtags = normalizeHashtags(source.hashtags).slice(0, rule.maxHashtags);
  let caption = rule.plainText ? stripEmoji(source.caption) : source.caption.trim();

  // X puts hashtags on the same line, separated by a single space; the others by a blank line.
  const separator = network === "x" ? 1 : 2;
  const tagLength = hashtags.length === 0 ? 0 : separator + hashtags.join(" ").length;
  const room = rule.limit - tagLength;
  if (caption.length > room) caption = truncateSmart(caption, Math.max(room, 1));

  const characterCount = caption.length + tagLength;
  return {
    network,
    caption,
    hashtags,
    aspectRatio: rule.aspectRatio,
    characterCount,
    limit: rule.limit,
    ...(network === "tiktok" ? { videoScript: source.videoScript } : {}),
  };
}

export function buildVariants(source: VariantSource): NetworkVariant[] {
  return NETWORKS.map((network) => buildVariant(network, source));
}

/** The text exactly as it would be posted. */
export function variantText(variant: Pick<NetworkVariant, "network" | "caption" | "hashtags">) {
  if (variant.hashtags.length === 0) return variant.caption;
  return `${variant.caption}${variant.network === "x" ? " " : "\n\n"}${variant.hashtags.join(" ")}`;
}
