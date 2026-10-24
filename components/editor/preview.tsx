"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui";
import { drawSpecFrame, type Photos } from "@/lib/video-engine/draw";
import { canvasSize, totalMs, type MotionSpec } from "@/lib/video-engine/spec";
import { secondsText } from "./layout";

/** The frame at the playhead, drawn by the same code that makes the MP4, with play, pause and a slider to scrub. */
export function Preview({ spec, tMs, playing, onToggle, onSeek }: { spec: MotionSpec; tMs: number; playing: boolean; onToggle: () => void; onSeek: (ms: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = canvasSize(spec, "480p");
  const total = totalMs(spec);
  // What to draw next, and the clips' decoders: a frame is drawn one at a time, and only the latest request is kept.
  const latest = useRef({ spec, t: 0 });
  const wanted = useRef(false);
  const running = useRef(false);
  const frames = useRef<Photos>(new Map());
  const clips = useRef<{ prepare(tMs: number, photos: Photos): Promise<void>; close(): void } | null>(null);

  async function pump() {
    if (running.current) return;
    running.current = true;
    try {
      while (wanted.current) {
        wanted.current = false;
        const ctx = ref.current?.getContext("2d");
        if (!ctx) continue;
        const { spec: s, t } = latest.current;
        // A clip that cannot be read leaves its layer black, as in the export.
        await clips.current?.prepare(t, frames.current).catch(() => undefined);
        drawSpecFrame(ctx, s, frames.current, t, { quality: "480p" });
      }
    } finally {
      running.current = false;
    }
  }
  function redraw() {
    wanted.current = true;
    void pump();
  }

  // Every render: draw the frame at the playhead.
  useEffect(() => {
    latest.current = { spec, t: Math.min(tMs, Math.max(0, total - 1)) };
    redraw();
  });

  // The fonts the spec uses, loaded once per set of fonts; the frame is drawn again when they arrive.
  const fonts = [...new Set(spec.scenes.flatMap((s) => s.layers.flatMap((l) => (l.kind === "text" ? [l.font] : []))))].sort().join(",");
  useEffect(() => {
    let alive = true;
    void import("@/lib/video-engine/encode").then(({ loadSpecFonts }) => loadSpecFonts(latest.current.spec).then(() => alive && redraw()));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the fonts change
  }, [fonts]);

  // The clips of a real reel: opened once per set of clips (the decoders read the latest scenes, so edits need no reopening).
  const clipUrls = [...new Set(spec.scenes.flatMap((s) => s.layers.flatMap((l) => (l.kind === "video" ? [l.url] : []))))];
  const urls = clipUrls.join("|");
  // How many clips have downloaded (they open one after the other, about 7 s for a reel): the words draw meanwhile.
  // Set only from the loading callbacks; a new set of clips counts from 0 until its first one arrives.
  const [progress, setProgress] = useState<{ urls: string; done: number; ready: boolean } | null>(null);
  useEffect(() => {
    if (!urls) return;
    let alive = true;
    let done = 0;
    void Promise.all([import("@/lib/video-engine/video-frames"), import("@/lib/video-engine/video-source")])
      .then(async ([{ openVideoFrames }, { VideoSource }]) => {
        const handle = await openVideoFrames(
          {
            get scenes() {
              return latest.current.spec.scenes;
            },
          },
          (url) =>
            VideoSource.open(url).finally(() => {
              if (alive) setProgress({ urls, done: ++done, ready: false });
            }),
        );
        if (!alive) return handle.close();
        clips.current = handle;
        setProgress({ urls, done, ready: true });
        redraw();
      })
      .catch(() => alive && setProgress({ urls, done, ready: true }));
    return () => {
      alive = false;
      clips.current?.close();
      clips.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the clips change
  }, [urls]);
  const loadingNow = !urls ? null : progress?.urls !== urls ? { done: 0 } : progress.ready ? null : progress;

  return (
    <div className="flex min-w-0 flex-col items-center gap-3">
      <div className="relative w-full max-w-[280px]">
        <canvas ref={ref} width={size.width} height={size.height} role="img" aria-label="Preview of the video at the playhead" className="h-auto max-h-[60vh] w-full rounded-xl bg-black" />
        {loadingNow && (
          <p role="status" className="absolute inset-x-3 top-3 rounded-lg bg-black/70 px-3 py-2 text-center text-[13px] font-medium text-white">
            Loading the clips… {Math.min(loadingNow.done, clipUrls.length)} of {clipUrls.length}
          </p>
        )}
      </div>
      <div className="flex w-full max-w-[280px] items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {playing ? "Pause" : "Play"}
        </Button>
        <input type="range" min={0} max={Math.max(1, total - 1)} step={10} value={Math.min(tMs, total)} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Position in the video" className="min-h-11 min-w-0 flex-1" />
      </div>
      <p className="text-[13px] text-muted">{secondsText(tMs / 1000)} of {secondsText(total / 1000)}</p>
    </div>
  );
}
