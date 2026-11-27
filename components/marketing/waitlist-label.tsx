"use client";

import { ArrowRight, Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { countdown, formatCountdown, type Countdown } from "@/lib/waitlist";

// The main button's label when the site banner's "main button" is set to count down (lib/site-banner.ts): it swaps
// between the countdown and the button's words ("Get a free quote") every 4 seconds and keeps the words on hover.

/** How long the button shows each label before it flips. */
export const SWAP_MS = 4_000;

/** Time left, ticking every second. Null until the page is in the browser, so the server and browser render the same. */
export function useCountdown(launchAt: string): Countdown | null {
  const [left, setLeft] = useState<Countdown | null>(null);
  useEffect(() => {
    const tick = () => setLeft(countdown(launchAt));
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [launchAt]);
  return left;
}

/**
 * The main button's label when it counts down: the countdown and the button's own words ("Get a free quote", or
 * "Start your free trial" where the trial is offered) take turns every 4 seconds, stacked in one grid cell so the
 * button keeps the width of the longer one. While the pointer or keyboard focus is on it, it stays on the words
 * (owner, 27 Nov 2026: the main button says "Get a free quote", never "Get started"). After zero it keeps the words.
 */
export function CountdownLabel({ until, active, label }: { until: string; active: boolean; label: string }) {
  const left = useCountdown(until);
  const [showTime, setShowTime] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => setShowTime((v) => !v), SWAP_MS);
    return () => window.clearInterval(id);
  }, []);
  const counting = left !== null && !left.done;
  const shown: "time" | "words" = !active && counting && showTime ? "time" : "words";
  const layer = (key: typeof shown) =>
    cn(
      "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-[opacity,transform] duration-500 ease-out-soft motion-reduce:transition-none",
      shown === key ? "translate-y-0 opacity-100" : "pointer-events-none opacity-0",
      shown !== key && (key === "time" ? "-translate-y-2" : "translate-y-2"),
    );
  return (
    <span className="grid">
      <span className={layer("time")} aria-hidden={shown !== "time"}>
        <Hourglass aria-hidden className="size-4" />
        <span className="tabular-nums">{left ? formatCountdown(left) : "00d 00h 00m"}</span>
      </span>
      <span className={layer("words")} aria-hidden={shown !== "words"}>
        {label}
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </span>
  );
}
