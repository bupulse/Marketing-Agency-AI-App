// From today's data shapes to the media cards' props (components/media-cards/README.md). Pure and client-safe: the
// imports below are types only (tests/media-cards/adapters.test.ts).
import type { ContentPost } from "@/lib/content-board/queries";
import type { LibraryVideo } from "@/lib/video-library/service";
import type { Network } from "@/lib/social/types";
import { postStatusKey, timeLabel } from "./helpers";
import type { PlayerItem } from "./media-player";
import type { MediaItem, PostView, StatusKey } from "./types";
import type { VideoCardProps } from "./video-card";

const VIDEO_FILE = /\.(mp4|webm|mov|m4v)(\?|$)/i;

const ENGINE_LABEL: Record<string, string> = { motion: "Motion", premium3d: "Premium 3D", seedance: "AI video", upload: "Uploaded" };

/** The small line over a library video's title. */
export function libraryEyebrow(v: Pick<LibraryVideo, "source" | "engine">): string {
  if (v.source === "slideshow") return "Post video";
  if (v.source === "upload") return "Uploaded";
  return `Video Studio · ${ENGINE_LABEL[v.engine ?? ""] ?? "Studio"}`;
}

/** A library video's pill: scheduled (a post is coming), posted (in posts already) or ready (not posted yet). */
export function libraryStatus(v: Pick<LibraryVideo, "posts">): { status: StatusKey; label: string } {
  if (v.posts.next) return { status: "scheduled", label: "Scheduled" };
  if (v.posts.count > 0) return { status: "posted", label: `In ${v.posts.count} ${v.posts.count === 1 ? "post" : "posts"}` };
  return { status: "ready", label: "Not posted yet" };
}

/** LibraryVideo (lib/video-library/service.ts) as VideoCard props, without the actions and onOpen the page adds. */
export function libraryVideoCard(v: LibraryVideo, timeZone: string): Omit<VideoCardProps, "actions" | "onOpen" | "badge" | "index"> {
  const made = new Date(v.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
  const st = libraryStatus(v);
  return {
    id: `video-${v.id}`,
    video: { src: v.videoUrl, poster: v.posterUrl, durationMs: v.durationMs, ratio: v.ratio },
    title: v.title,
    eyebrow: libraryEyebrow(v),
    status: st.status,
    statusLabel: st.label,
    // An absolute time, not "Tomorrow": the server and the browser render the same words.
    dateLabel: v.posts.next ? `Made ${made} · next post ${new Date(v.posts.next).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone })}` : `Made ${made}`,
    note: v.caption || null,
  };
}

/** LibraryVideo as an item of the full player (its details; the page adds the actions). */
export function libraryPlayerItem(v: LibraryVideo): Omit<PlayerItem, "info" | "actions"> {
  return { id: v.key, src: v.videoUrl, poster: v.posterUrl, title: v.title, eyebrow: libraryEyebrow(v), ratio: v.ratio };
}

/** The fields of a Content board / Calendar post (lib/content-board/queries.ts ContentPost) the cards use. */
export type ContentPostLike = Pick<ContentPost, "id" | "network" | "accountName" | "accountAvatar" | "notify" | "status" | "text" | "hashtags" | "media" | "poster" | "kind" | "scheduledAt" | "publishedAt" | "title" | "link"> & {
  subject?: ContentPost["subject"];
  excerpt?: string;
};

/** A post's media: its pictures, or its video with the post's still as the poster. */
export function postMedia(post: Pick<ContentPostLike, "media" | "poster" | "kind">): MediaItem[] {
  const videos = post.media.filter((m) => VIDEO_FILE.test(m.path));
  const images = post.media.filter((m) => !VIDEO_FILE.test(m.path));
  if (videos.length > 0) return videos.map((m) => ({ kind: "video", url: m.url, poster: post.poster ?? images[0]?.url ?? null }));
  return images.map((m) => ({ kind: "image", url: m.url }));
}

/** ContentPost (Content board, Calendar, Posts) as PostCard / PostModal data. */
export function contentPostView(post: ContentPostLike, timeZone: string, now: Date = new Date()): PostView {
  const when = post.status === "PUBLISHED" ? post.publishedAt : post.scheduledAt;
  // A video idea's text is its script: the card shows the caption the board made for it.
  const caption = post.kind === "video" && post.excerpt ? post.excerpt : post.text;
  return {
    id: post.id,
    platform: post.network as Network,
    account: { name: post.accountName, avatarUrl: post.accountAvatar },
    timeLabel: when ? timeLabel(when, now, timeZone) : null,
    media: postMedia(post),
    caption,
    hashtags: post.hashtags,
    status: postStatusKey(post.status, post.notify),
    subject: post.subject ? { kind: post.subject.kind, name: post.subject.name } : null,
    title: post.title,
    link: post.link,
  };
}
