// Gallery first (docs/CONTENT.md): a day's posts use the subject's own album photos and videos before anything else.
// Which network gets a video (the owner's own, or one BuPulse makes from the photos), which gets a picture, and which
// photo leads each post, rotated so the same photo does not lead every day. Pure.
import type { Network } from "@/lib/social/types";
import { seed } from "./variety";
import { NETWORK_STYLE, type Shape } from "./networks";

export type GalleryItem = { path: string; name: string; mimeType: string; recentUses?: number; description?: string | null };

export const isVideoItem = (m: Pick<GalleryItem, "mimeType" | "path">) => m.mimeType.startsWith("video/") || /\.(mp4|webm)$/i.test(m.path);
const isMp4 = (m: GalleryItem) => m.mimeType === "video/mp4" || /\.mp4$/i.test(m.path);
/** Satori (the template renderer) draws JPG and PNG only. */
export const isDrawable = (m: GalleryItem) => !isVideoItem(m) && /^image\/(jpeg|png)$/.test(m.mimeType);

export type PostMedia =
  /** The owner's own Gallery video, used as is (a Reel, or the TikTok / YouTube reminder's video). */
  | { kind: "gallery-video"; video: GalleryItem; photos: GalleryItem[] }
  /** A video BuPulse makes from the photos (the plan has video). */
  | { kind: "render-video"; photos: GalleryItem[] }
  /** No video possible: the video script as a reminder to film it. */
  | { kind: "script"; photos: GalleryItem[] }
  /** A picture or carousel designed by the art director, the album photos first. */
  | { kind: "image"; photos: GalleryItem[] };

/** The album's photos, least used first, and the day decides where equally used ones start. */
export function orderPhotos(items: GalleryItem[], day: string): GalleryItem[] {
  const photos = items.filter((m) => !isVideoItem(m));
  const start = photos.length ? seed(day) % photos.length : 0;
  return photos
    .map((m, i) => ({ m, uses: m.recentUses ?? 0, turn: (i - start + photos.length) % Math.max(photos.length, 1) }))
    .sort((a, b) => a.uses - b.uses || a.turn - b.turn)
    .map((x) => x.m);
}

export function orderVideos(items: GalleryItem[]): GalleryItem[] {
  return items.filter(isVideoItem).sort((a, b) => (a.recentUses ?? 0) - (b.recentUses ?? 0));
}

/**
 * The media of each post of a day's run, gallery first:
 * - TikTok and YouTube: the album's video when there is one, else a video made from the photos (plan with video),
 *   else the script reminder;
 * - Instagram: the album's MP4 video as a Reel when there is one, else a picture;
 * - Facebook and LinkedIn: a picture.
 * Each post leads with a different photo when the album has several.
 */
export function assignMedia(input: { networks: readonly Network[]; gallery: GalleryItem[]; day: string; videoInPlan: boolean }): PostMedia[] {
  const photos = orderPhotos(input.gallery, input.day);
  const videos = orderVideos(input.gallery);
  let nextVideo = 0;
  const reels = new Set<Network>();
  return input.networks.map((network, index): PostMedia => {
    const lead = photos.length ? [...photos.slice(index % photos.length), ...photos.slice(0, index % photos.length)] : [];
    const style = NETWORK_STYLE[network];
    if (style.video === "always") {
      if (videos.length) return { kind: "gallery-video", video: videos[nextVideo++ % videos.length], photos: lead };
      return { kind: input.videoInPlan ? "render-video" : "script", photos: lead };
    }
    // One Reel of the album's video per app a day; the app's other posts that day are pictures.
    const reel = style.video === "when-given" && !reels.has(network) ? videos.find(isMp4) : undefined;
    if (reel) {
      reels.add(network);
      return { kind: "gallery-video", video: reel, photos: lead };
    }
    return { kind: "image", photos: lead };
  });
}

/** Real before / after material: Gallery items described or named so. */
export function hasBeforeAfter(items: readonly Pick<GalleryItem, "name" | "description">[]): boolean {
  const said = (m: Pick<GalleryItem, "name" | "description">) => `${m.description ?? ""} ${m.name}`.toLowerCase();
  return items.some((m) => /\bbefore\b|\bavant\b/.test(said(m))) && items.some((m) => /\bafter\b|\baprès\b|\bapres\b/.test(said(m)));
}

const MEANINGLESS = /^(img|dsc|dscn|pxl|photo|image|video|vid|whatsapp( image| video)?|screenshot|screen shot|mvimg)[\W_]*\d/i;

/** A file's name as a description of what it shows ("hydro-tower_in class.jpg" -> "hydro tower in class"), or null. */
export function describeItem(item: Pick<GalleryItem, "name" | "description">): string | null {
  // The owner's description in the Gallery says best what it shows.
  const description = item.description?.replace(/\s+/g, " ").trim();
  if (description) return description.slice(0, 160);
  const name = item.name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name || MEANINGLESS.test(item.name) || /^\d+$/.test(name)) return null;
  return name.slice(0, 120);
}

/** The lines that tell the writer what the post shows, so the caption talks about it. */
export function mediaLines(media: PostMedia | { kind: "own"; items: GalleryItem[] }): string[] {
  const label = (m: GalleryItem) => describeItem(m) ?? (isVideoItem(m) ? "a video" : "a photo");
  if (media.kind === "own") return media.items.length ? [`The post shows the owner's own ${media.items.length === 1 ? "media" : "media, in order"}: ${media.items.map((m) => `"${label(m)}"`).join(", ")}.`] : [];
  if (media.kind === "gallery-video") return [`The post is the owner's own video: "${label(media.video)}". Write the caption and script about what it shows.`];
  const shown = media.photos.slice(0, 3);
  if (shown.length === 0) return media.kind === "image" ? ["There is no photo: the picture will be a designed text image."] : [];
  return [`The ${media.kind === "image" ? "picture" : "video"} uses the owner's photos: ${shown.map((m) => `"${label(m)}"`).join(", ")}. Relate the caption to what they show.`];
}

export type OwnPostMedia = { format: "POST" | "CAROUSEL" | "SCRIPT"; mediaPaths: string[]; shape: Shape } | { skip: string };

const MAX_IMAGES: Record<Network, number> = { instagram: 10, facebook: 10, linkedin: 9, tiktok: 0, youtube: 0 };

/**
 * "Bring my own": the owner's photos and videos on one network, used as they are. A video goes to TikTok, YouTube
 * (the reminder carries it) and Instagram (a Reel, MP4 only); photos go to the feed networks as a picture or a
 * carousel within the network's limit. A network that cannot take what was given is skipped, with the reason.
 */
export function ownMediaFor(network: Network, items: GalleryItem[]): OwnPostMedia {
  const style = NETWORK_STYLE[network];
  const videos = items.filter(isVideoItem);
  const photos = items.filter((m) => !isVideoItem(m));
  if (style.video === "always") return videos[0] ? { format: "SCRIPT", mediaPaths: [videos[0].path], shape: style.shape } : { skip: `${style.label} needs a video.` };
  if (network === "instagram") {
    const reel = videos.find(isMp4);
    if (reel) return { format: "POST", mediaPaths: [reel.path], shape: "9:16" };
    if (photos.length === 0) return { skip: "Instagram needs a photo or an MP4 video." };
  }
  if (network === "facebook" && photos.length === 0 && videos[0]) return { format: "POST", mediaPaths: [videos[0].path], shape: "9:16" };
  const list = photos.slice(0, MAX_IMAGES[network]).map((m) => m.path);
  return { format: list.length >= 2 ? "CAROUSEL" : "POST", mediaPaths: list, shape: style.shape };
}
