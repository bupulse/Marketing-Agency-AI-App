"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { InlineVideo } from "./video-card";
import type { MediaItem } from "./types";
import s from "./media-cards.module.css";

/** One picture, fading and settling in when it has loaded. */
export function Picture({ item, fit = "cover", eager = false }: { item: MediaItem; fit?: "cover" | "contain"; eager?: boolean }) {
  const [ready, setReady] = useState(false);
  return (
    // Post pictures are signed storage links, which next/image is not configured for.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.url}
      alt={item.alt ?? ""}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onLoad={() => setReady(true)}
      ref={(el) => {
        if (el?.complete && el.naturalWidth && !ready) setReady(true);
      }}
      className={cn(s.media, fit === "contain" && s.mediaContain, ready ? "scale-100 opacity-100" : "scale-[1.04] opacity-0")}
    />
  );
}

export type MediaStageProps = {
  media: readonly MediaItem[];
  /** For the buttons' names: the post's first words. */
  title: string;
  fit?: "cover" | "contain";
  /** Clicking a picture (not a video) opens the post. */
  onOpen?: (slide: number) => void;
  /** Videos play right away (the opened post). */
  autoPlay?: boolean;
  /** Where the dots go: under the picture (Instagram) or on it. */
  dots?: "below" | "over" | "none";
  className?: string;
  /** Where the "2/4" count sits (bottom right when the top right holds the status). */
  count?: "top" | "bottom";
  /** The slide shown, for a parent that keeps it (PostModal). */
  slide?: number;
  onSlide?: (slide: number) => void;
};

/**
 * A post's media: one picture, one video (plays inline) or a carousel of up to 10 that swipes on phones, with arrows on
 * computers, a "2/4" count and dots.
 */
export function MediaStage({ media, title, fit = "cover", onOpen, autoPlay = false, dots = "below", count = "top", className, slide, onSlide }: MediaStageProps) {
  const track = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState(0);
  const at = slide ?? own;
  const many = media.length > 1;

  const setAt = (i: number) => {
    setOwn(i);
    onSlide?.(i);
  };
  const goTo = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(0, Math.min(media.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // A parent that changes the slide (keys in PostModal) scrolls the track there.
  useEffect(() => {
    const el = track.current;
    if (el && slide != null && Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) !== slide) el.scrollTo({ left: slide * el.clientWidth });
  }, [slide]);

  if (media.length === 0) return null;

  const frame = (m: MediaItem, i: number) =>
    m.kind === "video" ? (
      <InlineVideo key={i} video={{ src: m.url, poster: m.poster, previewSrc: m.previewUrl, durationMs: m.durationMs }} title={title} autoPlay={autoPlay && i === at} fit={fit} onExpand={onOpen && !autoPlay ? () => onOpen(i) : undefined} />
    ) : onOpen ? (
      <button key={i} type="button" onClick={() => onOpen(i)} aria-label={`Open post: ${title}${many ? `, picture ${i + 1} of ${media.length}` : ""}`} className="relative block size-full cursor-zoom-in overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-pulse-blue focus-visible:ring-inset">
        <Picture item={m} fit={fit} eager={i === 0} />
      </button>
    ) : (
      <div key={i} className="relative size-full overflow-hidden">
        <Picture item={m} fit={fit} eager={i === 0} />
      </div>
    );

  return (
    <div className={cn("relative", className)}>
      <div className={cn(s.zoomHost, s.stage, "relative size-full overflow-hidden")}>
        {many ? (
          <div
            ref={track}
            className={cn(s.carousel, "flex size-full overflow-x-auto")}
            onScroll={(e) => {
              const el = e.currentTarget;
              const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
              if (i !== at) setAt(i);
            }}
            aria-roledescription="carousel"
            aria-label={`${media.length} pictures`}
          >
            {media.map((m, i) => (
              <div key={i} className="relative size-full shrink-0 grow-0 basis-full" aria-roledescription="slide" aria-label={`${i + 1} of ${media.length}`}>
                {frame(m, i)}
              </div>
            ))}
          </div>
        ) : (
          frame(media[0], 0)
        )}

        {many && (
          <>
            <span className={cn("pointer-events-none absolute right-3 z-[3] rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-white backdrop-blur-md", count === "top" ? "top-3" : dots === "over" ? "bottom-8" : "bottom-3")}>
              {at + 1}/{media.length}
            </span>
            {at > 0 && (
              <button type="button" onClick={() => goTo(at - 1)} aria-label="Previous picture" className={cn(s.arrow, "absolute top-1/2 left-2 z-[3] grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/90 text-[#1d1d1f] shadow-lg")}>
                <ChevronLeft aria-hidden className="size-5" />
              </button>
            )}
            {at < media.length - 1 && (
              <button type="button" onClick={() => goTo(at + 1)} aria-label="Next picture" className={cn(s.arrow, "absolute top-1/2 right-2 z-[3] grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/90 text-[#1d1d1f] shadow-lg")}>
                <ChevronRight aria-hidden className="size-5" />
              </button>
            )}
            {dots === "over" && <Dots count={media.length} at={at} className="absolute inset-x-0 bottom-3 z-[3] text-white" />}
          </>
        )}
      </div>
      {many && dots === "below" && <Dots count={media.length} at={at} className="absolute inset-x-0 -bottom-5 text-pulse-blue" />}
    </div>
  );
}

function Dots({ count, at, className }: { count: number; at: number; className?: string }) {
  return (
    <span aria-hidden className={cn("pointer-events-none flex justify-center gap-1", className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn(s.dot, i === at && s.dotOn)} />
      ))}
    </span>
  );
}
