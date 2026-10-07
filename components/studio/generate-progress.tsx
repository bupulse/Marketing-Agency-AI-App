"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

const STEPS = [
  "Reading your project",
  "Writing the caption",
  "Choosing hashtags",
  "Drafting the video script",
  "Polishing the ad headlines",
  "Preparing versions for each network",
];

/** A calm progress state for the 5 to 15 seconds a text takes to write. */
export function GenerateProgress({ title = "Writing your content" }: { title?: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2400);
    return () => clearInterval(id);
  }, []);

  const percent = Math.round(((step + 1) / (STEPS.length + 1)) * 100);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-5 px-4 py-10 text-center">
      <span className="inline-flex size-16 animate-pulse items-center justify-center rounded-3xl bg-brand-gradient text-white shadow-glow motion-reduce:animate-none">
        <Sparkles aria-hidden className="size-7" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-[15px] text-muted">{STEPS[step]}…</p>
      </div>
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-soft"
      >
        <div
          className="h-full origin-left rounded-full bg-brand-gradient transition-[width] duration-[2000ms] ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[13px] text-muted">This usually takes 10 to 20 seconds.</p>
    </div>
  );
}
