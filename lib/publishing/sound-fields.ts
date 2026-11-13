// What the post screens know about an Instagram reel's trending sound (owner decisions, 13 November 2026). Pure.
import { readAttachedSound } from "@/lib/social/instagram-audio";
import { instagramSoundMode, type InstagramSoundMode } from "@/lib/social/instagram-sound-mode";

const VIDEO = /\.(mp4|webm|mov)$/i;

export type PostSoundFields = {
  /** The trending sound that went out with the reel ("Trending sound: Title – Artist"). */
  trendingSound?: { title: string; artist: string | null; link: string | null };
  /** Instagram reels: "auto" (BuPulse attaches a trending sound) or "tip" (the client can post it by hand with one). */
  instagramSound?: InstagramSoundMode;
};

export function postSoundFields(row: { network: string; format: string; mediaPaths: readonly string[]; trendingSound?: unknown; connection?: { method?: string | null; scopes?: readonly string[] | null } | null }): PostSoundFields {
  const out: PostSoundFields = {};
  const attached = readAttachedSound(row.trendingSound);
  if (attached) out.trendingSound = { title: attached.title, artist: attached.artist, link: attached.link };
  const reel = row.mediaPaths.some((p) => VIDEO.test(p)) || (row.format === "SCRIPT" && row.mediaPaths.length === 0);
  if (row.network === "instagram" && reel) out.instagramSound = instagramSoundMode(row.connection ? { provider: "instagram", method: row.connection.method, scopes: row.connection.scopes } : null);
  return out;
}
