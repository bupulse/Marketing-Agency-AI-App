"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { NetworkIcon, networkName } from "@/components/publishing/network-icon";
import { cn } from "@/lib/cn";
import { aspectRatio, isLandscape } from "./helpers";
import { useDialog, useReducedMotion, useSwipe } from "./hooks";
import { useMounted } from "./media-player";
import { MediaStage } from "./media-stage";
import { PLATFORM_LOOK, PreviewIcons } from "./post-card";
import { AccountPicture, ActionRow, CaptionText, StatusPill } from "./parts";
import type { MediaAction, PostDetailView } from "./types";
import s from "./media-cards.module.css";

export type PostModalProps = {
  posts: readonly PostDetailView[];
  /** The open post; null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Our real actions for a post (Edit, Schedule, Approve, Delete); none shows the platform's icon row. */
  actionsFor?: (post: PostDetailView) => MediaAction[];
  /** The slide to open on (from PostCard's onOpen). */
  startSlide?: number;
  /** More in the right column, under the caption and details (notes, a move form, results...). */
  renderBody?: (post: PostDetailView, index: number) => ReactNode;
  /** The bottom of the right column instead of the action row (a page's own buttons). */
  renderFooter?: (post: PostDetailView, index: number) => ReactNode;
};

/**
 * The opened post, like Instagram on a computer: the media on the left on black, and on the right the account row, the
 * whole caption with blue hashtags, tabs when each platform has its own caption, the details (time, platforms, product
 * or campaign), and the actions with the date at the bottom. Previous and next sit outside the box; Esc closes; ← →
 * change post. On phones it is a full-screen sheet with the media on top; swipe left or right on the media for the next
 * post.
 */
export function PostModal(props: PostModalProps) {
  const mounted = useMounted();
  if (!mounted || props.index == null || !props.posts[props.index]) return null;
  return createPortal(<Modal key={props.posts[props.index].id} {...props} index={props.index} />, document.body);
}

function Modal({ posts, index, onIndexChange, onClose, actionsFor, startSlide = 0, renderBody, renderFooter }: PostModalProps & { index: number }) {
  const post = posts[index];
  const root = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const titleId = useId();
  const calm = useReducedMotion();
  const [tab, setTab] = useState(0);
  const [slide, setSlide] = useState(startSlide);
  const [closing, setClosing] = useState(false);
  const versions = [{ platform: post.platform, caption: post.caption, hashtags: post.hashtags, status: post.status }, ...(post.variants ?? []).filter((v) => v.platform !== post.platform)];
  const shown = versions[Math.min(tab, versions.length - 1)];
  const actions = actionsFor?.(post) ?? [];
  const look = PLATFORM_LOOK[post.platform] ?? PLATFORM_LOOK.instagram;
  const ratio = look.ratio;

  const go = useCallback(
    (step: 1 | -1) => {
      // Not while it closes: the close would land on the post opened next.
      if (closing) return;
      const next = index + step;
      if (next >= 0 && next < posts.length) onIndexChange(next);
    },
    [closing, index, posts.length, onIndexChange],
  );
  const close = useCallback(() => {
    if (calm) return onClose();
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 200);
  }, [calm, onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useDialog(true, root, {
    Escape: (e) => {
      e.preventDefault();
      close();
    },
    ArrowLeft: (e) => {
      if ((e.target as HTMLElement).closest("[role=tablist]")) return;
      e.preventDefault();
      go(-1);
    },
    ArrowRight: (e) => {
      if ((e.target as HTMLElement).closest("[role=tablist]")) return;
      e.preventDefault();
      go(1);
    },
  });
  // Phones: swipe on the media for the next post (a carousel swipes its pictures first).
  useSwipe(media, (d) => {
    if (post.media.length > 1) return;
    if (d === "left") go(1);
    if (d === "right") go(-1);
    // Only from the top: on a phone the sheet scrolls, and a drag down on the media to scroll back up must not close it.
    if (d === "down" && (sheet.current?.scrollTop ?? 0) <= 0) close();
  });

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn("fixed inset-0 z-[120] flex items-stretch justify-center outline-none md:items-center md:p-6 lg:px-24", closing ? s.backdropOut : s.backdrop)}
    >
      <div aria-hidden onClick={close} className="absolute inset-0 bg-[rgba(8,9,20,0.78)] backdrop-blur-[14px]" />

      {/* Previous and next, outside the box */}
      {posts.length > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous post (←)" className={cn(s.fbtn, "absolute top-1/2 left-4 z-[2] -translate-y-1/2 max-md:!hidden")}>
            <ChevronLeft aria-hidden className="size-6" />
          </button>
          <button type="button" onClick={() => go(1)} disabled={index === posts.length - 1} aria-label="Next post (→)" className={cn(s.fbtn, "absolute top-1/2 right-4 z-[2] -translate-y-1/2 max-md:!hidden")}>
            <ChevronRight aria-hidden className="size-6" />
          </button>
        </>
      )}
      <button type="button" onClick={close} aria-label="Close (Esc)" className={cn(s.fbtn, "absolute top-4 right-4 z-[2] max-md:!hidden")}>
        <X aria-hidden className="size-[22px]" />
      </button>

      <div
        ref={sheet}
        className={cn(
          s.sheetIn,
          "relative z-[1] flex w-full flex-col overflow-hidden bg-surface text-text shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)] dark:bg-[#141419]",
          "md:h-[min(860px,calc(100svh-48px))] md:max-w-[1180px] md:flex-row md:rounded-[22px]",
          "max-md:h-[100svh] max-md:overflow-y-auto",
        )}
      >
        {/* Phone top bar */}
        <div className="sticky top-0 z-[4] flex items-center gap-2 border-b border-line bg-surface/90 px-2 py-1 backdrop-blur-xl md:hidden dark:bg-[#141419]/90">
          <button type="button" onClick={close} aria-label="Close" className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-soft">
            <X aria-hidden className="size-5" />
          </button>
          <span className="flex-1 truncate text-center text-[15px] font-semibold">{networkName(post.platform)} post</span>
          <span className="font-mono text-[12px] text-muted tabular-nums">{posts.length > 1 ? `${index + 1}/${posts.length}` : ""}</span>
          <span className="w-2" />
        </div>

        {/* The media */}
        <div ref={media} className={cn("relative shrink-0 bg-black md:flex md:min-w-0 md:flex-1 md:items-center md:justify-center", post.media.length === 0 && "max-md:hidden")}>
          {post.media.length > 0 ? (
            <div
              className="relative mx-auto w-full max-md:max-h-[62svh] md:h-full md:w-auto md:max-w-full"
              style={{ aspectRatio: aspectRatio(isLandscape(ratio) ? ratio : post.media[0].kind === "video" ? "9:16" : ratio) }}
            >
              <MediaStage media={post.media} title={post.caption.slice(0, 60)} fit="contain" autoPlay dots="over" className="absolute inset-0" slide={slide} onSlide={setSlide} />
            </div>
          ) : (
            <div className="grid size-full min-h-80 place-items-center bg-[linear-gradient(135deg,#2f6bff,#7b5cff)] p-10 text-center text-[22px] leading-snug font-semibold text-white">{post.title || post.caption.slice(0, 140)}</div>
          )}
        </div>

        {/* The right column */}
        <section className="flex min-h-0 flex-col md:w-[400px] md:shrink-0 md:border-l md:border-line lg:w-[420px]">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <AccountPicture account={post.account} platform={post.platform} size={38} ring={post.platform === "instagram"} />
            <div className="min-w-0 flex-1 leading-tight">
              <span id={titleId} className="block truncate text-[14.5px] font-semibold">
                {post.account.name}
              </span>
              <span className="block truncate text-[12.5px] text-muted">{post.subject ? post.subject.name : networkName(post.platform)}</span>
            </div>
            {shown.status && <StatusPill status={shown.status} label={tab === 0 ? post.statusLabel : null} />}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 max-md:overflow-visible">
            {versions.length > 1 && (
              <div role="tablist" aria-label="Caption for each app" className="mb-4 flex gap-1 overflow-x-auto rounded-full bg-soft p-1" onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const n = (tab + (e.key === "ArrowRight" ? 1 : versions.length - 1)) % versions.length;
                setTab(n);
                (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
              }}>
                {versions.map((v, i) => (
                  <button
                    key={v.platform}
                    type="button"
                    role="tab"
                    aria-selected={i === tab}
                    tabIndex={i === tab ? 0 : -1}
                    onClick={() => setTab(i)}
                    className={cn("inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-300", i === tab ? "bg-surface text-text shadow-sm dark:bg-white/15" : "text-muted hover:text-text")}
                  >
                    <NetworkIcon network={v.platform} size={18} />
                    {networkName(v.platform)}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-3" role={versions.length > 1 ? "tabpanel" : undefined}>
              <AccountPicture account={post.account} size={32} ring={false} />
              <p className="min-w-0 flex-1 text-[14.5px] leading-[1.5]">
                <span className="font-semibold">{post.account.handle?.replace(/^@/, "") || post.account.name}</span> <CaptionText text={shown.caption} hashtags={shown.hashtags} />
                {post.timeLabel && <span className="mt-2 block text-[12px] text-muted">{post.timeLabel}</span>}
              </p>
            </div>

            {post.details && post.details.length > 0 && (
              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-2xl border border-line p-4 text-[13.5px]">
                {post.details.map((d) => (
                  <div key={d.label} className="contents">
                    <dt className="text-muted">{d.label}</dt>
                    <dd className="min-w-0 text-right font-medium break-words">{d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {renderBody && <div className="mt-5 flex flex-col gap-4">{renderBody(post, index)}</div>}
          </div>

          <footer className="shrink-0 border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:max-h-[45%] md:overflow-y-auto max-md:max-h-[42svh] max-md:overflow-y-auto max-md:sticky max-md:bottom-0 max-md:bg-surface/95 max-md:backdrop-blur-xl max-md:dark:bg-[#141419]/95">
            {renderFooter ? (
              renderFooter(post, index)
            ) : actions.length > 0 ? (
              <ActionRow actions={actions} />
            ) : (
              <div className="-mx-4 [&>div]:pt-0">
                <PreviewIcons platform={post.platform} />
              </div>
            )}
            {post.dateLine && <p className="mt-2 text-[12px] tracking-wide text-muted uppercase">{post.dateLine}</p>}
          </footer>
        </section>
      </div>
    </div>
  );
}
