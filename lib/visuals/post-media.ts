// Which of a content's visuals a post on each network carries, and in which format. Pure, so the composer's server
// code, Autopilot and the tests agree. Carousels and Instagram's JPEG conversion are handled by publishing as before.
import type { Network } from "@/lib/social/types";

type Format = "POST" | "CAROUSEL" | "ARTICLE" | "SCRIPT";

/** Networks BuPulse publishes video to through their API (Instagram Reels, Facebook Page videos). */
export const VIDEO_PUBLISH_NETWORKS: readonly Network[] = ["instagram", "facebook"];

export function isVideoPath(path: string): boolean {
  return /\.(mp4|webm)$/i.test(path);
}

/** Whether a network takes this video file through the API (Instagram wants MP4; Facebook also takes WebM). */
export function acceptsVideo(network: Network, path: string): boolean {
  if (!VIDEO_PUBLISH_NETWORKS.includes(network)) return false;
  return network === "facebook" || /\.mp4$/i.test(path);
}

export interface PostMediaInput {
  network: Network;
  /** The format the post was planned in (SCRIPT means a video idea). */
  format: Format;
  rules: { formats: readonly string[]; maxImages: number; videoOnly: boolean };
  /** The ready image or carousel slides, in order. */
  images: string[];
  /** The ready video, if one was rendered. */
  video: string | null;
}

/**
 * The media and format for one post:
 * - a video idea (SCRIPT) becomes a real video post where the network takes video, and keeps the script reminder
 *   with the video attached on TikTok and YouTube (BuPulse cannot upload there yet, the owner gets the file by email);
 * - feed posts take the carousel where the network has carousels (capped to its photo limit), else the first slide;
 * - articles carry no media.
 */
export function mediaForPost(input: PostMediaInput): { format: Format; mediaPaths: string[] } {
  const { network, format, rules, images, video } = input;
  if (format === "ARTICLE") return { format, mediaPaths: [] };
  if (format === "SCRIPT" || rules.videoOnly) {
    if (video && acceptsVideo(network, video)) return { format: "POST", mediaPaths: [video] };
    return { format: "SCRIPT", mediaPaths: video ? [video] : [] };
  }
  const max = Math.max(1, rules.maxImages || 1);
  if (images.length >= 2 && rules.formats.includes("CAROUSEL") && max >= 2) return { format: "CAROUSEL", mediaPaths: images.slice(0, max) };
  return { format: "POST", mediaPaths: images.slice(0, 1) };
}

/**
 * The composer's media for one network: a video goes alone where the network takes it, and with the script reminder
 * of a video-only network (TikTok, YouTube); any other network gets the photos instead (or the content's images).
 */
export function composerMediaFor(network: Network, videoOnly: boolean, mediaPaths: string[], fallbackImages: string[]): string[] {
  const videos = mediaPaths.filter(isVideoPath);
  if (videos.length === 0) return mediaPaths;
  if (videoOnly || acceptsVideo(network, videos[0])) return videos.slice(0, 1);
  const images = mediaPaths.filter((p) => !isVideoPath(p));
  return images.length > 0 ? images : fallbackImages;
}
