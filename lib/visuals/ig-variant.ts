// The reel's Instagram version without BuPulse's library music (owner decisions, 13 November 2026): when BuPulse attaches
// a trending Instagram sound (Facebook Login accounts only, lib/social/instagram-sound-mode.ts), the Instagram reel keeps
// the voice-over (and the video's own sound) and the trending sound, never our song on top. Facebook, TikTok, YouTube
// keep the library music. The renderer encodes the frames once and writes two files from them (the normal one and this
// one, components/visuals/video-renderer.ts), only when the version will be used: the video has library music and one
// of its posts goes to such an Instagram account. Pure, client-safe; unit tested.
import { isFacebookLoginInstagram } from "@/lib/social/instagram-sound-mode";

/** The VisualItem.variant of the reel without library music (the visual's second item; items[0] stays the reel). */
export const NO_MUSIC_VARIANT = "no-music" as const;

/** Where the version without music is stored: next to the reel, ".nomusic.mp4". MP4 only (Instagram takes nothing else). */
export function variantPathOf(mainPath: string): string | null {
  return /\.mp4$/i.test(mainPath) && !/\.nomusic\.mp4$/i.test(mainPath) ? mainPath.replace(/\.mp4$/i, ".nomusic.mp4") : null;
}

/** The stored version without music among a visual's items, or null. */
export function noMusicVariantOf(items: readonly { path: string; variant?: string | null }[]): string | null {
  const main = items[0]?.path;
  const item = items.find((i, n) => n > 0 && i.variant === NO_MUSIC_VARIANT);
  return main && item && item.path === variantPathOf(main) ? item.path : null;
}

/** Posts that have not gone out yet (the version is for them). */
const OPEN = ["DRAFT", "PENDING_APPROVAL", "SCHEDULED"];

export type VariantPost = { network: string; status: string; connection: { provider: string; method?: string | null; scopes?: readonly string[] | null } | null };

/**
 * Whether making this video should also make its Instagram version without music: the video has library music, it is
 * made as an MP4, and one of its posts still to go out is on an Instagram account connected through Facebook Login.
 * Otherwise nothing extra is made.
 */
export function needsInstagramVariant(input: { hasMusic: boolean; mimeType?: string | null; posts: readonly VariantPost[] }): boolean {
  if (!input.hasMusic) return false;
  if (input.mimeType && input.mimeType !== "video/mp4") return false;
  return input.posts.some((p) => p.network === "instagram" && OPEN.includes(p.status) && isFacebookLoginInstagram(p.connection));
}

/** Where an Instagram post's video comes from, as far as the sound goes. */
export type ReelSource =
  /** A BuPulse reel (ContentVisual): with library music or not, and its version without music when it was made. */
  | { kind: "visual"; mainPath: string; hasMusic: boolean; variantPath: string | null }
  /** A Video Studio MP4: its sound is mixed in already and there is no version without it. */
  | { kind: "studio"; mainPath: string }
  /** The company's own video (uploaded): its own sound stays, the trending sound goes under it. */
  | { kind: "own"; mainPath: string };

export type SoundChoice = { attach: false; why: string } | { attach: true; path: string; withoutMusic: boolean };

/**
 * Whether a trending sound can go on this reel, and which file carries it. Never two songs at once: a reel with library
 * music takes a sound only through its version without music; without that version it goes out as it is (with its music).
 */
export function soundChoice(source: ReelSource): SoundChoice {
  if (source.kind === "studio") return { attach: false, why: "Video Studio reels keep their own music" };
  if (source.kind === "own") return { attach: true, path: source.mainPath, withoutMusic: false };
  if (!source.hasMusic) return { attach: true, path: source.mainPath, withoutMusic: false };
  if (source.variantPath) return { attach: true, path: source.variantPath, withoutMusic: true };
  return { attach: false, why: "no version without music" };
}
