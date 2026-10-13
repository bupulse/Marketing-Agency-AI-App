// What each network's post looks like in a day's run (docs/CONTENT.md): length, hashtags, tone, picture shape and
// whether it is a video, and the language line from Business.contentLanguage and the Digital Marketing Profile's
// language mix. Pure, so the writers, the "bring my own" adaptation and the tests agree.
import { normalizeHashtags, truncateSmart } from "@/lib/studio/variants";
import type { Network } from "@/lib/social/types";

export type Shape = "4:5" | "1:1" | "9:16" | "16:9";

export const NETWORK_STYLE: Record<Network, { label: string; maxChars: number; hashtags: [number, number]; shape: Shape; video: "always" | "when-given" | "never"; emojis: boolean; guide: string }> = {
  instagram: {
    label: "Instagram",
    maxChars: 600,
    hashtags: [5, 10],
    shape: "4:5",
    video: "when-given",
    emojis: true,
    guide: "Instagram: a hook in the first line, then 2 or 3 short lines, emojis as the brand voice allows, one clear call to action. 60 to 120 words at most.",
  },
  facebook: {
    label: "Facebook",
    maxChars: 700,
    hashtags: [0, 3],
    shape: "1:1",
    video: "never",
    emojis: true,
    guide: "Facebook: conversational, as if talking to local customers, 40 to 100 words, end with one call to action or a question that invites comments.",
  },
  linkedin: {
    label: "LinkedIn",
    maxChars: 1200,
    hashtags: [0, 3],
    shape: "1:1",
    video: "never",
    emojis: false,
    guide: "LinkedIn: professional and useful, short paragraphs with blank lines, no emojis, 60 to 150 words, not salesy.",
  },
  tiktok: {
    label: "TikTok",
    maxChars: 150,
    hashtags: [3, 5],
    shape: "9:16",
    video: "always",
    emojis: true,
    guide: "TikTok: a very short caption (one line, under 150 characters) and a 15 to 30 second vertical video script with a hook in the first 2 seconds, casual and quick.",
  },
  youtube: {
    label: "YouTube",
    maxChars: 300,
    hashtags: [3, 5],
    shape: "9:16",
    video: "always",
    emojis: false,
    guide: "YouTube Shorts: the caption is the Short's title line and one sentence of description; plus a 15 to 30 second vertical video script with a hook in the first 2 seconds.",
  },
};

export const isVideoNetwork = (network: Network) => NETWORK_STYLE[network].video === "always";

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;

/**
 * Holds a caption to the network's own rules: hashtags out of the text and within the network's count, no emojis
 * on LinkedIn and YouTube, and the length (cut at a sentence or word, never mid-word).
 */
export function fitToNetwork(network: Network, caption: string, hashtags: string[]): { caption: string; hashtags: string[] } {
  const style = NETWORK_STYLE[network];
  const inline = caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.map((t) => t.trim()) ?? [];
  let text = caption.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (!style.emojis) text = text.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
  const tags = normalizeHashtags([...hashtags, ...inline]).slice(0, style.hashtags[1]);
  return { caption: truncateSmart(text, style.maxChars), hashtags: tags };
}

/** The language mix the owner chose in the marketing interview ("Kinyarwanda and English"), if any. */
export function languageMixOf(profile: { answers?: { topic: string; answer: string }[] } | null | undefined): string | null {
  const answer = profile?.answers?.find((a) => a.topic === "languages")?.answer?.trim();
  return answer ? answer.slice(0, 160) : null;
}

/**
 * The language rule for one network. Business.contentLanguage is the main language; a mix from the Digital Marketing
 * Profile adds a few phrases of the other language where it fits (less on LinkedIn, which stays mostly in the main one).
 */
export function languageLine(contentLanguage: string | null | undefined, mix: string | null, network: Network): string {
  const main = contentLanguage?.trim() || "English";
  const base = `Write in ${main}. Hashtags may stay in English where that is normal for ${main}-speaking audiences.`;
  if (!mix || /^(english|kinyarwanda|french|swahili) only$/i.test(mix)) return base;
  const others = ["Kinyarwanda", "English", "French", "Swahili"].filter((l) => l.toLowerCase() !== main.toLowerCase() && mix.toLowerCase().includes(l.toLowerCase()));
  if (others.length === 0) return base;
  const amount = network === "linkedin" ? "at most one short phrase" : "a few short, natural phrases";
  return `${base} The owner's language mix is "${mix}": mostly ${main}, with ${amount} in ${others.join(" or ")} where a local customer would say them (greetings, calls to action). Never translate prices, names or facts.`;
}
