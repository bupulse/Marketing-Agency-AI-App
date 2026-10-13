"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CircleDashed, FileText, Play, Sparkles } from "lucide-react";
import { NetworkIcon } from "@/components/publishing/network-icon";
import { formatDateTime } from "@/components/publishing/helpers";
import { cn } from "@/lib/cn";
import type { ContentPost } from "@/lib/content-board/queries";
import { kindLabel } from "@/lib/content-board/kind";
import { CHIP_STYLE, networkLabel, statusChip, UNPOSTED, unpostedReason } from "@/lib/content-board/labels";

const dateOnly = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(iso));

/**
 * One post as a card: its picture, carousel (dots) or video (still with a play mark), the app and post type, the start
 * of the caption, its status and when it was made. Like a social post at a glance, in BuPulse's own look. The whole
 * top part opens the post; `actions` (approve, edit...) sit below it as separate buttons.
 */
export function PostCard({ post, zone, onOpen, actions, showSubject = false }: { post: ContentPost; zone: string; onOpen: () => void; actions?: ReactNode; showSubject?: boolean }) {
  const chip = statusChip(post, (iso) => (post.status === "PUBLISHED" ? dateOnly(iso, zone) : formatDateTime(iso, zone)));
  const still = post.media.find((m) => !/\.(mp4|webm)$/i.test(m.path))?.url ?? post.poster;
  const video = post.kind === "video";
  const slides = post.kind === "carousel" ? post.media.length : 0;
  const type = kindLabel(post.kind, post.network);
  const caption = (post.title ? `${post.title}. ` : "") + post.text;
  // Not posted yet: a warning-colour border plus an icon and words, so it does not rely on colour alone.
  const unposted = UNPOSTED.includes(post.status);

  return (
    <article className={cn("glass flex h-full flex-col overflow-hidden rounded-card", unposted && "border-2 border-amber-500 dark:border-amber-400")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${networkLabel(post.network)} ${type}, ${chip.label}. Open`}
        className="group flex flex-1 cursor-pointer flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-blue focus-visible:ring-inset"
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-soft">
          {still ? (
            // Signed storage URLs: plain <img>, lazy, they are short-lived and not worth the image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
          ) : video && post.media[0] ? (
            <video src={post.media[0].url} muted playsInline preload="metadata" aria-hidden className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <FileText aria-hidden className="size-8" />
              <span className="text-[13px]">{video ? "Video not made yet" : post.kind === "article" ? "Text post" : "No picture yet"}</span>
            </div>
          )}
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--bp-dialog)]/90 py-1 pr-2.5 pl-1 text-[12px] font-semibold text-text shadow-glass">
            <NetworkIcon network={post.network} size={22} />
            {type}
          </span>
          {post.autoScheduledAt && post.status !== "PENDING_APPROVAL" && (
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-[var(--bp-dialog)]/90 px-2.5 py-1 text-[12px] font-semibold text-ok shadow-glass">
              <Sparkles aria-hidden className="size-3.5" /> Auto
            </span>
          )}
          {video && (
            <span aria-hidden className="absolute inset-0 flex items-center justify-center">
              <span className="inline-flex size-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                <Play className="size-6 translate-x-0.5" fill="currentColor" />
              </span>
            </span>
          )}
          {slides > 1 && (
            <span aria-hidden className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {Array.from({ length: Math.min(slides, 10) }, (_, i) => (
                <span key={i} className={cn("size-1.5 rounded-full", i === 0 ? "bg-white" : "bg-white/55")} />
              ))}
            </span>
          )}
          {slides > 1 && <span className="sr-only">{slides} slides</span>}
        </div>

        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold", CHIP_STYLE[chip.tone])}>{chip.label}</span>
          <p className="line-clamp-3 text-[15px] break-words whitespace-pre-line">{caption.trim() || <span className="text-muted">No caption yet</span>}</p>
          <p className="mt-auto flex flex-wrap gap-x-2 text-[13px] text-muted">
            <time dateTime={post.createdAt} suppressHydrationWarning>
              Created {dateOnly(post.createdAt, zone)}
            </time>
            {showSubject && <span>· {post.subject?.name ?? "General"}</span>}
            {post.source === "AUTOPILOT" && <span>· Autopilot</span>}
          </p>
        </div>
      </button>
      {unposted && (
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
      )}
      {actions && <div className="flex flex-wrap gap-2 border-t border-line p-3">{actions}</div>}
    </article>
  );
}
