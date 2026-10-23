"use client";

import { AI_VIDEOS_FALLBACK, videoQualityChoices, type VideoQuality } from "@/lib/visuals/video-quality";
import type { VideoQualityOffer } from "@/lib/visuals/video-quality-server";

/**
 * "Videos": Simple videos, Mix or AI videos, for the videos BuPulse makes by itself (Autopilot, Daily posts). Mix and
 * AI videos are greyed out, with the reason, while AI clips cannot be made.
 */
export function VideoQualityPicker({ name, value, onChange, offer, disabled }: { name: string; value: VideoQuality; onChange: (v: VideoQuality) => void; offer: VideoQualityOffer; disabled?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[15px] font-semibold">Videos</legend>
      {videoQualityChoices(offer.aiCredits).map(({ value: v, label, hint }) => {
        const off = v !== "simple" && !offer.aiOn;
        return (
          <label key={v} className={`flex min-h-11 items-start gap-3 py-1 text-[15px] ${off ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input type="radio" name={name} className="mt-1 size-5" checked={value === v} disabled={disabled || off} onChange={() => onChange(v)} />
            <span className="flex flex-col">
              <span className="font-medium">{label}</span>
              <span className="text-[13px] text-muted">{hint}</span>
            </span>
          </label>
        );
      })}
      <p className="text-[13px] text-muted">{offer.aiOn ? AI_VIDEOS_FALLBACK : offer.aiOffReason}</p>
    </fieldset>
  );
}
