"use client";

import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { QuizRing } from "@/components/knowledge/quiz-ring";
import { Button } from "@/components/ui";
import { localDay, quizBannerHere, quizBannerText } from "@/lib/knowledge/quiz-banner";

const STORAGE_KEY = "bp-quiz-banner-hidden-on";
const listeners = new Set<() => void>();

function readHiddenToday(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === localDay();
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * "Finish your Business info: a 5-minute quiz" at the top of every dashboard page until Business info is complete
 * (the layout leaves it out at 100% or when the person can play no round). "Not now" hides it until tomorrow.
 */
export function QuizBanner({ overall, href, label, nextRound }: { overall: number; href: string; label: string; nextRound: { emoji: string; title: string } | null }) {
  const pathname = usePathname();
  const hiddenToday = useSyncExternalStore(subscribe, readHiddenToday, () => false);
  const [closed, setClosed] = useState(false);
  if (closed || hiddenToday || !quizBannerHere(pathname)) return null;

  const hide = () => {
    setClosed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, localDay());
    } catch {
      // Hidden until the next page load only.
    }
    listeners.forEach((l) => l());
  };

  const title = overall === 0 ? "Tell BuPulse about your business: a 5-minute quiz" : "Finish your Business info: a 5-minute quiz";
  return (
    <section
      aria-label={title}
      className="glass-strong relative flex flex-wrap items-center gap-x-4 gap-y-3 overflow-hidden rounded-[20px] border border-pulse-violet/30 p-3.5 pr-11 sm:flex-nowrap sm:px-4 sm:pr-12"
    >
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-brand-gradient" />
      <QuizRing percent={overall} className="size-12 sm:size-14" />
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <p className="text-[15px] font-semibold leading-snug">{title}</p>
        <p className="text-[13px] text-muted">{quizBannerText(overall, nextRound)} Better info means better posts and chat replies.</p>
      </div>
      <Button href={href} className="w-full shrink-0 sm:w-auto" trailing={<ArrowRight aria-hidden className="size-4" />}>
        {label}
      </Button>
      <button
        type="button"
        onClick={hide}
        aria-label="Not now: hide until tomorrow"
        title="Not now"
        className="absolute right-2 top-2 inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-soft hover:text-text"
      >
        <X aria-hidden className="size-4" />
      </button>
    </section>
  );
}
