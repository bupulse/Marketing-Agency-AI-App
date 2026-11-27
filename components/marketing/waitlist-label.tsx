"use client";

import { ArrowRight, Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { countdown, formatCountdown, type Countdown, type WaitlistInfo } from "@/lib/waitlist";

// The main button's label while the pre-launch waiting list is on (lib/waitlist.ts, docs/WAITLIST.md): it swaps
// between the countdown and "Get started" every 4 seconds and says "Get a free quote" while the pointer is on it.

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
 * The main button's label while the waiting list is on: the countdown and "Get started" take turns every 4 seconds
 * (stacked in one grid cell, so the button keeps the width of the longest), and "Get a free quote" shows while the
 * pointer or keyboard focus is on the button. After the launch moment it stays on "Get started".
 */
export function WaitlistLabel({ info, active }: { info: WaitlistInfo; active: boolean }) {
  const left = useCountdown(info.launchAt);
  const [showTime, setShowTime] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => setShowTime((v) => !v), SWAP_MS);
    return () => window.clearInterval(id);
  }, []);
  const counting = left !== null && !left.done;
  const shown: "time" | "start" | "quote" = active ? "quote" : counting && showTime ? "time" : "start";
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
      <span className={layer("start")} aria-hidden={shown !== "start"}>
        Get started
        <ArrowRight aria-hidden className="size-4" />
      </span>
      <span className={layer("quote")} aria-hidden={shown !== "quote"}>
        Get a free quote
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </span>
  );
}
