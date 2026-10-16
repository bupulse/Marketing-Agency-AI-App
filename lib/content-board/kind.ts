// What kind of post a Post row is, for the Content page's type filter and badges. Pure and client-safe. The database
// keeps the same rule in Post.mediaKind (trigger in prisma/migrations/20261016090000_content_auto_approval).
import type { Network } from "@/lib/social/types";

export const POST_KINDS = ["post", "carousel", "video", "article"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && (POST_KINDS as readonly string[]).includes(value);
}

const VIDEO = /\.(mp4|webm)$/i;

/** Same rule as the trigger: articles, then video ideas (SCRIPT) and posts carrying a video, then carousels. */
export function postKind(format: string, mediaPaths: readonly string[]): PostKind {
  if (format === "ARTICLE") return "article";
  if (format === "SCRIPT" || mediaPaths.some((p) => VIDEO.test(p))) return "video";
  if (format === "CAROUSEL") return "carousel";
  return "post";
}

/** The filter's name for each kind. */
export const KIND_LABEL: Record<PostKind, string> = { post: "Post", carousel: "Carousel", video: "Video", article: "Article" };

/** What the network calls it: a video is a Reel on Instagram, a Short on YouTube; a LinkedIn long post is an article. */
export function kindLabel(kind: PostKind, network: Network | string): string {
  if (kind === "video") {
    if (network === "instagram") return "Reel";
    if (network === "youtube") return "Short";
    return "Video";
  }
  if (kind === "article" && network === "linkedin") return "LinkedIn article";
  return KIND_LABEL[kind];
}
