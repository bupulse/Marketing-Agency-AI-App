"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BarChart2, Bookmark, Heart, Maximize2, MessageCircle, MessageSquare, Repeat2, Send, Share, ThumbsUp } from "lucide-react";
import { networkName } from "@/components/publishing/network-icon";
import { cn } from "@/lib/cn";
import { aspectRatio, truncateCaption } from "./helpers";
import { useInView, usePointerFx } from "./hooks";
import { MediaStage } from "./media-stage";
import { AccountPicture, ActionRow, CaptionText, StatusPill } from "./parts";
import type { MediaAction, Platform, PostView, Ratio } from "./types";
import s from "./media-cards.module.css";

/** How each platform shows a post: the media's shape, the caption above or below it, full-screen video. */
export const PLATFORM_LOOK: Record<Platform, { ratio: Ratio; captionFirst: boolean; full: boolean; max: number; moreWord: string }> = {
  instagram: { ratio: "4:5", captionFirst: false, full: false, max: 125, moreWord: "more" },
  facebook: { ratio: "1:1", captionFirst: true, full: false, max: 180, moreWord: "See more" },
  linkedin: { ratio: "1:1", captionFirst: true, full: false, max: 150, moreWord: "more" },
  twitter: { ratio: "16:9", captionFirst: true, full: false, max: 280, moreWord: "Show more" },
  tiktok: { ratio: "9:16", captionFirst: false, full: true, max: 80, moreWord: "more" },
  youtube: { ratio: "9:16", captionFirst: false, full: true, max: 80, moreWord: "more" },
};

/** The platform's own like/comment/share row, as a picture of how the post will look (not buttons). */
export function PreviewIcons({ platform }: { platform: Platform }) {
  const i = "size-[22px] stroke-[1.8]";
  if (platform === "facebook" || platform === "linkedin") {
    const items =
      platform === "facebook"
        ? ([
            [ThumbsUp, "Like"],
            [MessageCircle, "Comment"],
            [Share, "Share"],
          ] as const)
        : ([
            [ThumbsUp, "Like"],
            [MessageSquare, "Comment"],
            [Repeat2, "Repost"],
            [Send, "Send"],
          ] as const);
    return (
      <div aria-hidden className="mx-3 flex items-center justify-around border-t border-line py-1.5 text-[13px] font-semibold text-muted">
        {items.map(([Icon, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5 px-2 py-1.5">
            <Icon className="size-[18px] stroke-[1.8]" />
            {label}
          </span>
        ))}
      </div>
    );
  }
  if (platform === "twitter")
    return (
      <div aria-hidden className="flex items-center justify-between px-4 py-2 text-muted">
        {[MessageCircle, Repeat2, Heart, BarChart2, Share].map((Icon, k) => (
          <Icon key={k} className="size-[18px] stroke-[1.8]" />
        ))}
      </div>
    );
  return (
    <div aria-hidden className="flex items-center gap-4 px-4 pt-3 pb-1 text-text">
      <Heart className={cn(i, "transition-transform duration-300 hover:scale-110")} />
      <MessageCircle className={cn(i, "-scale-x-100")} />
      <Send className={i} />
      <span className="flex-1" />
      <Bookmark className={i} />
    </div>
  );
}

/** The caption with "… more" that opens it in place, like the apps. */
function Caption({ post, look, lead, className }: { post: PostView; look: (typeof PLATFORM_LOOK)[Platform]; lead?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const cut = truncateCaption(post.caption, look.max);
  const showAll = open || !cut.more;
  if (!post.caption.trim() && !(post.hashtags?.length ?? 0)) return null;
  return (
    <p className={cn("text-[14px] leading-[1.45] text-text", className)}>
      {lead}
      {showAll ? (
        <CaptionText text={post.caption} hashtags={post.hashtags} />
      ) : (
        <>
          <CaptionText text={cut.text} />
          {"… "}
          <button type="button" onClick={() => setOpen(true)} className="-my-3 inline-flex min-h-11 cursor-pointer items-center align-baseline font-medium text-muted hover:text-text" aria-label="Show the whole caption">
            {look.moreWord}
          </button>
        </>
      )}
    </p>
  );
}

export type PostCardProps = {
  post: PostView;
  /** Our real actions instead of the platform's like/comment row (Edit, Schedule, Approve, Delete). */
  actions?: MediaAction[];
  /** Anything else under the card (Share to WhatsApp...). */
  footer?: ReactNode;
  /** Opens the post (PostModal). */
  onOpen?: (slide?: number) => void;
  /** Overrides the platform's media shape. */
  ratio?: Ratio;
  /** Select mode: the card is outlined. */
  selected?: boolean;
  /** Position in its grid, for the staggered rise-in. */
  index?: number;
  className?: string;
};

/**
 * One post as its feed post (Instagram, Facebook, LinkedIn, X, TikTok, YouTube Shorts), in BuPulse's look from
 * samples.bupulse.com/team/images.html: a rounded card that lifts and tilts a little under the pointer with the
 * gradient border, the picture settling in, a glass label on hover. Inside: the account row, the media (one picture, a
 * carousel with dots, or a video that plays in place), the platform's icon row (or our actions), the caption with
 * "… more" and blue hashtags, and the status pill.
 */
export function PostCard({ post, actions, footer, onOpen, ratio, selected, index = 0, className }: PostCardProps) {
  const card = useRef<HTMLElement>(null);
  const { seen } = useInView(card);
  usePointerFx(card, undefined, { tilt: 2.5, lift: 4 });
  const look = PLATFORM_LOOK[post.platform] ?? PLATFORM_LOOK.instagram;
  const shape = aspectRatio(ratio ?? look.ratio);
  const title = post.title || post.caption.slice(0, 60) || `${networkName(post.platform)} post`;
  const style = { "--i": Math.min(index, 8) } as CSSProperties;
  const shown = (actions ?? []).filter((a) => !a.modalOnly);
  const shell = cn(
    s.lift,
    s.post,
    "flex min-w-0 flex-col overflow-hidden border border-line bg-surface shadow-[0_1px_2px_rgba(13,16,32,0.04),0_18px_40px_-28px_rgba(20,30,90,0.35)] dark:bg-[#141419]",
    seen ? s.rise : "opacity-0",
    selected && "outline-[3px] outline-offset-[3px] outline-pulse-blue outline-solid",
    className,
  );
  const openButton = onOpen && (
    <button type="button" onClick={() => onOpen()} aria-label={`Open post: ${title}`} title="Open" className="-mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-soft hover:text-text">
      <Maximize2 aria-hidden className="size-[18px]" />
    </button>
  );
  const status = post.status ? <StatusPill status={post.status} label={post.statusLabel} /> : null;
  const label = onOpen && post.media.length > 0 && post.media[0].kind === "image" && (
    <span aria-hidden className={cn(s.label, "pointer-events-none absolute inset-x-2.5 bottom-2.5 z-[3] flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold")}>
      <span className="truncate">{post.subject ? `${post.subject.kind === "product" ? "Product" : "Campaign"} · ${post.subject.name}` : networkName(post.platform)}</span>
      <span className="shrink-0 text-pulse-blue">Open →</span>
    </span>
  );

  // TikTok and YouTube Shorts: the video is the post, with everything on it.
  if (look.full) {
    return (
      <article ref={card} style={style} className={shell}>
        <div className="relative" style={{ aspectRatio: shape }}>
          <MediaStage media={post.media} title={title} onOpen={onOpen} dots="over" className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] flex items-center gap-2 bg-gradient-to-b from-black/50 to-transparent p-3 text-white">
            <AccountPicture account={post.account} platform={post.platform} size={32} ring={false} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold [text-shadow:0_1px_6px_rgba(0,0,0,.4)]">
              {post.account.handle || post.account.name}
              {post.timeLabel && <span className="font-normal text-white/80"> · {post.timeLabel}</span>}
            </span>
            {post.status && <StatusPill status={post.status} label={post.statusLabel} glass />}
          </div>
          {shown.length === 0 && (
            <div aria-hidden className="pointer-events-none absolute right-2.5 bottom-24 z-[3] flex flex-col items-center gap-4 text-white [filter:drop-shadow(0_1px_4px_rgba(0,0,0,.5))]">
              <Heart className="size-7 fill-white/90" />
              <MessageCircle className="size-7 fill-white/90" />
              <Bookmark className="size-7 fill-white/90" />
              <Share className="size-7" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 pt-10 pr-14 text-white">
            <p className="line-clamp-2 text-[13.5px] leading-snug [text-shadow:0_1px_6px_rgba(0,0,0,.45)] [&_span]:!text-white [&_span.font-medium]:font-semibold">
              <CaptionText text={post.caption} hashtags={post.hashtags} />
            </p>
            {post.subject && <span className="mt-1.5 inline-block rounded-md bg-white/20 px-2 py-0.5 text-[11.5px] font-semibold backdrop-blur-md">{post.subject.name}</span>}
          </div>
        </div>
        {(shown.length > 0 || footer || onOpen) && (
          <div className="flex flex-wrap items-center gap-2 p-3">
            <ActionRow actions={shown} compact className="flex-1" />
            {footer}
            {openButton}
          </div>
        )}
      </article>
    );
  }

  const header = (
    <header className={cn("flex items-center gap-2.5 px-3.5 pt-3 pb-2.5", post.platform === "twitter" && "items-start")}>
      <AccountPicture account={post.account} platform={post.platform} size={post.platform === "linkedin" ? 40 : 34} ring={post.platform === "instagram"} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex min-w-0 items-baseline gap-1 text-[14px]">
          <span className="truncate font-semibold text-text">{post.account.name}</span>
          {post.platform === "twitter" && post.account.handle && <span className="truncate text-muted">{post.account.handle}</span>}
          {post.timeLabel && <span className="shrink-0 text-muted">· {post.timeLabel}</span>}
        </div>
        <span className="block truncate text-[12px] text-muted">{post.subject ? post.subject.name : networkName(post.platform)}</span>
      </div>
      {post.media.length === 0 && status}
      {openButton}
    </header>
  );

  const mediaBlock = post.media.length > 0 && (
    <div className={cn("relative", post.platform === "twitter" && "mx-3.5 overflow-hidden rounded-2xl border border-line")} style={{ aspectRatio: shape }}>
      <MediaStage media={post.media} title={title} onOpen={onOpen} dots={post.platform === "instagram" ? "below" : "over"} className="absolute inset-0" />
      {label}
      {/* The status sits on the picture (glass), so the account row keeps room for the name. */}
      {post.status && (
        <span className="pointer-events-none absolute top-3 left-3 z-[3] max-w-[calc(100%-5rem)]">
          <StatusPill status={post.status} label={post.statusLabel} glass />
        </span>
      )}
    </div>
  );

  return (
    <article ref={card} style={style} className={shell}>
      {header}
      {look.captionFirst && <Caption post={post} look={look} className="px-3.5 pb-3" />}
      {mediaBlock}
      {shown.length > 0 ? (
        <div className={cn("px-3.5 pt-3", post.media.length > 1 && post.platform === "instagram" && "pt-6")}>
          <ActionRow actions={shown} compact />
        </div>
      ) : (
        <div className={cn(post.media.length > 1 && post.platform === "instagram" && "pt-3")}>
          <PreviewIcons platform={post.platform} />
        </div>
      )}
      {!look.captionFirst && (
        <Caption
          post={post}
          look={look}
          className="px-4 pt-1.5"
          lead={
            <>
              <span className="font-semibold">{post.account.handle?.replace(/^@/, "") || post.account.name}</span>{" "}
            </>
          }
        />
      )}
      <div className="flex-1" />
      {footer ? <div className="px-3.5 pt-2 pb-3.5">{footer}</div> : <div className="pb-3.5" />}
    </article>
  );
}
