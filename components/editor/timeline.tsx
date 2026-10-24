"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { blockWidth, playheadX, secondsText, trimFromDrag } from "./layout";

const GAP = 6;

/**
 * One block per shot, as wide as it is long. Tap to select; drag a block to reorder (the arrow buttons do the same on a
 * phone); drag the right edge to trim. It scrolls sideways inside its own box.
 */
export function Timeline({ spec, selected, tMs, onSelect, onMove, onTrim }: { spec: MotionSpec; selected: number; tMs: number; onSelect: (i: number) => void; onMove: (from: number, to: number) => void; onTrim: (i: number, seconds: number) => void }) {
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [trim, setTrim] = useState<{ i: number; seconds: number } | null>(null);
  const shown = { ...spec, scenes: spec.scenes.map((s, i) => (trim && trim.i === i ? { ...s, seconds: trim.seconds } : s)) };

  function startTrim(e: React.PointerEvent<HTMLSpanElement>, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const s0 = spec.scenes[i].seconds;
    const move = (ev: PointerEvent) => setTrim({ i, seconds: trimFromDrag(s0, ev.clientX - x0) });
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setTrim(null);
      onTrim(i, trimFromDrag(s0, ev.clientX - x0));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-x-auto rounded-xl border border-line bg-soft p-2" role="group" aria-label="Shots, in order">
        <ol className="relative flex w-max" style={{ gap: GAP }}>
          {shown.scenes.map((s, i) => {
            const text = s.layers.find((l) => l.kind === "text");
            return (
              <li
                key={i}
                draggable
                onDragStart={(e) => {
                  dragFrom.current = i;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(i);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  if (dragFrom.current !== null && dragFrom.current !== i) onMove(dragFrom.current, i);
                  dragFrom.current = null;
                }}
                style={{ width: blockWidth(s.seconds) }}
                className={cn("relative h-24 shrink-0 rounded-lg border-2 bg-surface", selected === i ? "border-pulse-violet" : "border-line", over === i && "ring-2 ring-pulse-blue")}
              >
                <button type="button" onClick={() => onSelect(i)} aria-pressed={selected === i} aria-label={`Shot ${i + 1}, ${secondsText(s.seconds)}`} className="flex size-full min-w-0 cursor-grab flex-col items-start justify-between overflow-hidden rounded-lg p-1.5 text-left">
                  <span className="text-[12px] font-semibold">{i + 1}{i > 0 && s.transition && s.transition !== "cut" ? ` · ${s.transition}` : ""}</span>
                  <span className="line-clamp-2 w-full break-words text-[12px] text-muted">{text && text.kind === "text" ? text.text : "No words"}</span>
                  <span className="text-[12px] text-muted">{secondsText(s.seconds)}</span>
                </button>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Drag to change the length of shot ${i + 1}`}
                  onPointerDown={(e) => startTrim(e, i)}
                  className="absolute inset-y-0 -right-1 z-10 flex w-4 cursor-ew-resize touch-none items-center justify-center"
                >
                  <span className="h-10 w-1.5 rounded-full bg-pulse-violet/70" />
                </span>
              </li>
            );
          })}
          <li aria-hidden role="presentation" className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger" style={{ left: playheadX(shown, tMs / 1000, GAP) }} />
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={selected <= 0} onClick={() => onMove(selected, selected - 1)} aria-label="Move this shot earlier">
          <ChevronLeft className="size-4" aria-hidden /> Earlier
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={selected >= spec.scenes.length - 1} onClick={() => onMove(selected, selected + 1)} aria-label="Move this shot later">
          Later <ChevronRight className="size-4" aria-hidden />
        </Button>
        <span className="text-[13px] text-muted">Drag a shot to move it, or its right edge to trim it.</span>
      </div>
    </div>
  );
}
