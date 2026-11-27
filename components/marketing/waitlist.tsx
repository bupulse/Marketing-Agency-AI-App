"use client";

import { ArrowRight, Hourglass } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCountdown, type BannerColor, type WaitlistInfo } from "@/lib/waitlist";
import { useQuoteCta } from "./quote/cta";
import { useCountdown } from "./waitlist-label";

// The pre-launch waiting list's Christmas banner above the menu (lib/waitlist.ts, docs/WAITLIST.md). Its button opens
// the quote pop-up ("Reserve your spot"). The main button's swapping label is in ./waitlist-label.tsx.

/** Background, text, countdown chip and button per banner colour (Admin -> Settings -> Waiting list and free trial). */
const LOOK: Record<BannerColor, { bar: string; chip: string; button: string }> = {
  brand: { bar: "bg-brand-gradient text-white", chip: "bg-white/15", button: "bg-white text-ink" },
  red: { bar: "bg-[#d91f26] text-white", chip: "bg-black/15", button: "bg-white text-[#b3161c]" },
  orange: { bar: "bg-[#ff7a1a] text-[#1a1006]", chip: "bg-black/10", button: "bg-[#1a1006] text-white" },
  black: { bar: "bg-[#0b0b0f] text-white", chip: "bg-white/12", button: "bg-[#ff7a1a] text-[#1a1006]" },
};

/** The Christmas banner at the very top of every public page while the waiting list is on. */
export function WaitlistBanner({ info }: { info: WaitlistInfo }) {
  const left = useCountdown(info.launchAt);
  const { openQuote } = useQuoteCta();
  const done = left?.done ?? false;
  const look = LOOK[info.bannerColor] ?? LOOK.brand;
  return (
    <div role="region" aria-label="BuPulse launch" className={cn("relative z-40", look.bar)}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-2 text-center text-[13px] leading-snug sm:text-sm">
        <p className="m-0 font-medium">
          <span aria-hidden>🎄 </span>
          {done ? (
            <>BuPulse is launching. Your AI marketing team is almost here.</>
          ) : (
            <>
              <span className="sm:hidden">Your own AI marketing team this Christmas.</span>
              <span className="hidden sm:inline">This Christmas, your business gets its own AI marketing team.</span>{" "}
              <span className="opacity-90">Launching {info.shortLabel}.</span>
            </>
          )}
        </p>
        {!done && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold tabular-nums", look.chip)} aria-live="off">
            <Hourglass aria-hidden className="size-3.5" />
            {/* Same width before the first tick, so nothing jumps. */}
            <span className={cn(!left && "invisible")}>{left ? formatCountdown(left, true) : "00d 00h 00m 00s"}</span>
            <span className="sr-only"> until launch</span>
          </span>
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={openQuote}
          className={cn("inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold transition-transform hover:-translate-y-px motion-reduce:transition-none", look.button)}
        >
          Reserve your spot
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
