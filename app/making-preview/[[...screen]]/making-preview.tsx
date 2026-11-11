"use client";

import { useState } from "react";
import { MakingScreen } from "@/components/visuals/making-screen";
import type { MakingProgress } from "@/components/visuals/making-progress";

const IMG = ["/marketing/week/mon-600.webp", "/marketing/week/tue-600.webp", "/marketing/week/wed-600.webp", "/marketing/week/thu-600.webp"];

const PROGRESS: Record<string, MakingProgress> = {
  captions: { step: "captions", reel: true, music: true, images: [] },
  images: { step: "images", fraction: 0.5, reel: true, music: true, images: [{ url: IMG[0] }, { url: IMG[1] }, { url: null }, { url: null }] },
  reel: { step: "reel", fraction: 0.4, reel: true, music: true, images: IMG.map((url) => ({ url })) },
  music: { step: "music", fraction: 0.5, reel: true, music: true, images: IMG.map((url) => ({ url })) },
  ready: { step: "ready", fraction: 1, reel: true, music: true, images: IMG.map((url) => ({ url })) },
};

/** The preview's screens, with the clock started `at` ms ago (the start is fixed once, at first render). */
export function MakingPreview({ screen, at }: { screen: string; at: number }) {
  const [startedAt] = useState(() => Date.now() - at);
  if (screen === "frames") {
    return (
      <main className="min-h-dvh bg-bg p-4 sm:p-8">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-4">
          <div className="relative aspect-[4/5] w-full max-w-xs overflow-hidden rounded-2xl bg-soft">
            <MakingScreen size="sm" startedAt={startedAt} progress={{ step: "images", fraction: 0.25, reel: false }} />
          </div>
          <div className="relative aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-2xl bg-soft">
            <MakingScreen size="sm" startedAt={startedAt} progress={{ step: "reel", fraction: 0.3, reel: true, music: true }} />
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-dvh bg-bg p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <MakingScreen startedAt={startedAt} progress={PROGRESS[screen]} title="Today's pictures and reel" />
      </div>
    </main>
  );
}
