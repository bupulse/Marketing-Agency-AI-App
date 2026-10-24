"use client";

import { useEffect, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { Panel } from "@/components/admin/ui";
import { moveShot, totalSeconds, trimShot } from "@/lib/editor/ops";
import { totalMs, type MotionSpec } from "@/lib/video-engine/spec";
import { Inspector } from "./inspector";
import { shotAt, shotStarts, secondsText } from "./layout";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import { useSpecHistory } from "./use-spec-history";

/** The timeline editor: the preview, the shots, what you can change about one shot, and undo and redo. The state is the spec. */
export function SpecEditor({ initial }: { initial: MotionSpec }) {
  const { spec, run, undo, redo, canUndo, canRedo } = useSpecHistory(initial);
  const [selected, setSelected] = useState(0);
  const [tMs, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);
  const total = totalMs(spec);
  const index = Math.min(selected, spec.scenes.length - 1);

  function seek(ms: number) {
    tRef.current = ms;
    setT(ms);
  }

  // Play: advance the playhead by the real time between frames; stop at the end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = tRef.current + (now - last);
      last = now;
      if (next >= total) {
        seek(Math.max(0, total - 1));
        setPlaying(false);
        return;
      }
      seek(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes, except while typing in a box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Taps on a shot put the playhead at its start, so the preview shows it.
  function select(i: number) {
    setSelected(i);
    setPlaying(false);
    seek(Math.round((shotStarts(spec)[i] ?? 0) * 1000));
  }

  const playheadShot = shotAt(spec, tMs / 1000);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!canUndo} onClick={undo} aria-label="Undo">
          <Undo2 className="size-4" aria-hidden /> Undo
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canRedo} onClick={redo} aria-label="Redo">
          <Redo2 className="size-4" aria-hidden /> Redo
        </Button>
        <p className="text-sm font-medium" role="status">Total length: {secondsText(totalSeconds(spec))} · {spec.scenes.length} shots</p>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[auto_1fr]">
        <Panel title="Preview">
          <Preview spec={spec} tMs={tMs} playing={playing} onToggle={() => { if (!playing && tMs >= total - 1) seek(0); setPlaying((p) => !p); }} onSeek={(ms) => { setPlaying(false); seek(ms); }} />
        </Panel>
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Shots" description={`The playhead is in shot ${playheadShot + 1}.`}>
            <Timeline
              spec={spec}
              selected={index}
              tMs={tMs}
              onSelect={select}
              onMove={(from, to) => {
                run((s) => moveShot(s, from, to));
                setSelected(to);
              }}
              onTrim={(i, seconds) => run((s) => trimShot(s, i, { seconds }))}
            />
          </Panel>
          <Panel title="Change this shot">
            <Inspector spec={spec} selected={index} tMs={tMs} run={run} onSelect={setSelected} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

export type { MotionSpec };
