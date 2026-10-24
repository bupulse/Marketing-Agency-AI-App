"use client";

import { useRef, useState } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { Panel } from "@/components/admin/ui";
import { describeEdit } from "@/lib/editor/describe";
import { createClient } from "@/lib/supabase/client";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { exportMp4, exportProblem } from "./export";
import { mp4Name } from "./reel-spec";

// The private bucket's name (lib/training-lab/storage.ts TRAINING_BUCKET; that file is server-only).
const BUCKET = "training-lab";
const HOW_MAX = 4900;

export type Source = { id: string; title: string; spec: MotionSpec; musicUrl: string | null; language: string };
type Made = { blob: Blob; spec: MotionSpec } | null;
type Created = { ok: true; id: string; upload: { path: string; token: string } | null; warning?: string } | { ok: false; error: string };
type Step = { ok: true } | { ok: false; error: string };

/**
 * "Save as a Lab example": the edited reel becomes a Training Lab example (kind reel, for the reel and video engines)
 * with what you changed and why. It uses the same steps as the Library: the example is saved, the MP4 goes to its slot
 * in the private bucket, and the server checks the file. The client's own reel and gallery are never touched.
 */
export function SavePanel({ spec, source, made, onMade, createExample, confirmFile }: { spec: MotionSpec; source: Source; made: Made; onMade: (made: { blob: Blob; spec: MotionSpec }) => void; createExample: (input: unknown, file: unknown) => Promise<Created>; confirmFile: (id: string, path: string) => Promise<Step> }) {
  const changes = describeEdit(source.spec, spec);
  const [title, setTitle] = useState(`Edit of ${source.title || "reel"}`);
  const [why, setWhy] = useState("");
  const [never, setNever] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ title?: string; why?: string }>({});
  const [saved, setSaved] = useState<string | null>(null);
  const busy = useRef(false);

  async function save() {
    if (busy.current) return;
    setError(null);
    setSaved(null);
    const found = { title: title.trim() ? undefined : "Give the example a title.", why: why.trim() ? undefined : "Say why you changed it: what the engines should learn." };
    setProblems(found);
    if (found.title || found.why) return;
    if (!changes.length) return setError("Make at least one change first: there is nothing to learn from an unchanged reel.");
    busy.current = true;
    try {
      // Reuse the export if it is of this very edit, else make the video now.
      let blob = made && made.spec === spec ? made.blob : null;
      if (!blob) {
        setStage("Making the video… 0%");
        blob = await exportMp4(spec, source.musicUrl, { onProgress: (p) => setStage(`Making the video… ${p}%`) });
        onMade({ blob, spec });
      }
      setStage("Saving the example…");
      const howMade = `Edited in the Training Lab from reel ${source.title || source.id}: ${changes.join(" ")}`.slice(0, HOW_MAX);
      const input = {
        kind: "reel",
        title: title.trim(),
        howMade,
        whatIsGood: why.trim(),
        neverThis: never.trim(),
        language: source.language,
        tags: ["edited reel"],
        engines: ["reel", "video"],
        notes: { edit: changes, from_reel: source.id },
        hasFile: true,
      };
      const created = await createExample(input, { name: mp4Name(title), type: "video/mp4", size: blob.size });
      if (!created.ok) return setError(created.error);
      if (!created.upload) return setError(`The example is saved, but ${(created.warning ?? "the file could not be uploaded.").replace(/^./, (c) => c.toLowerCase())} Open it in the Library and add the file again.`);
      setStage("Uploading the video…");
      const { error: failed } = await createClient().storage.from(BUCKET).uploadToSignedUrl(created.upload.path, created.upload.token, blob, { contentType: "video/mp4" });
      if (failed) return setError("The example is saved, but the upload did not go through. Open it in the Library and add the file again.");
      setStage("Checking the file…");
      const confirmed = await confirmFile(created.id, created.upload.path);
      if (!confirmed.ok) return setError(`The example is saved, but ${confirmed.error.charAt(0).toLowerCase()}${confirmed.error.slice(1)}`);
      setSaved(created.id);
    } catch (e) {
      setError(exportProblem(e));
    } finally {
      busy.current = false;
      setStage(null);
    }
  }

  return (
    <Panel title="Save as a Lab example" description="Teaches the engines from your edit: the video, what you changed, and why. The reel you opened is not changed.">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm font-medium">What you changed</p>
        {changes.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing yet. Edit the reel above, then save it.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-[14px]">
            {changes.map((c, i) => (
              <li key={i} className="break-words">{c}</li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Title" required error={problems.title}>
        <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Why I changed it" hint="What is better now, so the engines can do the same next time." required error={problems.why}>
        <Textarea rows={3} maxLength={5000} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
      <Field label="Never this" hint="Optional: what the engines must never do.">
        <Textarea rows={2} maxLength={5000} value={never} onChange={(e) => setNever(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={stage !== null}>{stage ?? "Save as a Lab example"}</Button>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      {saved && (
        <p role="status" className="text-sm font-medium text-success">
          Saved. <a href={`/admin/training-lab#ex-${saved}`} className="underline">See it in the Library</a>
        </p>
      )}
    </Panel>
  );
}
