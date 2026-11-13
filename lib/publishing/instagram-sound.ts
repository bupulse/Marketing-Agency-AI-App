// The trending sound of an Instagram reel at publish time (owner decisions, 13 November 2026). For an Instagram account
// connected through Facebook Login, a reel gets the account's top trending music (lib/social/trending-sounds.ts, asked
// once a day) through Meta's Instagram Audio API, on the reel's version without BuPulse's library music
// (lib/visuals/ig-variant.ts). Anything missing (no sound, no version without music, a Video Studio reel, an error)
// means the reel goes out exactly as before: the sound never stops or fails a post.
import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { isFacebookLoginToken, IG_SOUND_VOLUME, pickTrendingAudio, type AttachedSound, type IgAudio } from "@/lib/social/instagram-audio";
import { trendingAudioFor } from "@/lib/social/trending-sounds";
import type { ConnectionCredentials, PublishRequest } from "@/lib/social/types";
import { UPLOAD_ENGINE } from "@/lib/video-library/upload-rules";
import { noMusicVariantOf, soundChoice, type ReelSource } from "@/lib/visuals/ig-variant";
import type { VisualItem } from "@/lib/visuals/types";
import { isVideoPath } from "@/lib/visuals/post-media";

/** A visual's items (lib/visuals/service.ts readItems, kept here so publishing does not load the visuals service). */
const readItems = (value: unknown): VisualItem[] => (Array.isArray(value) ? value.filter((i): i is VisualItem => !!i && typeof i === "object" && typeof (i as VisualItem).path === "string") : []);

/** Whether a stored video plan has library music; anything unreadable counts as music (so no sound goes on top). */
function planHasMusic(plan: unknown): boolean {
  if (!plan || typeof plan !== "object") return true;
  const music = (plan as { music?: unknown }).music;
  return music !== null && music !== undefined;
}

export type PreparedSound = {
  /** The file the reel goes out as (the version without music, or the reel itself). */
  path: string;
  withoutMusic: boolean;
  audio: IgAudio;
};

/** Where the reel comes from: a BuPulse reel (and its version without music), a Video Studio MP4, or the company's own. */
export async function reelSource(businessId: string, mainPath: string): Promise<ReelSource | null> {
  const visual = await prisma.contentVisual.findFirst({
    where: { businessId, kind: "video", items: { array_contains: [{ path: mainPath }] } as Prisma.JsonFilter<"ContentVisual"> },
    orderBy: { createdAt: "desc" },
    select: { items: true, plan: true },
  });
  if (visual) {
    const items = readItems(visual.items);
    // Read from the stored plan as it is (not through the plan checks): when in doubt, the reel counts as having music.
    if (items[0]?.path === mainPath) return { kind: "visual", mainPath, hasMusic: planHasMusic(visual.plan), variantPath: noMusicVariantOf(items) };
  }
  const job = await prisma.videoJob.findFirst({ where: { businessId, videoPath: mainPath }, select: { engine: true } });
  if (job) return job.engine === UPLOAD_ENGINE ? { kind: "own", mainPath } : { kind: "studio", mainPath };
  // A BuPulse reel file that is no longer its visual's (made again since): its music is unknown, so no sound.
  if (mainPath.split("/")[1] === "videos") return null;
  return { kind: "own", mainPath };
}

/**
 * The sound for this Instagram post, or null to publish as before. Only a single-video post, on an account connected
 * through Facebook Login (BuPulse's own app: no Composio, Upload-Post or Zernio). Never throws.
 */
export async function prepareInstagramSound(post: { id: string; businessId: string; network: string; mediaPaths: string[] }, credentials: ConnectionCredentials, now = new Date()): Promise<PreparedSound | null> {
  try {
    if (post.network !== "instagram" || post.mediaPaths.length !== 1 || !isVideoPath(post.mediaPaths[0])) return null;
    if ((credentials.method && credentials.method !== "DIRECT") || credentials.uploadPostProfile || credentials.zernioProfile || !isFacebookLoginToken(credentials.accessToken)) return null;
    const source = await reelSource(post.businessId, post.mediaPaths[0]);
    if (!source) return null;
    const choice = soundChoice(source);
    if (!choice.attach) return null;
    const audio = pickTrendingAudio(await trendingAudioFor({ externalAccountId: credentials.externalAccountId, accessToken: credentials.accessToken }, now));
    if (!audio) return null;
    return { path: choice.path, withoutMusic: choice.withoutMusic, audio };
  } catch (error) {
    await logError(error, { source: "publishing.instagram-sound", level: "warn", businessId: post.businessId, postId: post.id }).catch(() => undefined);
    return null;
  }
}

/** PublishRequest.sound for a prepared sound; `fallbackVideoUrl` is the reel with its music. */
export function soundRequest(prepared: PreparedSound, fallbackVideoUrl: string): NonNullable<PublishRequest["sound"]> {
  return { audioId: prepared.audio.id, audioVolume: IG_SOUND_VOLUME.audio, videoVolume: IG_SOUND_VOLUME.video, fallbackVideoUrl };
}

/** What the post records once the sound went out with it (Post.trendingSound). */
export function attachedSound(audio: IgAudio, now = new Date()): AttachedSound {
  return { audioId: audio.id, title: audio.title, artist: audio.artist, link: audio.link, attachedAt: now.toISOString() };
}
