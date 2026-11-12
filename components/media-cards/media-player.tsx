"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Info, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { aspectRatio, clock, isLandscape } from "./helpers";
import { useDialog, useMedia, useReducedMotion, useSwipe } from "./hooks";
import s from "./media-cards.module.css";

export type PlayerItem = {
  id: string;
  src: string;
  poster?: string | null;
  title: string;
  eyebrow?: string | null;
  ratio?: string | null;
  /** The details in the side panel (facts, caption). */
  info?: ReactNode;
  /** Real actions (Schedule, Download, Share, Delete), in the side panel. Styled for a dark background. */
  actions?: ReactNode;
};

export type MediaPlayerProps = {
  items: readonly PlayerItem[];
  /** The open item; null when the player is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

const noop = () => () => {};
/** True in the browser after hydration (portals need document.body). */
export const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/**
 * The full player (the lightbox of samples.bupulse.com): the page goes dark and blurred behind the video's own colours,
 * the video plays big with glass controls (play, the scrub bar, time, sound, full screen), previous and next on the side,
 * and the details and actions in a panel (a sheet on phones, behind the (i) button). Keys: Esc closes, Space pauses,
 * ← → move 5 s, ↑ ↓ change video, M sound, F full screen. On phones: swipe up or left for the next video.
 */
export function MediaPlayer({ items, index, onIndexChange, onClose }: MediaPlayerProps) {
  const mounted = useMounted();
  if (!mounted || index == null || !items[index]) return null;
  return createPortal(<Player items={items} index={index} onIndexChange={onIndexChange} onClose={onClose} />, document.body);
}

function Player({ items, index, onIndexChange, onClose }: MediaPlayerProps & { index: number }) {
  const item = items[index];
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const calm = useReducedMotion();
  const wide = useMedia("(min-width: 768px)", true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const [closing, setClosing] = useState(false);
  const idleTimer = useRef(0);

  const go = useCallback(
    (step: 1 | -1) => {
      const next = index + step;
      if (next < 0 || next >= items.length) return;
      setDir(step > 0 ? "next" : "prev");
      setTime(0);
      setLength(0);
      onIndexChange(next);
    },
    [index, items.length, onIndexChange],
  );

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (calm) return onClose();
    setClosing(true);
    window.setTimeout(onClose, 200);
  }, [calm, onClose]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const seek = (by: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.min(Math.max(0, v.currentTime + by), v.duration || 0);
  };
  const fullscreen = () => {
    const el = stage.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (el?.requestFullscreen) return void el.requestFullscreen().catch(() => {});
    // iPhone Safari: only the video itself goes full screen.
    v?.webkitEnterFullscreen?.();
  };

  useDialog(true, root, {
    Escape: (e) => {
      e.preventDefault();
      if (infoOpen && !wide) setInfoOpen(false);
      else close();
    },
    " ": (e) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      e.preventDefault();
      toggle();
    },
    k: () => toggle(),
    ArrowLeft: (e) => {
      if ((e.target as HTMLElement).matches("input[type=range]")) return;
      e.preventDefault();
      seek(-5);
    },
    ArrowRight: (e) => {
      if ((e.target as HTMLElement).matches("input[type=range]")) return;
      e.preventDefault();
      seek(5);
    },
    ArrowUp: (e) => {
      e.preventDefault();
      go(-1);
    },
    ArrowDown: (e) => {
      e.preventDefault();
      go(1);
    },
    m: () => setMuted((m) => !m),
    f: () => fullscreen(),
  });

  useSwipe(stage, (d) => (d === "up" || d === "left" ? go(1) : go(-1)));

  // React does not keep the muted property in step by itself.
  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted, item.id]);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // The controls fade out while the video plays and nothing moves.
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  const land = isLandscape(item.ratio);
  const pct = length ? (time / length) * 100 : 0;
  const anim = calm ? "" : dir === "next" ? s.stageNext : dir === "prev" ? s.stagePrev : s.stageIn;

  const infoPanel = (
    <>
      {item.eyebrow && <span className="font-mono text-[11px] tracking-[0.1em] text-[#9fb2ff] uppercase">{item.eyebrow}</span>}
      <h2 id={titleId} className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-white">
        {item.title}
      </h2>
      {item.info && <div className="flex flex-col gap-3 text-[14px] text-[#c9cbe0]">{item.info}</div>}
      {item.actions && <div className="dark flex flex-wrap items-start gap-2 border-t border-white/10 pt-4">{item.actions}</div>}
      <p className="hidden flex-wrap items-center gap-1 pt-2 text-[12.5px] text-[#a3a6c2] md:flex">
        {[
          ["↑ ↓", "change video"],
          ["Space", "pause"],
          ["← →", "5 s"],
          ["M", "sound"],
          ["F", "full screen"],
          ["Esc", "close"],
        ].map(([k, v]) => (
          <span key={k} className="mr-1.5 inline-flex items-center gap-1">
            <kbd className="rounded-md border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white">{k}</kbd>
            {v}
          </span>
        ))}
      </p>
    </>
  );

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onPointerMove={wake}
      className={cn("fixed inset-0 z-[120] grid bg-black text-[#f4f4fb] outline-none md:grid-cols-[minmax(0,1fr)_380px]", closing ? s.backdropOut : s.backdrop)}
    >
      <div aria-hidden className={s.bgBlur} style={{ backgroundImage: item.poster ? `url("${item.poster}")` : "linear-gradient(135deg,#1b2a6b,#3a1f6e)" }} />

      <div className="relative min-h-0 min-w-0">
        {/* The video */}
        <div ref={stage} className={cn("absolute inset-0 flex items-center justify-center md:p-6", full && "bg-black !p-0")}>
          <div
            key={item.id}
            className={cn("relative overflow-hidden bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] max-md:size-full md:rounded-[22px]", anim)}
            style={wide ? { aspectRatio: aspectRatio(item.ratio), height: land ? "auto" : "100%", width: land ? "100%" : "auto", maxHeight: "100%", maxWidth: "100%" } : undefined}
          >
            <video
              ref={video}
              src={item.src}
              poster={item.poster ?? undefined}
              autoPlay
              playsInline
              muted={muted}
              preload="auto"
              onPlay={() => {
                setPlaying(true);
                wake();
              }}
              onPause={() => {
                setPlaying(false);
                setIdle(false);
              }}
              onEnded={() => go(1)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
              onLoadedData={(e) => {
                // A browser that blocks sound until a tap: play muted, the sound button turns it on.
                const v = e.currentTarget;
                if (v.paused && !v.ended) {
                  v.muted = true;
                  setMuted(true);
                  void v.play().catch(() => {});
                }
              }}
              onClick={toggle}
              className={cn("size-full cursor-pointer", land || wide ? "object-contain" : "object-cover")}
              aria-label={item.title}
            />
            {!playing && length > 0 && (
              <button type="button" onClick={toggle} aria-label="Play" className="absolute inset-0 grid place-items-center">
                <span className={s.play} aria-hidden>
                  <Play className="ml-0.5 size-6 fill-current" />
                </span>
              </button>
            )}
            {/* The glass controls */}
            <div className={cn(s.controls, "absolute inset-x-3 bottom-3 z-[2] max-md:bottom-[max(12px,env(safe-area-inset-bottom))]", idle && playing && s.controlsIdle)} data-no-swipe>
              <div className={cn(s.glass, "!rounded-2xl !px-3 !py-2")}>
                <input
                  type="range"
                  min={0}
                  max={length || 0}
                  step={0.05}
                  value={Math.min(time, length || 0)}
                  onChange={(e) => {
                    const v = video.current;
                    if (v) v.currentTime = Number(e.target.value);
                    setTime(Number(e.target.value));
                  }}
                  aria-label="Seek"
                  aria-valuetext={`${clock(time)} of ${clock(length)}`}
                  className={s.scrub}
                  style={{ ["--p" as string]: `${pct}%` }}
                />
                <div className="flex items-center gap-1">
                  <button type="button" onClick={toggle} aria-label={playing ? "Pause (Space)" : "Play (Space)"} className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-white/15">
                    {playing ? <Pause aria-hidden className="size-5 fill-current" /> : <Play aria-hidden className="ml-0.5 size-5 fill-current" />}
                  </button>
                  <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Sound on (M)" : "Sound off (M)"} className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-white/15">
                    {muted ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
                  </button>
                  <span className="font-mono text-[12px] tabular-nums text-white/90">
                    {clock(time)} / {clock(length)}
                  </span>
                  <span className="flex-1" />
                  <button type="button" onClick={fullscreen} aria-label={full ? "Leave full screen (F)" : "Full screen (F)"} className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-white/15">
                    {full ? <Minimize aria-hidden className="size-5" /> : <Maximize aria-hidden className="size-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top: close and the count */}
        <div className="absolute top-[max(14px,env(safe-area-inset-top))] left-3.5 z-[5] flex items-center gap-3">
          <button type="button" onClick={close} aria-label="Close (Esc)" className={s.fbtn}>
            <X aria-hidden className="size-[22px]" />
          </button>
          {items.length > 1 && (
            <span className="rounded-full bg-black/35 px-2.5 py-1 font-mono text-[12.5px] text-white/90 backdrop-blur-md">
              {index + 1} / {items.length}
            </span>
          )}
        </div>

        {/* The rail: previous, next, details */}
        <div className="absolute top-1/2 right-3.5 z-[5] flex -translate-y-1/2 flex-col gap-2.5 max-md:top-auto max-md:bottom-28 max-md:translate-y-0">
          {items.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous video (↑)" className={s.fbtn}>
                <ChevronUp aria-hidden className="size-[22px]" />
              </button>
              <button type="button" onClick={() => go(1)} disabled={index === items.length - 1} aria-label="Next video (↓)" className={s.fbtn}>
                <ChevronDown aria-hidden className="size-[22px]" />
              </button>
            </>
          )}
          <button type="button" onClick={() => setInfoOpen((o) => !o)} aria-expanded={infoOpen} aria-label="About this video" className={cn(s.fbtn, "md:hidden")}>
            <Info aria-hidden className="size-[22px]" />
          </button>
        </div>

        {items.length > 1 && !calm && (
          <span aria-hidden className={cn(s.hint, "pointer-events-none absolute bottom-24 left-1/2 z-[4] -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-[13px] whitespace-nowrap backdrop-blur-md md:hidden")}>
            Swipe up for the next video
          </span>
        )}
      </div>

      {/* Details: a side panel on computers, a sheet on phones */}
      <aside
        aria-label="About this video"
        className={cn(
          "relative z-[6] flex flex-col gap-3 overflow-y-auto bg-[rgba(14,14,30,0.92)] p-6 backdrop-blur-xl md:border-l md:border-white/10",
          "max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[64svh] max-md:rounded-t-[22px] max-md:pb-[max(24px,env(safe-area-inset-bottom))] max-md:transition-transform max-md:duration-500 max-md:ease-[cubic-bezier(.22,1,.36,1)]",
          !wide && !infoOpen && "max-md:pointer-events-none max-md:translate-y-[105%]",
        )}
        inert={!wide && !infoOpen ? true : undefined}
      >
        <span aria-hidden className="mx-auto -mt-2 mb-1 h-1 w-10 rounded-full bg-white/25 md:hidden" />
        {infoPanel}
      </aside>
    </div>
  );
}
