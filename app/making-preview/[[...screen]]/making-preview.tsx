"use client";

import { useEffect, useState } from "react";
import { MakingScreen } from "@/components/visuals/making-screen";
import { fromSetProgress, type MakingProgress } from "@/components/visuals/making-progress";
import type { SetImageProgress, SetProgress, SetReelProgress } from "@/lib/visuals/progress";

const IMG = ["/marketing/week/mon-600.webp", "/marketing/week/tue-600.webp", "/marketing/week/wed-600.webp", "/marketing/week/thu-600.webp"];

const PROGRESS: Record<string, MakingProgress> = {
  captions: { step: "captions", reel: true, music: true, images: [] },
  images: { step: "images", fraction: 0.5, reel: true, music: true, images: [{ url: IMG[0] }, { url: IMG[1] }, { url: null }, { url: null }] },
  reel: { step: "reel", fraction: 0.4, reel: true, music: true, images: IMG.map((url) => ({ url })) },
  music: { step: "music", fraction: 0.5, reel: true, music: true, images: IMG.map((url) => ({ url })) },
  ready: { step: "ready", fraction: 1, reel: true, music: true, images: IMG.map((url) => ({ url })) },
};

type Stage = SetImageProgress["stage"];
const img = (index: number, status: SetImageProgress["status"], stage: Stage = null): SetImageProgress => ({ index, status, stage, path: status === "ready" ? `u/d/${index}.png` : null, ...(status === "ready" ? { url: IMG[index] } : {}) });
const reel = (status: SetReelProgress["status"]): SetReelProgress => ({ status, visualId: status === "waiting" ? null : "r1", path: status === "ready" ? "u/videos/r1.mp4" : null, music: status === "waiting" ? null : "Kigali Sunrise", error: null });

/**
 * A made-up server: what daySetProgressAction answers for a day's set of 4 AI pictures and a reel, by seconds since
 * Create (each picture: planning, painting, checking, ready; then the reel is planned, rendered with its music, ready).
 * Units as lib/visuals/progress.ts counts them: captions 1, each AI picture 3, the reel 2.
 */
export function mockSetProgress(ms: number): SetProgress {
  const s = ms / 1000;
  const stageAt = (start: number): { status: SetImageProgress["status"]; stage: Stage; units: number } =>
    s < start ? { status: "waiting", stage: null, units: 0 } : s < start + 2 ? { status: "working", stage: "planning", units: 0 } : s < start + 5 ? { status: "working", stage: "painting", units: 1 } : s < start + 7 ? { status: "working", stage: "checking", units: 2 } : { status: "ready", stage: null, units: 3 };
  const pictures = [0, 0.5, 1, 1.5].map(stageAt);
  const images = pictures.map((p, i) => img(i, p.status, p.stage));
  const picturesDone = pictures.every((p) => p.status === "ready");
  const r: SetReelProgress = !picturesDone ? reel("waiting") : s < 11 ? reel("pending") : s < 16 ? reel("rendering") : reel("ready");
  const done = 1 + pictures.reduce((a, p) => a + p.units, 0) + (r.status === "waiting" ? 0 : r.status === "ready" ? 2 : 1);
  const step = !picturesDone ? "images" : r.status === "pending" ? "reel" : r.status === "rendering" ? "music" : "ready";
  const label = { images: "Designing images", reel: "Making the reel", music: "Adding music", ready: "Ready" }[step];
  return { groupId: "preview-set", step, label, done, total: 15, percent: Math.round((100 * done) / 15), ready: step === "ready", failed: false, error: null, images, reel: r };
}

/** "live": the loading screen fed by the made-up server through fromSetProgress, polled every 2.5 s like the page does. */
function LivePreview({ startedAt, at, hold }: { startedAt: number; at: number; hold: boolean }) {
  const [progress, setProgress] = useState<MakingProgress>(() => fromSetProgress([mockSetProgress(at)])!);
  useEffect(() => {
    if (hold) return;
    const timer = setInterval(() => setProgress(fromSetProgress([mockSetProgress(Date.now() - startedAt)])!), 2_500);
    return () => clearInterval(timer);
  }, [startedAt, hold]);
  return <MakingScreen startedAt={startedAt} progress={progress} title="Making 5 posts" />;
}

/** The preview's screens, with the clock started `at` ms ago (the start is fixed once, at first render). */
export function MakingPreview({ screen, at, hold = false }: { screen: string; at: number; /** live: the made-up server stays at `at` (screenshots). */ hold?: boolean }) {
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
      <div className="mx-auto max-w-3xl">{screen === "live" ? <LivePreview startedAt={startedAt} at={at} hold={hold} /> : <MakingScreen startedAt={startedAt} progress={PROGRESS[screen]} title="Today's pictures and reel" />}</div>
    </main>
  );
}
