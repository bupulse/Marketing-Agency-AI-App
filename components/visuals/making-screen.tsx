"use client";

/**
 * The loading screen while a post's set is made (owner, 11 November 2026): a big percentage ring in BuPulse's blue to
 * violet that climbs fast to about 60%, then slows, and jumps to 100% when the set is ready; the current step in words
 * (Writing captions → Designing images → Making the reel → Adding music → Ready); each image fading in the moment it is
 * ready. With reduced motion the ring and the number move in calm steps, without glow or fades.
 * The maths: components/visuals/making-progress.ts.
 *
 *   <MakingScreen progress={...} />             the big one (Create post dialog, the day's set)
 *   <MakingScreen progress={...} size="sm" />   in a picture or video frame
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { easedPercent, realPercent, shownPercent, STEP_LABEL, STEP_MS, stepsFor, type MakingProgress } from "./making-progress";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the visitor asked for less motion (false on the server). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** The number on screen, ticking with the eased clock (every 100 ms, or every second with reduced motion). */
export function useShownPercent(progress: MakingProgress, reduced: boolean, startedAt?: number): number {
  const done = progress.step === "ready";
  const real = realPercent(progress);
  const slow = STEP_MS[progress.step] || 45_000;
  const start = useRef<number | null>(startedAt ?? null);
  const [shown, setShown] = useState(() => (done ? 100 : Math.max(1, real)));
  useEffect(() => {
    if (start.current === null) start.current = Date.now();
    const tick = () => setShown((prev) => shownPercent(prev, easedPercent(Date.now() - (start.current ?? Date.now()), 6_000, slow), real, done));
    tick();
    if (done) return;
    const timer = setInterval(tick, reduced ? 1_000 : 100);
    return () => clearInterval(timer);
  }, [real, done, slow, reduced]);
  return shown;
}

/** The ring: a soft track and a blue-to-violet arc, the number in the middle. */
export function MakingRing({ percent, size = "lg", reduced, label }: { percent: number; size?: "lg" | "sm"; reduced: boolean; label: string }) {
  const id = useId().replace(/:/g, "");
  const big = size === "lg";
  const box = big ? 176 : 96;
  const stroke = big ? 12 : 8;
  const r = (box - stroke) / 2 - 2;
  const length = 2 * Math.PI * r;
  const value = Math.round(percent);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}%, ${label}`}
      aria-label={label}
      className={cn("relative grid shrink-0 place-items-center", big ? "size-44" : "size-24")}
    >
      {/* A slow glow behind the ring while it works; none with reduced motion or once ready. */}
      {!reduced && value < 100 && <span aria-hidden className={cn("absolute rounded-full bg-[conic-gradient(from_0deg,#2f6bff,#7b5cff,#2f6bff)] opacity-25 blur-xl motion-safe:animate-[spin_6s_linear_infinite]", big ? "inset-3" : "inset-2")} />}
      <svg viewBox={`0 0 ${box} ${box}`} className="relative size-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2f6bff" />
            <stop offset="100%" stopColor="#7b5cff" />
          </linearGradient>
        </defs>
        <circle cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(100, Math.max(0, percent)) / 100)}
          className={cn(!reduced && "transition-[stroke-dashoffset] duration-300 ease-out")}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <span className={cn("font-bold tabular-nums tracking-[-0.04em] text-text", big ? "text-[44px] leading-none" : "text-[22px] leading-none")}>
          {value}
          <span className={cn("align-top font-semibold text-muted", big ? "text-[20px]" : "text-[12px]")}>%</span>
        </span>
      </span>
    </div>
  );
}

/** An image that fades in once it has loaded (at once with reduced motion). */
export function FadeImage({ src, alt, className, reduced }: { src: string; alt: string; className?: string; reduced: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image that loaded before the page woke up (server-rendered, cached) fired its load event too early.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
    <img ref={ref} src={src} alt={alt} onLoad={() => setLoaded(true)} className={cn(className, !reduced && "transition-[opacity,transform] duration-700 ease-out", loaded || reduced ? "scale-100 opacity-100" : "scale-[0.97] opacity-0")} />
  );
}

/** The whole screen: ring, step in words, the steps, and the images as they arrive. */
export function MakingScreen({ progress, size = "lg", title, className, startedAt }: { progress: MakingProgress; size?: "lg" | "sm"; title?: string; className?: string; startedAt?: number }) {
  const reduced = useReducedMotion();
  const percent = useShownPercent(progress, reduced, startedAt);
  const steps = stepsFor(progress);
  const current = steps.indexOf(progress.step);
  const label = progress.failed ?? STEP_LABEL[progress.step];
  const images = progress.images ?? [];

  if (size === "sm") {
    return (
      <div className={cn("flex size-full flex-col items-center justify-center gap-3 p-4 text-center", className)}>
        <MakingRing percent={percent} size="sm" reduced={reduced} label={label} />
        <p aria-live="polite" className={cn("text-[13px] font-semibold", progress.failed ? "text-danger" : "text-text")}>
          {label}
          {!progress.failed && progress.step !== "ready" && <span className="text-muted">…</span>}
        </p>
      </div>
    );
  }

  return (
    <section aria-label={title ?? "Making your post"} className={cn("@container relative overflow-hidden rounded-[22px] border border-line bg-glass p-5 sm:p-6", className)}>
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[radial-gradient(circle,rgba(123,92,255,0.18),transparent_70%)]" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-12 size-48 rounded-full bg-[radial-gradient(circle,rgba(47,107,255,0.16),transparent_70%)]" />
      <div className="relative flex flex-col items-center gap-5 @lg:flex-row @lg:items-center @lg:gap-8">
        <MakingRing percent={percent} reduced={reduced} label={label} />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-4 @lg:items-start">
          {title && <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</p>}
          <p aria-live="polite" className={cn("text-center text-[22px] font-bold tracking-[-0.02em] @lg:text-left", progress.failed ? "text-danger" : "bg-[linear-gradient(110deg,#2f6bff,#7b5cff)] bg-clip-text text-transparent")}>
            {label}
            {!progress.failed && progress.step !== "ready" && "…"}
          </p>
          <ol className="flex flex-wrap justify-center gap-2 @lg:justify-start">
            {steps.map((s, i) => {
              const state = i < current || progress.step === "ready" ? "done" : i === current ? "now" : "later";
              return (
                <li
                  key={s}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold",
                    state === "done" && "bg-ok-bg text-ok",
                    state === "now" && "bg-[linear-gradient(110deg,#2f6bff,#7b5cff)] text-white shadow-[0_8px_20px_-12px_rgba(47,107,255,0.9)]",
                    state === "later" && "bg-soft text-muted",
                  )}
                >
                  {state === "done" ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden className={cn("size-1.5 rounded-full", state === "now" ? "bg-white" : "bg-current opacity-50")} />}
                  {STEP_LABEL[s]}
                  <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (now)" : ""}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {images.length > 0 && (
        <ul aria-label="Images" className="relative mt-5 grid grid-cols-2 gap-2 @md:grid-cols-4">
          {images.map((img, i) => (
            <li key={i} className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-soft">
              {img.url ? (
                <FadeImage src={img.url} alt={img.alt || `Image ${i + 1}`} reduced={reduced} className="size-full object-cover" />
              ) : (
                <span className="absolute inset-0 grid place-items-center">
                  <span className="sr-only">Image {i + 1} is being designed</span>
                  <span aria-hidden className={cn("h-1.5 w-1/2 overflow-hidden rounded-full bg-line")}>
                    <span className={cn("block h-full w-full rounded-full bg-[linear-gradient(90deg,#2f6bff,#7b5cff)]", !reduced && "motion-safe:animate-pulse")} />
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
