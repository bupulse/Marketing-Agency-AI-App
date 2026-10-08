"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { InstallStep } from "@/lib/widget/install";
import { SceneView } from "./install-scenes";
import "./install-guide.css";

const STEP_SECONDS = 7;

/**
 * Animated, step-by-step visual of how to install. Auto-advances (the active dot's fill finishing moves on),
 * pauses on hover or focus, and every step can be clicked. With reduced motion it shows still frames and
 * never advances by itself.
 */
export function Walkthrough({ steps, accent }: { steps: InstallStep[]; accent: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const step = steps[Math.min(index, steps.length - 1)];

  const go = (i: number) => setIndex((i + steps.length) % steps.length);

  return (
    <div
      className={cn("flex flex-col gap-4", paused && "ig-paused")}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="ig-stage" key={`${index}-${steps.length}`}>
        <SceneView scene={step.scene} accent={accent} />
      </div>

      <p aria-live="polite" className="-mt-1 px-1 text-[14px] font-medium">
        <span className="text-muted">Step {index + 1} of {steps.length}</span> — {step.title}
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="ig-dots" role="group" aria-label="Steps">
          {steps.map((s, i) => (
            <button
              key={s.title + i}
              type="button"
              className="ig-dotbtn"
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={i === index ? "step" : undefined}
              onClick={() => go(i)}
            >
              <span
                className={cn("ig-dot", i === index && "active", i < index && "done")}
                style={{ "--dur": `${STEP_SECONDS}s` } as React.CSSProperties}
              >
                <i onAnimationEnd={(e) => i === index && e.target === e.currentTarget && go(i + 1)} />
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous step" onClick={() => go(index - 1)} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button type="button" aria-label="Next step" onClick={() => go(index + 1)} className="flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-soft">
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
      </div>

      <ol className="ig-steps flex flex-col gap-1" aria-label="Installation steps">
        {steps.map((s, i) => (
          <li key={s.title + i} aria-current={i === index ? "step" : undefined} className="rounded-2xl">
            <button type="button" onClick={() => go(i)} className="flex cursor-pointer items-start gap-3 rounded-2xl p-3 text-left">
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                  i === index ? "bg-brand-gradient text-white" : "bg-line text-muted",
                )}
              >
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14.5px] font-semibold">{s.title}</span>
                <span className="text-[13.5px] text-muted">{s.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
