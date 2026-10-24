"use client";

import { useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui";
import { drawSpecFrame } from "@/lib/video-engine/draw";
import { canvasSize, totalMs, type MotionSpec } from "@/lib/video-engine/spec";
import { secondsText } from "./layout";

/** The frame at the playhead, drawn by the same code that makes the MP4, with play, pause and a slider to scrub. */
export function Preview({ spec, tMs, playing, onToggle, onSeek }: { spec: MotionSpec; tMs: number; playing: boolean; onToggle: () => void; onSeek: (ms: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = canvasSize(spec, "480p");
  const total = totalMs(spec);

  // The fonts the spec uses, loaded once per set of fonts; the frame is drawn again when they arrive.
  const fonts = [...new Set(spec.scenes.flatMap((s) => s.layers.flatMap((l) => (l.kind === "text" ? [l.font] : []))))].sort().join(",");
  useEffect(() => {
    let alive = true;
    void import("@/lib/video-engine/encode").then(({ loadSpecFonts }) => loadSpecFonts(spec).then(() => alive && draw()));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the fonts change
  }, [fonts]);

  function draw() {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    drawSpecFrame(ctx, spec, new Map(), Math.min(tMs, Math.max(0, total - 1)), { quality: "480p" });
  }
  useEffect(draw);

  return (
    <div className="flex min-w-0 flex-col items-center gap-3">
      <canvas ref={ref} width={size.width} height={size.height} role="img" aria-label="Preview of the video at the playhead" className="h-auto max-h-[60vh] w-full max-w-[280px] rounded-xl bg-black" />
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
