import type { NetworkRules } from "@/lib/social/types";
import { CONTEST_NOTE, hasContestPlaceholders } from "@/lib/content-flow/contest";

/** The part of a network's rules the composer needs; plain data so it can be sent to the browser. */
export type RuleSummary = Pick<NetworkRules, "network" | "label" | "maxText" | "maxHashtags" | "requiresMedia" | "maxImages" | "formats" | "videoOnly" | "videoPosts">;

export type PostFormatName = "POST" | "CAROUSEL" | "SCRIPT";

/** Longest video script BuPulse accepts for a reminder post. */
export const MAX_SCRIPT_LENGTH = 5000;

/** The text as it is posted: the caption, then the hashtags on their own line. */
export function composeText(text: string, hashtags: readonly string[]): string {
  const tags = hashtags.join(" ");
  const body = text.trim();
  return tags ? (body ? `${body}\n\n${tags}` : tags) : body;
}

/**
 * Video-only networks take a script reminder, or a real post for a video where BuPulse can upload it (`videoPosts`:
 * TikTok through BuPulse-Socials); everything else a post, or a carousel for several images.
 */
export function formatFor(rules: RuleSummary, mediaCount: number, hasVideo = false): PostFormatName {
  if (rules.videoOnly) return hasVideo && rules.videoPosts ? "POST" : "SCRIPT";
  if (mediaCount > 1 && rules.formats.includes("CAROUSEL")) return "CAROUSEL";
  return "POST";
}

/** Instagram photos larger than this on a side are refused (publishing converts and pads, but will not decode huge files). */
export const INSTAGRAM_MAX_SIDE = 4096;

export type Checked = { errors: string[]; length: number; limit: number };

/** Checks one post against its network's rules, with messages written for the owner. */
export function validatePost(
  rules: RuleSummary,
  input: { format: PostFormatName; text: string; hashtags: readonly string[]; mediaCount: number; mediaSizes?: readonly { width?: number | null; height?: number | null }[] },
): Checked {
  const errors: string[] = [];
  const length = composeText(input.text, input.hashtags).length;
  // A contest the AI suggested keeps placeholders until the owner confirms the prize and rules (lib/content-flow/contest.ts).
  if (hasContestPlaceholders(input.text)) errors.push(CONTEST_NOTE);

  if (input.format === "SCRIPT") {
    const limit = MAX_SCRIPT_LENGTH;
    if (!input.text.trim()) errors.push(`Add the video script. We email it to you so you can film and post it on ${rules.label}.`);
    if (length > limit) errors.push(`The script is ${length - limit} characters too long.`);
    return { errors, length, limit };
  }

  const limit = rules.maxText;
  if (!input.text.trim() && input.mediaCount === 0) errors.push("Write something or add a photo.");
  if (!input.text.trim() && input.mediaCount > 0 && !rules.requiresMedia) errors.push(`${rules.label} needs some text with the photo.`);
  if (length > limit) errors.push(`${rules.label} allows ${limit.toLocaleString("en-US")} characters. This is ${(length - limit).toLocaleString("en-US")} too long.`);
  if (rules.maxHashtags && input.hashtags.length > rules.maxHashtags) errors.push(`${rules.label} allows up to ${rules.maxHashtags} hashtags.`);
  if (rules.requiresMedia && input.mediaCount === 0) errors.push(`${rules.label} posts need a photo. Add one from your Gallery, your Designs or your computer.`);
  if (rules.network === "instagram" && input.mediaSizes?.some((m) => (m.width ?? 0) > INSTAGRAM_MAX_SIDE || (m.height ?? 0) > INSTAGRAM_MAX_SIDE)) {
    errors.push(`Instagram photos can be at most ${INSTAGRAM_MAX_SIDE} pixels on a side. Choose a smaller photo.`);
  }
  if (input.mediaCount > rules.maxImages) errors.push(`${rules.label} allows up to ${rules.maxImages} photos.`);
  return { errors, length, limit };
}

/** Shown on a video-only network's tab: why it is a reminder, kindly. */
export function scriptExplanation(label: string): string {
  return `${label} is video only, and BuPulse cannot make video yet. So at the scheduled time we email you this script, the caption and your images, and you film and post it yourself. Publishing video straight to ${label} is coming.`;
}
