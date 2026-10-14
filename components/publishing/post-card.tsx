"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { MOVABLE, STATUS_LABEL, STATUS_STYLE } from "@/lib/publishing/status";
import type { CalendarPost } from "@/lib/publishing/types";
import { formatTime, snippet } from "./helpers";
import { NetworkIcon, networkName } from "./network-icon";
import { ResultsBadge, resultsSummary } from "./post-results";
import { MediaThumb } from "@/components/visuals/media-thumb";

type Props = {
  post: CalendarPost;
  zone: string;
  /** One line, for month cells. */
  compact?: boolean;
  onOpen: (post: CalendarPost) => void;
  /** Alt+arrow keys (and dragging) move a post; undefined disables moving. */
  onMoveByDays?: (post: CalendarPost, days: number) => void;
  onDragStart?: (post: CalendarPost) => void;
};

const ARROW_DAYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** A post on the calendar: coloured by status, with its time, network and a glimpse of the text. */
export function PostCard({ post, zone, compact, onOpen, onMoveByDays, onDragStart }: Props) {
  const style = STATUS_STYLE[post.status];
  const movable = Boolean(onMoveByDays) && post.scheduledAt !== null && (MOVABLE as readonly string[]).includes(post.status);
  const time = post.scheduledAt ? formatTime(post.scheduledAt, zone) : "No time";
  const results = resultsSummary(post.results);
  const label = `${networkName(post.network)}, ${post.scheduledAt ? time : "no time set"}, ${STATUS_LABEL[post.status]}: ${snippet(post.text, 60) || "no text"}${results ? `. ${results}` : ""}`;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(post);
    } else if (movable && e.altKey && e.key in ARROW_DAYS) {
      e.preventDefault();
      onMoveByDays?.(post, ARROW_DAYS[e.key]);
    }
  }

  function dragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("text/plain", post.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart?.(post);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-keyshortcuts={movable ? "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" : undefined}
      draggable={movable}
      onDragStart={movable ? dragStart : undefined}
      onClick={() => onOpen(post)}
      onKeyDown={onKeyDown}
      data-status={post.status}
      className={cn(
        "flex w-full min-w-0 cursor-pointer select-none flex-col gap-1 rounded-xl border text-left text-[13px] transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-blue",
        movable && "active:cursor-grabbing",
        compact ? "px-2 py-1" : "p-2.5",
        style.card,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", style.dot)} />
        <span className="shrink-0 font-semibold tabular-nums">{time}</span>
        <NetworkIcon network={post.network} size={compact ? 14 : 18} />
        {compact && <span className="min-w-0 truncate text-muted">{snippet(post.text, 40)}</span>}
      </div>
      {compact && <ResultsBadge results={post.results} className="text-[11px]" />}
      {!compact && (
        <div className="flex min-w-0 items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 break-words text-muted">{snippet(post.text, 120) || (post.media.length ? "Photo post" : "No text yet")}</p>
          {post.media[0] && <MediaThumb url={post.media[0].url} loading="lazy" className="size-9 shrink-0 rounded-lg object-cover" />}
        </div>
      )}
      {/* A published post with results shows them in place of its "Published" label (the card's colour still says it). */}
      {!compact && (results ? <ResultsBadge results={post.results} /> : post.status !== "SCHEDULED" && (
        <span className={cn("self-start rounded-full px-2 py-0.5 text-[11px] font-semibold", style.badge)}>{STATUS_LABEL[post.status]}</span>
      ))}
    </div>
  );
}
