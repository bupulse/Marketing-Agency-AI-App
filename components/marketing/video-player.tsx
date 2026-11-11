"use client";

import { Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import "./video-player.css";

/**
 * BuPulse's inline video player (the sample site's player, as one React component): a poster with a big centred
 * play button, then a thin blue-to-violet progress bar you can scrub, play/pause, 10-second jumps, the time, sound
 * and an optional full screen button. Controls fade out while it plays and come back on mouse move, tap or focus.
 *
 * - Plays inside its own frame (playsInline): never full screen unless the visitor presses the button.
 * - Light: preload="none" until the visitor plays it (or, with autoPlayInView, until it is on screen).
 * - Keyboard (when the player has focus): Space or K play/pause, ← → 5 s, J L 10 s, M sound, F full screen.
 * - autoPlayInView: starts muted and looping while at least half on screen, pauses when it leaves. Never under
 *   prefers-reduced-motion, where the poster and play button wait for the visitor.
 */

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

type Props = {
  /** The file for phones (and every screen when `srcLarge` is missing). */
  src: string;
  /** A sharper file for screens 768 px and wider. */
  srcLarge?: string;
  poster: string;
  /** What the video is, for the accessible name and the play button. */
  title: string;
  /** Known length in seconds, shown before the file has loaded. */
  seconds?: number;
  autoPlayInView?: boolean;
  /** Show the full screen button (never used automatically). */
  allowFullscreen?: boolean;
  className?: string;
};

export function VideoPlayer({ src, srcLarge, poster, title, seconds = 0, autoPlayInView = false, allowFullscreen = true, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const idleTimer = useRef(0);
  const dragging = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(autoPlayInView);
  const [waiting, setWaiting] = useState(false);
  const [idle, setIdle] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(seconds);
  const [buffered, setBuffered] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [flash, setFlash] = useState<{ key: number; text: string } | null>(null);

  const pickSrc = useCallback(() => (srcLarge && window.matchMedia("(min-width: 768px)").matches ? srcLarge : src), [src, srcLarge]);

  const ensureSrc = useCallback(() => {
    const v = video.current;
    if (v && !v.getAttribute("src")) v.src = pickSrc();
  }, [pickSrc]);

  // Controls fade out 2.5 s after the last sign of the visitor while it plays.
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (video.current && !video.current.paused && !dragging.current) setIdle(true);
    }, 2500);
  }, []);

  const play = useCallback(() => {
    const v = video.current;
    if (!v) return;
    ensureSrc();
    setStarted(true);
    v.play().catch(() => setPlaying(false));
  }, [ensureSrc]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) play();
    else v.pause();
    wake();
  }, [play, wake]);

  const seekBy = useCallback(
    (d: number) => {
      const v = video.current;
      if (!v || !v.duration) return;
      v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + d));
      setFlash({ key: Date.now(), text: `${d < 0 ? "−" : "+"}${Math.abs(d)} s` });
      wake();
    },
    [wake],
  );

  const toggleMute = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    wake();
  }, [wake]);

  const toggleFull = useCallback(() => {
    const el = box.current;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el || !v) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.();
  }, []);

  // Autoplay (muted, looping) while on screen.
  useEffect(() => {
    const v = video.current;
    if (!v || !autoPlayInView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          ensureSrc();
          v.muted = true;
          v.loop = true;
          v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [autoPlayInView, ensureSrc]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  const fracAt = (x: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  const seekTo = (f: number) => {
    const v = video.current;
    if (!v) return;
    ensureSrc();
    setStarted(true);
    if (v.duration) {
      v.currentTime = f * v.duration;
      setTime(v.currentTime);
    } else {
      v.addEventListener("loadedmetadata", () => (v.currentTime = f * v.duration), { once: true });
      v.load();
    }
  };

  const onScrubDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    e.currentTarget.dataset.drag = "1";
    seekTo(fracAt(e.clientX));
  };
  const onScrubMove = (e: PointerEvent<HTMLDivElement>) => {
    const f = fracAt(e.clientX);
    setHover(f);
    if (dragging.current) seekTo(f);
  };
  const onScrubUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    delete e.currentTarget.dataset.drag;
    wake();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = (e.target as HTMLElement).tagName === "BUTTON";
    const k = e.key.toLowerCase();
    if ((k === " " || k === "enter") && onButton) return;
    const acts: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      arrowleft: () => seekBy(-5),
      arrowright: () => seekBy(5),
      j: () => seekBy(-10),
      l: () => seekBy(10),
      m: toggleMute,
      ...(allowFullscreen ? { f: toggleFull } : {}),
    };
    if (acts[k]) {
      e.preventDefault();
      acts[k]();
    }
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const showControls = started || playing;

  return (
    <div
      ref={box}
      role="group"
      aria-label={`Video: ${title}`}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={(e) => e.pointerType === "mouse" && wake()}
      onFocus={wake}
      className={cn("vp", playing && "vp-playing", idle && playing && "vp-idle", waiting && "vp-waiting", full && "vp-full", className)}
    >
      <video
        ref={video}
        poster={poster}
        playsInline
        preload="none"
        muted={muted}
        aria-hidden
        tabIndex={-1}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          wake();
        }}
        onPause={() => {
          setPlaying(false);
          setIdle(false);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => !dragging.current && setTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.duration && v.buffered.length) setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
        }}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onEnded={() => setIdle(false)}
        onClick={(e) => {
          // Mouse: click plays or pauses. Touch: a tap shows the controls first, a tap on them acts.
          if ((e.nativeEvent as globalThis.PointerEvent).pointerType === "touch" && idle) return wake();
          toggle();
        }}
        className="vp-video"
      />

      <span aria-hidden className="vp-spin" />
      {flash && (
        <span key={flash.key} aria-hidden className="vp-flash">
          {flash.text}
        </span>
      )}

      {autoPlayInView && playing && muted && (
        <button type="button" className="vp-unmute" onClick={toggleMute}>
          <VolumeX aria-hidden className="size-4" />
          Sound on
        </button>
      )}

      <button type="button" className="vp-big" onClick={toggle} aria-label={playing ? `Pause ${title}` : `Play ${title}`}>
        {playing ? <Pause aria-hidden className="size-7" /> : <Play aria-hidden className="size-7 translate-x-0.5" />}
      </button>

      <div className={cn("vp-bar", !showControls && "vp-bar-pre")}>
        <div
          ref={rail}
          className="vp-scrub"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              e.stopPropagation();
              seekBy(e.key === "ArrowLeft" ? -5 : 5);
            }
          }}
        >
          <span className="vp-rail">
            <i className="vp-buf" style={{ width: `${buffered}%` }} />
            {hover !== null && <i className="vp-hov" style={{ width: `${hover * 100}%` }} />}
            <i className="vp-played" style={{ width: `${pct}%` }} />
          </span>
          <span className="vp-knob" style={{ left: `${pct}%` }} />
          {hover !== null && (
            <span className="vp-tip" style={{ left: `${hover * 100}%` }}>
              {clock(hover * duration)}
            </span>
          )}
        </div>
        <div className="vp-row">
          <button type="button" className="vp-btn" onClick={toggle} aria-label={playing ? "Pause (K)" : "Play (K)"}>
            {playing ? <Pause aria-hidden className="size-[18px]" /> : <Play aria-hidden className="size-[18px]" />}
          </button>
          <button type="button" className="vp-btn vp-hide-xs" onClick={() => seekBy(-10)} aria-label="Back 10 seconds (J)">
            <RotateCcw aria-hidden className="size-4" />
          </button>
          <button type="button" className="vp-btn vp-hide-xs" onClick={() => seekBy(10)} aria-label="Forward 10 seconds (L)">
            <RotateCw aria-hidden className="size-4" />
          </button>
          <span className="vp-time" aria-hidden>
            {clock(time)} / {clock(duration)}
          </span>
          <span className="flex-1" />
          <button type="button" className="vp-btn" onClick={toggleMute} aria-label={muted ? "Sound on (M)" : "Sound off (M)"} aria-pressed={!muted}>
            {muted ? <VolumeX aria-hidden className="size-[18px]" /> : <Volume2 aria-hidden className="size-[18px]" />}
          </button>
          {allowFullscreen && (
            <button type="button" className="vp-btn" onClick={toggleFull} aria-label={full ? "Exit full screen (F)" : "Full screen (F)"}>
              {full ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
