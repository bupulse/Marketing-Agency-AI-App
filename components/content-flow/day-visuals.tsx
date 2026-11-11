"use client";

import { useEffect, useState } from "react";
import { ContentVisual } from "@/components/visuals/content-visual";
import { MakingScreen } from "@/components/visuals/making-screen";
import { progressFromVisuals, type MakingProgress } from "@/components/visuals/making-progress";
import { GlassCard } from "@/components/ui";
import type { VisualView } from "@/lib/visuals/types";

export type DayVisualItem = { id: string; label: string; angle: string | null; image: VisualView | null; video: VisualView | null; hasScript?: boolean };

/** One set per day (docs/CONTENT.md): the same image may sit on several posts; each is shown once. */
function uniqueVisuals(list: (VisualView | null)[]): VisualView[] {
  const seen = new Set<string>();
  return list.filter((v): v is VisualView => !!v && !seen.has(v.id) && !!seen.add(v.id));
}

/**
 * The day's set while it is made: the loading screen (ring, step, images fading in), from the visuals the page has,
 * or from the server's progress when it is given. It stays at "Ready" for a moment once everything is made, then goes.
 */
export function DaySetProgress({ items, progress }: { items: DayVisualItem[]; progress?: MakingProgress | null }) {
  const estimate = progress ?? progressFromVisuals({ images: uniqueVisuals(items.map((i) => i.image)), videos: uniqueVisuals(items.map((i) => i.video)) });
  const working = estimate.step !== "ready";
  const [seenWorking, setSeenWorking] = useState(working);
  const [hidden, setHidden] = useState(false);
  if (working && !seenWorking) setSeenWorking(true);
  if (working && hidden) setHidden(false);
  useEffect(() => {
    if (working || !seenWorking) return;
    const timer = setTimeout(() => setHidden(true), 4_000);
    return () => clearTimeout(timer);
  }, [working, seenWorking]);
  if (!seenWorking || hidden) return null;
  return <MakingScreen progress={estimate} title="Today's pictures and reel" />;
}

/**
 * The pictures and videos of the day's posts: drawn here while they are still pending (each post's picture then goes
 * on its post), and changeable (photo, style, texts, a new picture, the video's captions). Only the first pending video
 * starts on its own, so one page does not make several videos at once.
 */
export function DayVisuals({ items, videoInPlan, album, progress }: { items: DayVisualItem[]; videoInPlan: boolean; album?: string; /** The server's progress for the day's set (lib/visuals/progress.ts), when there is one. */ progress?: MakingProgress | null }) {
  const firstVideo = items.find((i) => i.video?.status === "pending")?.id;
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="day-visuals" className="@container flex flex-col gap-4">
      <h2 id="day-visuals" className="px-1 text-lg font-semibold tracking-[-0.02em]">
        Pictures and videos
      </h2>
      <DaySetProgress items={items} progress={progress} />
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
