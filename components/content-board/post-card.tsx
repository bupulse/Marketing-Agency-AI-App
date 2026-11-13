"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CircleDashed, FileText, Music, Sparkles } from "lucide-react";
import { soundLabel } from "@/lib/social/instagram-audio";
import { formatDateTime } from "@/components/publishing/helpers";
import { PostCard as FeedPost, contentPostView, type PostView } from "@/components/media-cards";
import { cn } from "@/lib/cn";
import type { ContentPost } from "@/lib/content-board/queries";
import { kindLabel } from "@/lib/content-board/kind";
import { networkLabel, statusChip, UNPOSTED, unpostedReason } from "@/lib/content-board/labels";
import { WhatsAppShare } from "@/components/share/whatsapp-share";
import { postShareCaption } from "@/lib/share/whatsapp";
import { dailyPostLabel } from "@/lib/daily-posts/settings";
import { MakingScreen } from "@/components/visuals/making-screen";
import type { MakingProgress } from "@/components/visuals/making-progress";
import { SelectCheckbox } from "./bulk-select";

const dateOnly = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(iso));
/** "Nov 14, 12:30 PM" in the business's zone: the same words on the server and in the browser. */
const shortWhen = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const CHIP = "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold";

/** A Content board post as the media cards' feed post (components/media-cards PostView). */
export function boardPostView(post: ContentPost, zone: string, still = false): PostView {
  const view = contentPostView(post, zone);
  const when = post.status === "PUBLISHED" ? post.publishedAt : post.scheduledAt;
  return {
    ...view,
    caption: post.excerpt,
    timeLabel: when ? shortWhen(when, zone) : null,
    // The board's words: "Scheduled" for a reminder post too (its note says how it goes out), "Needs review".
    status: view.status === "reminder" && post.status === "SCHEDULED" ? "scheduled" : view.status,
    statusLabel: post.status === "PENDING_APPROVAL" ? "Needs review" : null,
    // Select mode: a tap picks the card, so a video shows its still instead of playing.
    media: still ? view.media.map((m) => (m.kind === "video" && m.poster ? { kind: "image" as const, url: m.poster } : m)) : view.media,
  };
}

/**
 * One post as its feed post (components/media-cards PostCard): the account row, its picture, carousel or video, the
 * platform's row, the caption with "… more", its status on the picture, then the idea and when it was made. Not posted
 * yet: an amber border and a note saying why. A tap on the picture (or the open button) opens the post; `actions`
 * (approve, use again...) and "Share to WhatsApp" sit at the bottom as separate buttons.
 */
export function PostCard({
  post,
  zone,
  onOpen,
  actions,
  showSubject = false,
  making,
  selection,
}: {
  post: ContentPost;
  zone: string;
  onOpen: () => void;
  actions?: ReactNode;
  showSubject?: boolean;
  /** Its set's real progress while the pictures or reel are still being made (Daily posts, Autopilot, Create). */
  making?: MakingProgress | null;
  /** Select mode ("Select" -> "Delete"): a checkbox on the card, and a tap on the card picks it instead of opening it. */
  selection?: { selected: boolean; onToggle: () => void } | null;
}) {
  const chip = statusChip(post, (iso) => (post.status === "PUBLISHED" ? dateOnly(iso, zone) : formatDateTime(iso, zone)));
  const video = post.kind === "video";
  const type = kindLabel(post.kind, post.network);
  // Not posted yet: a warning-colour border plus an icon and words, so it does not rely on colour alone.
  const unposted = UNPOSTED.includes(post.status);
  const view = boardPostView(post, zone, !!selection);
  const hasMedia = view.media.length > 0;
  const isMaking = !!making && making.step !== "ready";

  return (
    <FeedPost
      post={view}
      className={cn("h-full", unposted && "!border-2 !border-amber-600 dark:!border-amber-400")}
      selected={selection?.selected}
      onOpen={selection ? () => selection.onToggle() : onOpen}
      openLabel={selection ? (selection.selected ? "Deselect" : "Select") : "Open"}
      topSlot={selection && <SelectCheckbox checked={selection.selected} onChange={selection.onToggle} label={`Select ${networkLabel(post.network)} ${type}, ${chip.label}`} />}
      placeholder={
        hasMedia ? undefined : post.kind !== "article" || isMaking ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
            <FileText aria-hidden className="size-8" />
            <span className="text-[13px]">{video ? "Video not made yet" : post.kind === "article" ? "Text post" : "No picture yet"}</span>
          </div>
        ) : undefined
      }
      // Its set is still being made: the same loading screen as the day's set, over whatever the card has.
      mediaOverlay={
        isMaking && (
          <div className={cn("size-full", hasMedia ? "bg-[var(--bp-dialog)]/85 backdrop-blur-sm" : "bg-soft")}>
            <MakingScreen size="sm" progress={making!} />
          </div>
        )
      }
      mediaBadges={
        post.autoScheduledAt && post.status !== "PENDING_APPROVAL" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/40 px-2.5 py-1 text-[12px] leading-none font-semibold text-white backdrop-blur-md">
            <Sparkles aria-hidden className="size-3.5" /> Auto
          </span>
        ) : undefined
      }
      badges={
        post.idea || post.trendingSound || post.contest?.pending || (post.carryCount > 0 && post.status !== "EXPIRED") ? (
          <>
            {post.idea && <span className={cn(CHIP, "bg-soft text-text")}>{post.idea}</span>}
            {post.trendingSound && (
              <span className={cn(CHIP, "max-w-full gap-1 bg-soft text-text")}>
                <Music aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">Trending sound: {soundLabel(post.trendingSound)}</span>
              </span>
            )}
            {post.contest?.pending && <span className={cn(CHIP, "bg-new-bg text-new")}>Needs your confirmation: prize & rules</span>}
            {/* A missed day moved it (lib/content-board/carry-over.ts): after 3 moves, the next miss expires it. */}
            {post.carryCount > 0 && post.status !== "EXPIRED" && (
              <span className={cn(CHIP, "bg-amber-500/15 text-amber-800 dark:text-amber-300")}>{post.carryCount === 1 ? "Moved from a missed day" : `Moved ${post.carryCount} times`}</span>
            )}
          </>
        ) : undefined
      }
      meta={
        <>
          <span>{type}</span>
          <time dateTime={post.createdAt} suppressHydrationWarning>
            · Created {dateOnly(post.createdAt, zone)}
          </time>
          {showSubject && <span>· {post.subject?.name ?? "General"}</span>}
          {post.source === "AUTOPILOT" && <span>· Autopilot</span>}
          {post.source === "DAILY" && <span suppressHydrationWarning>· {dailyPostLabel(post.createdAt, zone)}</span>}
        </>
      }
      notes={
        post.status === "EXPIRED" ? (
          <p className="flex items-center gap-2 bg-soft px-4 py-2.5 text-[13px] text-muted">
            <CircleDashed aria-hidden className="size-4 shrink-0" />
            <span>
              <span className="font-semibold">Not posted</span> · It missed its day 3 times
            </span>
          </p>
        ) : unposted ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-amber-500/15 px-4 py-2.5 text-[13px] text-amber-900 dark:text-amber-200">
            <CircleDashed aria-hidden className="size-4 shrink-0" />
            <span>
              <span className="font-semibold">Not posted yet</span>
              {" · "}
              {unpostedReason(post, (iso) => formatDateTime(iso, zone), post.scheduledAt)}
            </span>
            {post.remindOnly && (
              <Link href="/dashboard/connections" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                Connect {networkLabel(post.network)}
              </Link>
            )}
          </p>
        ) : undefined
      }
      footer={
        <>
          {actions}
          <WhatsAppShare media={post.media} caption={postShareCaption(post)} what="post" />
        </>
      }
    />
  );
}
