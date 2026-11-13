"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronUp, Maximize2, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { aspectRatio, durationLabel } from "./helpers";
import { useFinePointer, useInView, usePointerFx, useReducedMotion } from "./hooks";
import { PlatformIcons, StatusPill } from "./parts";
import type { Platform, StatusKey } from "./types";
import s from "./media-cards.module.css";

export type VideoSource = {
  /** The video (a signed link). */
  src: string;
  poster?: string | null;
  /** A short muted clip for the hover preview; the video itself when missing. */
  previewSrc?: string | null;
  durationMs?: number | null;
  /** "9:16" | "4:5" | "1:1" | "16:9" */
  ratio?: string | null;
};

/** The still of a video: its poster, or the video's first frame when it has none (or its link has expired). */
function Still({ video, alt = "", fit = "cover" }: { video: VideoSource; alt?: string; fit?: "cover" | "contain" }) {
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState(false);
  if (video.poster && !broken)
    return (
      // Posters are signed storage links, which next/image is not configured for.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={video.poster}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setReady(true)}
        onError={() => setBroken(true)}
        ref={(el) => {
          if (el?.complete && el.naturalWidth && !ready) setReady(true);
        }}
        className={cn(s.media, fit === "contain" && s.mediaContain, ready ? "opacity-100" : "opacity-0")}
      />
    );
  return <video src={`${video.src}#t=0.1`} preload="metadata" muted playsInline aria-hidden className={cn(s.media, fit === "contain" && s.mediaContain)} />;
}

/**
 * The muted preview that plays while the pointer is on the card (computers only, never with reduced motion). It starts
 * after a short pause so sweeping over a grid does not start every video.
 */
function useHoverPreview(host: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const fine = useFinePointer();
  const calm = useReducedMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el || !fine || calm || !enabled) return;
    let t = 0;
    const enter = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setOn(true), 140);
    };
    const leave = () => {
      window.clearTimeout(t);
      setOn(false);
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      window.clearTimeout(t);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
    };
  }, [host, fine, calm, enabled]);
  return on;
}

function Preview({ video }: { video: VideoSource }) {
  const [playing, setPlaying] = useState(false);
  return (
    <video
      src={video.previewSrc ?? video.src}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      aria-hidden
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
      className={cn(s.media, s.preview, playing && s.previewOn)}
    />
  );
}

/** A video's still with the muted hover preview, for a tile that is not a VideoCard (MediaTile). */
export function VideoStill({ video, fit = "cover", host }: { video: VideoSource; fit?: "cover" | "contain"; host: React.RefObject<HTMLElement | null> }) {
  const previewing = useHoverPreview(host, true);
  return (
    <>
      <Still video={video} fit={fit} />
      {previewing && <Preview video={video} />}
    </>
  );
}

export type VideoCardProps = {
  video: VideoSource;
  title: string;
  /** Small line above the title: "Video Studio · Motion", "Daily slideshow". */
  eyebrow?: string | null;
  status?: StatusKey | null;
  statusLabel?: string | null;
  /** Already formatted: "12 Nov 2026", "Next post Fri 12:30". */
  dateLabel?: string | null;
  platforms?: readonly Platform[];
  /** The product or campaign it is about. */
  product?: string | null;
  /** A line or two about it (its caption). */
  note?: string | null;
  /** Extra marks on the top left ("New"). */
  badge?: ReactNode;
  /** Real actions (Schedule, Download, Share, Delete): shown in the glass panel when it opens. */
  actions?: ReactNode;
  /** Opens the full player. */
  onOpen?: () => void;
  /** The card the page opened on (?v=): a blue ring. */
  focused?: boolean;
  /** Position in its grid, for the staggered rise-in. */
  index?: number;
  id?: string;
  className?: string;
};

/**
 * A video as a dark 9:16 (or 16:9 / 1:1) card, like samples.bupulse.com/team/videos.html: the poster, a muted preview
 * while the pointer is on it, a glass play button, the length, the gradient border that follows the pointer, and the
 * liquid-glass panel that rises with the details and actions on hover or keyboard focus. On phones a tap plays it (the
 * full player) and the arrow on the panel shows the details and actions.
 */
export function VideoCard({ video, title, eyebrow, status, statusLabel, dateLabel, platforms = [], product, note, badge, actions, onOpen, focused, index = 0, id, className }: VideoCardProps) {
  const card = useRef<HTMLElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { seen } = useInView(card);
  usePointerFx(card, glass);
  const previewing = useHoverPreview(card, true);
  const length = durationLabel(video.durationMs);
  const style = { aspectRatio: aspectRatio(video.ratio), "--i": Math.min(index, 8) } as CSSProperties;

  return (
    <article
      ref={card}
      id={id}
      style={style}
      className={cn(s.lift, s.video, "relative w-full min-w-0 select-none", seen ? s.rise : "opacity-0", open && s.openGlass, focused && "outline-[3px] outline-offset-[3px] outline-pulse-blue outline-solid", className)}
    >
      <Still video={video} />
      {previewing && <Preview video={video} />}
      <span aria-hidden className={s.scrim} />

      {/* The whole card plays the video. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Play ${title}${length ? `, ${length}` : ""}`}
        className="absolute inset-0 z-[3] flex cursor-pointer items-start justify-center rounded-[26px] pt-[30%] outline-none focus-visible:ring-[3px] focus-visible:ring-white/90 focus-visible:ring-inset"
      >
        <span className={cn(s.play, s.playIdle)} aria-hidden>
          <Play className="ml-0.5 size-6 fill-current" />
        </span>
      </button>

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[4] flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {status && <StatusPill status={status} label={statusLabel} glass />}
          {badge}
        </span>
        {length && <span className={s.chip}>{length}</span>}
      </div>

      <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 z-[5]">
        <div ref={glass} className={s.glass}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {eyebrow && <span className="block truncate font-mono text-[10.5px] tracking-[0.08em] text-white/80 uppercase">{eyebrow}</span>}
              <h3 className="mt-0.5 line-clamp-2 text-[15.5px] leading-tight font-semibold tracking-[-0.01em]">{title}</h3>
            </div>
            {/* Phones: the details and actions behind an arrow (no hover there). */}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? "Hide details" : "Show details and actions"}
              className="pointer-events-auto -m-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-white [@media(hover:hover)]:hidden"
            >
              <ChevronUp aria-hidden className={cn("size-5 transition-transform duration-300", open && "rotate-180")} />
            </button>
          </div>
          <div className={s.more}>
            <div>
              <div className="flex flex-col gap-2.5 pt-2.5">
                {(platforms.length > 0 || product || dateLabel) && (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px] text-white/90">
                    {platforms.length > 0 && <PlatformIcons platforms={platforms} size={20} />}
                    {product && <span className="rounded-md border border-white/25 bg-white/15 px-2 py-0.5 font-mono text-[11px]">{product}</span>}
                    {dateLabel && <span>{dateLabel}</span>}
                  </div>
                )}
                {note && <p className="line-clamp-4 text-[13px] leading-snug text-white/90">{note}</p>}
                {actions && (
                  <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-t border-white/20 pt-2.5 [text-shadow:none]" onClick={(e) => e.stopPropagation()}>
                    {actions}
                  </div>
                )}
                {onOpen && (
                  <span className="text-[12.5px] font-semibold">
                    Watch with sound <span aria-hidden>→</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * A video inside a post (PostCard, PostModal): the still with the glass play button; a tap plays it right there (sound
 * on, a mute button in the corner), a tap again pauses. On computers a muted preview plays while the pointer is on it.
 * `onExpand` shows a button that opens the post or the full player.
 */
export function InlineVideo({ video, title, onExpand, autoPlay = false, fit = "cover", className }: { video: VideoSource; title: string; onExpand?: () => void; autoPlay?: boolean; fit?: "cover" | "contain"; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(autoPlay);
  const [muted, setMuted] = useState(false);
  const previewing = useHoverPreview(host, !started);
  const { now } = useInView(host, "0px");
  const length = durationLabel(video.durationMs);

  useEffect(() => {
    if (el.current) el.current.muted = muted;
  }, [muted, started]);

  // Scrolled away: pause.
  useEffect(() => {
    if (!now && el.current && !el.current.paused) el.current.pause();
  }, [now]);

  const toggle = () => {
    if (!started) {
      setStarted(true);
      return;
    }
    const v = el.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div ref={host} className={cn(s.playHost, "relative size-full overflow-hidden bg-black", className)}>
      {!started && <Still video={video} fit={fit} />}
      {!started && previewing && <Preview video={video} />}
      {started && (
        <video
          ref={el}
          src={video.src}
          poster={video.poster ?? undefined}
          autoPlay
          playsInline
          muted={muted}
          loop
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedData={(e) => {
            // A browser that blocks sound: play muted instead.
            const v = e.currentTarget;
            // loadeddata often comes before autoplay starts, so try with sound first and mute only when refused.
            if (v.paused && !v.ended) {
              void v.play().catch(() => {
                setMuted(true);
                v.muted = true;
                void v.play().catch(() => {});
              });
            }
          }}
          className={cn(s.media, fit === "contain" && s.mediaContain)}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Pause ${title}` : `Play ${title}${length ? `, ${length}` : ""}`}
        className="absolute inset-0 z-[2] grid cursor-pointer place-items-center outline-none focus-visible:ring-[3px] focus-visible:ring-white/90 focus-visible:ring-inset"
      >
        <span aria-hidden className={cn(s.play, playing && s.playHidden)}>
          <Play className="ml-0.5 size-6 fill-current" />
        </span>
      </button>
      <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 z-[3] flex items-end justify-between gap-2">
        {length && !playing ? <span className={s.chip}>{length}</span> : <span />}
        <span className="pointer-events-auto flex gap-1.5">
          {started && (
            <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Sound on" : "Sound off"} className={cn(s.fbtn, "!size-11")}>
              {muted ? <VolumeX aria-hidden className="size-[18px]" /> : <Volume2 aria-hidden className="size-[18px]" />}
            </button>
          )}
          {onExpand && (
            <button type="button" onClick={onExpand} aria-label="Open" className={cn(s.fbtn, "!size-11")}>
              <Maximize2 aria-hidden className="size-[18px]" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
