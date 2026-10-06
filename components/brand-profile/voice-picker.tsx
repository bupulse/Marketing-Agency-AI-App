"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { sampleTopic, voices } from "@/lib/brand/voices";
import type { BrandValues, Errors } from "./steps";

/** Six voice cards as a radio group: arrow keys move and select, Tab enters and leaves the group. */
export function VoicePicker({
  values,
  errors,
  onChange,
  businessName,
  industry,
}: {
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
  businessName: string;
  industry: string | null;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const topic = sampleTopic(industry);
  const selectedIndex = voices.findIndex((v) => v.id === values.tone);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const next = (index + move + voices.length) % voices.length;
    onChange({ tone: voices[next].id });
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Brand voice" aria-describedby={errors.tone ? "voice-error" : undefined} className="grid gap-3 sm:grid-cols-2">
        {voices.map((voice, i) => {
          const selected = voice.id === values.tone;
          return (
            <button
              key={voice.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (selectedIndex === -1 && i === 0) ? 0 : -1}
              onClick={() => onChange({ tone: voice.id })}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "glass relative flex min-h-11 cursor-pointer flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-[border-color,background-color] duration-200 motion-reduce:transition-none",
                selected ? "border-pulse-blue" : "border-transparent hover:border-line",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold">{voice.label}</span>
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full",
                    selected ? "bg-brand-gradient text-white" : "border border-line",
                  )}
                >
                  {selected && <Check className="size-3.5" />}
                </span>
              </span>
              <span className="text-[13px] text-muted">{voice.description}</span>
              <span className="rounded-xl bg-soft px-3 py-2 text-[13px] leading-relaxed text-text">
                {voice.sample({ businessName, topic })}
              </span>
            </button>
          );
        })}
      </div>
      {errors.tone && (
        <p id="voice-error" role="alert" className="text-[13px] font-medium text-danger">
          {errors.tone}
        </p>
      )}
    </div>
  );
}
