"use client";

import { useEffect, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { Panel } from "@/components/admin/ui";
import { moveShot, totalSeconds, trimShot } from "@/lib/editor/ops";
import { totalMs, type MotionSpec } from "@/lib/video-engine/spec";
import { ExportPanel } from "./export-panel";
import { LabNotes, type ReelLab } from "./lab-notes";
import { Inspector } from "./inspector";
import { shotAt, shotStarts, secondsText } from "./layout";
import { Preview } from "./preview";
import { reelSource, type ReelBrand } from "./reel-spec";
import { SavePanel, type Source } from "./save-panel";
import type { ReelView } from "@/lib/reel-engine/engine";
import { Timeline } from "./timeline";
import { useSpecHistory } from "./use-spec-history";

export type ReelChoice = { id: string; business: string; title: string; createdAt: string };
export type OpenedReel = { view: ReelView; brand: ReelBrand; lab?: ReelLab };
export type OpenReel = (id: string) => Promise<({ ok: true } & OpenedReel) | { ok: false; error: string }>;

/**
 * The timeline editor: the preview, the shots, what you can change about one shot, undo and redo, and export. The state
 * is the spec. It starts on `initial` (an example), or on `initialReel` (a finished reel the page opened, ?reel=<id>);
 * with `reels` and `openReel` the owner can open another finished reel.
 */
type CreateExample = (input: unknown, file: unknown) => Promise<{ ok: true; id: string; upload: { path: string; token: string } | null; warning?: string } | { ok: false; error: string }>;
type ConfirmFile = (id: string, path: string) => Promise<{ ok: true } | { ok: false; error: string }>;

export function SpecEditor({ initial, initialReel, reels = [], openReel, createExample, confirmFile }: { initial: MotionSpec; initialReel?: OpenedReel | null; reels?: ReelChoice[]; openReel?: OpenReel; createExample?: CreateExample; confirmFile?: ConfirmFile }) {
  const { spec, run, undo, redo, canUndo, canRedo, reset } = useSpecHistory(initial);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  // The reel that is open (null: the example), as it was opened; and the last MP4 made, for saving.
  const [source, setSource] = useState<Source | null>(null);
  const [made, setMade] = useState<{ blob: Blob; spec: MotionSpec } | null>(null);
  const [title, setTitle] = useState(initial.title);
  const [pick, setPick] = useState(initialReel?.view.id ?? reels[0]?.id ?? "");
  // What the Training Lab did to the open reel (null: the example, or nothing known).
  const [lab, setLab] = useState<ReelLab | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
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

  function load(next: MotionSpec, music: string | null, name: string, from: Source | null) {
    setPlaying(false);
    setSource(from);
    setMade(null);
    reset(next);
    setMusicUrl(music);
    setTitle(name);
    setSelected(0);
    seek(0);
  }

  async function show(res: OpenedReel) {
    const opened = await reelSource(res.view, res.brand);
    load(opened.spec, opened.musicUrl, opened.title, { id: res.view.id, title: opened.title, spec: opened.spec, musicUrl: opened.musicUrl, language: res.view.language });
    setLab(res.lab ?? null);
  }

  // Fresh signed links every time: the clips' links expire after an hour.
  async function open() {
    if (!openReel || !pick || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      const res = await openReel(pick);
      if (!res.ok) return setOpenError(res.error);
      await show(res);
    } catch {
      setOpenError("The reel could not be opened. Try again.");
    } finally {
      setOpening(false);
    }
  }

  // A reel the page opened (?reel=<id>, links fresh from the server) is loaded once, as if picked and opened.
  const started = useRef(false);
  useEffect(() => {
    if (!initialReel || started.current) return;
    started.current = true;
    setOpening(true);
    show(initialReel)
      .catch(() => setOpenError("The reel could not be opened. Try again."))
      .finally(() => setOpening(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the first render
  }, []);

  const playheadShot = shotAt(spec, tMs / 1000);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {openReel && (
        <Panel title="Open a finished reel" description="Loads the reel as it was put together, so you can change it. Your changes stay on this page until you export the MP4 or save the edit as a Lab example. The reel itself is never changed.">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!reels.length || opening} aria-label="Finished reel">
                {reels.length === 0 && <option value="">No finished reels yet</option>}
                {reels.map((r) => (
                  <option key={r.id} value={r.id}>{r.business}: {r.title} ({new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})</option>
                ))}
              </Select>
            </div>
            <Button type="button" onClick={open} disabled={!pick || opening}>{opening ? "Opening…" : "Open"}</Button>
            <Button type="button" variant="outline" onClick={() => { load(initial, null, initial.title, null); setLab(null); }} disabled={opening}>Back to the example</Button>
          </div>
          {openError && <p role="alert" className="text-sm font-medium text-danger">{openError}</p>}
          {source && lab && <LabNotes lab={lab} />}
        </Panel>
      )}
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
          <ExportPanel spec={spec} musicUrl={musicUrl} title={title} onMade={setMade} />
          {source && createExample && confirmFile && <SavePanel spec={spec} source={source} made={made} onMade={setMade} createExample={createExample} confirmFile={confirmFile} />}
        </div>
      </div>
    </div>
  );
}

export type { MotionSpec };
