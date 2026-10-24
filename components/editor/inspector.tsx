"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { addSticker, deleteShot, maxSpeed, removeSticker, setCaptionText, setClipSound, setLook, setSpeed, setTransition, setZoom, splitShot, textSticker, trimShot, type Op } from "@/lib/editor/ops";
import { isAiClipUrl } from "@/lib/video-engine/video-frames";
import { CLIP_FADE_MAX, GRADES, SPEC_LIMITS, TRANSITIONS, type Grade, type Layer, type MotionSpec, type ShapeLayer, type Transition, type VideoLayer } from "@/lib/video-engine/spec";

const TRANSITION_NAMES: Record<Transition, string> = { cut: "Cut", fade: "Fade", slideUp: "Slide up", slideLeft: "Slide left", zoom: "Zoom in", wipe: "Wipe", flash: "Flash", whip: "Whip", blurZoom: "Blur zoom", spin: "Spin", dip: "Dip to black" };
const GRADE_NAMES: Record<Grade, string> = { none: "None", warm: "Warm", cool: "Cool", tealOrange: "Teal and orange", vivid: "Vivid", mono: "Black and white", film: "Film", faded: "Faded", night: "Night" };
const SHAPES: { label: string; shape: ShapeLayer["shape"]; w: number; h: number }[] = [
  { label: "Arrow", shape: "arrow", w: 0.22, h: 0.12 },
  { label: "Circle", shape: "ring", w: 0.2, h: 0.2 },
  { label: "Burst", shape: "burst", w: 0.22, h: 0.22 },
];

/** A text box that is saved when you leave it, so one edit is one undo step. */
function TextBox({ value, label, onCommit }: { value: string; label: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Field label={label}>
      <Input
        value={draft}
        maxLength={SPEC_LIMITS.maxText}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && draft !== value && onCommit(draft)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </Field>
  );
}

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

/** Speed and the clip's own sound for a shot that has a clip. The sound is heard in the exported video, not in the preview. */
function ClipControls({ spec, layer, selected, clipSeconds, run }: { spec: MotionSpec; layer: VideoLayer; selected: number; clipSeconds?: number; run: (op: Op) => void }) {
  const rate = layer.rate ?? 1;
  const ai = isAiClipUrl(layer.url);
  const silent = ai || layer.sound !== true || rate !== 1;
  const speeds = SPEEDS.includes(rate) ? SPEEDS : [...SPEEDS, rate].sort((a, b) => a - b);
  const volume = layer.volume ?? 1;
  const cap = maxSpeed(spec, selected, clipSeconds);
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Clip speed and sound</legend>
      <Field label="Speed" hint="Below 1x is slow motion, above 1x is faster. The shot keeps its length; a faster shot shows more of the clip.">
        <Select value={String(rate)} onChange={(e) => run((s) => setSpeed(s, selected, Number(e.target.value), { clipSeconds }))}>
          {speeds.map((r) => (
            <option key={r} value={String(r)} disabled={cap !== null && r > cap && r !== rate}>{r}x</option>
          ))}
        </Select>
      </Field>
      {cap !== null && cap < 2 && <p className="text-[13px] text-muted">This clip is {Math.round((clipSeconds ?? 0) * 10) / 10} s long, so this shot can go up to {cap}x without running past its end.</p>}
      {ai && <p className="text-[13px] text-muted">AI clips have no sound of their own.</p>}
      {!ai && layer.sound !== true && <p className="text-[13px] text-muted">This clip has no sound of its own.</p>}
      {!ai && layer.sound === true && rate !== 1 && <p className="text-[13px] text-muted">Sound is off while the speed is not 1x.</p>}
      <Field label={`Sound level: ${Math.round(volume * 100)}%`}>
        <input type="range" min={0} max={1} step={0.05} disabled={silent} value={volume} onChange={(e) => run((s) => setClipSound(s, selected, { volume: Number(e.target.value) }))} className="min-h-11 w-full" />
      </Field>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Sound fades in (seconds)">
          <Input type="number" inputMode="decimal" step={0.1} min={0} max={CLIP_FADE_MAX} disabled={silent} value={layer.fadeIn ?? 0} onChange={(e) => e.target.value !== "" && run((s) => setClipSound(s, selected, { fadeIn: Number(e.target.value) }))} />
        </Field>
        <Field label="Sound fades out (seconds)">
          <Input type="number" inputMode="decimal" step={0.1} min={0} max={CLIP_FADE_MAX} disabled={silent} value={layer.fadeOut ?? 0} onChange={(e) => e.target.value !== "" && run((s) => setClipSound(s, selected, { fadeOut: Number(e.target.value) }))} />
        </Field>
      </div>
      <p className="text-[13px] text-muted">You hear the clip&apos;s sound only in the exported video, not in the preview.</p>
    </fieldset>
  );
}

const zoomOf = (layers: Layer[]) => {
  const l = layers.find((x) => x.kind === "video" || x.kind === "photo");
  return l?.keyframes?.[0]?.scale ?? 1;
};

/** Everything you can change about the selected shot, and the colour look of the whole video. */
export function Inspector({ spec, selected, tMs, run, onSelect, clipLength }: { spec: MotionSpec; selected: number; tMs: number; run: (op: Op) => void; onSelect: (i: number) => void; clipLength?: (url: string) => number | undefined }) {
  const scene = spec.scenes[selected];
  if (!scene) return <p className="text-sm text-muted">Select a shot to change it.</p>;
  const startMs = spec.scenes.slice(0, selected).reduce((t, s) => t + s.seconds * 1000, 0);
  const splitAt = Math.round(((tMs - startMs) / 1000) * 10) / 10;
  const canSplit = splitAt >= SPEC_LIMITS.minSceneSeconds && scene.seconds - splitAt >= SPEC_LIMITS.minSceneSeconds;
  const clip = scene.layers.find((l): l is VideoLayer => l.kind === "video");
  const hasPicture = scene.layers.some((l) => l.kind === "video" || l.kind === "photo");
  const texts = scene.layers.flatMap((l, i) => (l.kind === "text" ? [{ l, i }] : []));
  const shapes = scene.layers.flatMap((l, i) => (l.kind === "shape" ? [{ l, i }] : []));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h3 className="text-base font-semibold">Shot {selected + 1}</h3>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Length (seconds)" hint={`Between ${SPEC_LIMITS.minSceneSeconds} and ${SPEC_LIMITS.maxSceneSeconds}.`}>
          <Input type="number" inputMode="decimal" step={0.1} min={SPEC_LIMITS.minSceneSeconds} max={SPEC_LIMITS.maxSceneSeconds} value={scene.seconds} onChange={(e) => e.target.value !== "" && run((s) => trimShot(s, selected, { seconds: Number(e.target.value) }, { clipSeconds: clip ? clipLength?.(clip.url) : undefined }))} />
        </Field>
        <Field label="How it comes in" hint={selected === 0 ? "The first shot has nothing before it." : undefined}>
          <Select value={scene.transition ?? "fade"} disabled={selected === 0} onChange={(e) => run((s) => setTransition(s, selected, e.target.value as Transition))}>
            {TRANSITIONS.map((t) => (
              <option key={t} value={t}>{TRANSITION_NAMES[t]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={`Zoom: ${zoomOf(scene.layers).toFixed(2)}x`} hint={hasPicture ? "1 is as filmed; higher zooms in slowly." : "Zoom works on a shot that has a clip or a photo."}>
        <input type="range" min={1} max={2} step={0.05} disabled={!hasPicture} value={zoomOf(scene.layers)} onChange={(e) => run((s) => setZoom(s, selected, Number(e.target.value)))} className="min-h-11 w-full" />
      </Field>

      {clip && <ClipControls spec={spec} layer={clip} selected={selected} clipSeconds={clipLength?.(clip.url)} run={run} />}

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Words on this shot</legend>
        {texts.length === 0 && <p className="text-[13px] text-muted">No words on this shot yet. Add a text sticker below.</p>}
        {texts.map(({ l, i }, n) => (
          <div key={i} className="flex min-w-0 items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextBox label={`Text ${n + 1}`} value={l.kind === "text" ? l.text : ""} onCommit={(text) => run((s) => setCaptionText(s, selected, i, text))} />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => run((s) => removeSticker(s, selected, i))} aria-label={`Remove text ${n + 1}`}>Remove</Button>
          </div>
        ))}
        {shapes.map(({ l, i }) => (
          <div key={i} className="flex items-center justify-between gap-2 text-[14px]">
            <span>Shape: {l.kind === "shape" ? l.shape : ""}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => run((s) => removeSticker(s, selected, i))}>Remove</Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => run((s) => addSticker(s, selected, textSticker("New sticker")))}>Add a text sticker</Button>
          {SHAPES.map((sh) => (
            <Button key={sh.shape} type="button" size="sm" variant="outline" onClick={() => run((s) => addSticker(s, selected, { kind: "shape", shape: sh.shape, color: "#FFD23F", x: 0.5, y: 0.7, w: sh.w, h: sh.h }))}>
              Add {sh.label.toLowerCase()}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!canSplit} onClick={() => run((s) => splitShot(s, selected, splitAt))}>Split at the playhead</Button>
        <Button type="button" size="sm" variant="outline" disabled={spec.scenes.length < 2} onClick={() => { run((s) => deleteShot(s, selected)); onSelect(Math.max(0, selected - 1)); }}>Delete this shot</Button>
      </div>
      {!canSplit && <p className="-mt-2 text-[13px] text-muted">To split, move the playhead inside this shot, at least {SPEC_LIMITS.minSceneSeconds} s from each edge.</p>}

      <Field label="Colour look (whole video)">
        <Select value={spec.look?.grade ?? "none"} onChange={(e) => run((s) => setLook(s, e.target.value as Grade))}>
          {GRADES.map((g) => (
            <option key={g} value={g}>{GRADE_NAMES[g]}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
