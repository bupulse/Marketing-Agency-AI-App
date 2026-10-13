"use client";

import { ContentVisual } from "@/components/visuals/content-visual";
import { GlassCard } from "@/components/ui";
import type { VisualView } from "@/lib/visuals/types";

export type DayVisualItem = { id: string; label: string; angle: string | null; image: VisualView | null; video: VisualView | null; hasScript?: boolean };

/**
 * The pictures and videos of the day's posts: drawn here while they are still pending (each post's picture then goes
 * on its post), and changeable (photo, style, texts, a new picture, the video's captions). Only the first pending video
 * starts on its own, so one page does not make several videos at once.
 */
export function DayVisuals({ items, videoInPlan, album }: { items: DayVisualItem[]; videoInPlan: boolean; album?: string }) {
  const firstVideo = items.find((i) => i.video?.status === "pending")?.id;
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="day-visuals" className="@container flex flex-col gap-4">
      <h2 id="day-visuals" className="px-1 text-lg font-semibold tracking-[-0.02em]">
        Pictures and videos
      </h2>
      <ul className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <GlassCard className="flex flex-col gap-3 p-4">
              <p className="text-[14px] font-semibold">
                {item.label}
                {item.angle && <span className="font-normal text-muted"> · {item.angle}</span>}
              </p>
              <ContentVisual contentId={item.id} image={item.image} video={item.video} videoInPlan={videoInPlan} album={album} autoVideo={item.id === firstVideo} hasScript={item.hasScript} />
            </GlassCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
