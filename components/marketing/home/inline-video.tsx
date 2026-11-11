"use client";

import { Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "./scroll-scene";

/**
 * A muted, looping video that loads and plays only while it is on screen (preload="none" until then) and pauses
 * when it leaves. Wide screens get the sharper file. A button turns the sound on. Under reduced motion it does not
 * start by itself: the poster shows with a play button.
 */
export function AutoVideo({
  small,
  large,
  poster,
  label,
  className,
}: {
  small: string;
  large?: string;
  poster: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [manual, setManual] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const pick = () => (large && window.matchMedia("(min-width: 768px)").matches ? large : small);
    const reduced = prefersReducedMotion();
    const io = new IntersectionObserver(
      ([entry]) => {
        if (reduced) {
          // No autoplay: show the play button once the visitor reaches it.
          if (entry.isIntersecting) setManual(true);
          return;
        }
        if (entry.isIntersecting) {
          if (!video.getAttribute("src")) video.src = pick();
          video.play().catch(() => setManual(true));
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [small, large]);

  const start = () => {
    const video = ref.current;
    if (!video) return;
    if (!video.getAttribute("src")) video.src = large && window.matchMedia("(min-width: 768px)").matches ? large : small;
    video.muted = false;
    setMuted(false);
    setManual(false);
    video.play().catch(() => {});
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <video
        ref={ref}
        muted={muted}
        loop
        playsInline
        preload="none"
        poster={poster}
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="block size-full object-cover"
      />
      {manual && !playing ? (
        <button type="button" onClick={start} className="iv-play" aria-label={`Play: ${label}`}>
          <Play aria-hidden className="size-7 translate-x-0.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            const video = ref.current;
            if (!video) return;
            video.muted = !muted;
            setMuted(!muted);
          }}
          className="iv-sound"
          aria-pressed={!muted}
        >
          {muted ? <VolumeX aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
          {muted ? "Sound on" : "Sound off"}
        </button>
      )}
    </div>
  );
}

/** A poster with a play button; the video file is only fetched when the visitor presses play. */
export function TapVideo({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <video
        ref={ref}
        playsInline
        preload="none"
        poster={poster}
        controls={started}
        aria-label={label}
        className="block size-full object-cover"
      />
      {!started && (
        <button
          type="button"
          className="iv-play"
          aria-label={`Play: ${label}`}
          onClick={() => {
            const video = ref.current;
            if (!video) return;
            video.src = src;
            setStarted(true);
            video.play().catch(() => {});
          }}
        >
          <Play aria-hidden className="size-7 translate-x-0.5" />
        </button>
      )}
    </div>
  );
}
