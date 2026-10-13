"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { finishTrackUploadAction, startTrackUploadAction } from "@/app/admin/(console)/music/actions";
import { createClient } from "@/lib/supabase/client";
import { MOODS, MOOD_LABEL, TRACK_MAX_BYTES, type Mood } from "@/lib/music/tracks";

/** The admin's track upload: the file goes straight to the music bucket with a signed URL, then the server checks it. */
export function MusicUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [moods, setMoods] = useState<Mood[]>([]);

  function submit(form: FormData) {
    setError(null);
    if (!file) return setError("Choose an MP3 or M4A file.");
    if (file.size > TRACK_MAX_BYTES) return setError("Tracks can be at most 6 MB.");
    start(async () => {
      const mimeType = file.type || (file.name.toLowerCase().endsWith(".m4a") ? "audio/mp4" : "audio/mpeg");
      const target = await startTrackUploadAction({ mimeType, bytes: file.size });
      if (!target.ok) return setError(target.error);
      const { error: uploadError } = await createClient().storage.from("music").uploadToSignedUrl(target.path, target.token, file, { contentType: mimeType });
      if (uploadError) return setError("The upload did not go through. Try again.");
      const bpm = Number(form.get("bpm") || 0);
      const done = await finishTrackUploadAction(target.path, {
        title: String(form.get("title") ?? ""),
        moods,
        bpm: bpm > 0 ? bpm : null,
        licence: String(form.get("licence") ?? ""),
        sourceUrl: String(form.get("sourceUrl") ?? ""),
        attribution: String(form.get("attribution") ?? ""),
      });
      if (!done.ok) return setError(done.error);
      setFile(null);
      setMoods([]);
      router.push("/admin/music?notice=Track%20added.");
      router.refresh();
    });
  }

  return (
    <form action={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="File (MP3 or M4A)" required>
        <Input type="file" accept="audio/mpeg,audio/mp4,.mp3,.m4a" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Title" required>
        <Input name="title" maxLength={120} />
      </Field>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-[13px] font-medium text-muted">Moods (1 to 4)</legend>
        <div className="flex flex-wrap gap-3">
          {MOODS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" className="size-4" checked={moods.includes(m)} onChange={(e) => setMoods((list) => (e.target.checked ? [...list, m].slice(0, 4) : list.filter((x) => x !== m)))} />
              {MOOD_LABEL[m]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="BPM (optional)">
        <Input name="bpm" type="number" min={30} max={300} />
      </Field>
      <Field label="Licence name" required>
        <Input name="licence" maxLength={120} placeholder="e.g. Pixabay Content License" />
      </Field>
      <Field label="Source page (https)" required hint="For original music you own, the tool it was made with.">
        <Input name="sourceUrl" maxLength={500} />
      </Field>
      <Field label="Credit line" hint="Shown under videos with this track, as the licence asks. Leave empty for original music you own.">
        <Input name="attribution" maxLength={300} placeholder="Music: Title by Artist (source)" />
      </Field>
      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading..." : "Add track"}
        </Button>
      </div>
    </form>
  );
}
