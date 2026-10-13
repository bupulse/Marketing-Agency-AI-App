"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { SecretBox } from "@/components/connectors/secret-box";
import { createScreenLinkAction, finishSoundUploadAction, startSoundUploadAction } from "@/app/admin/(console)/(organisation)/organisation/screen/actions";
import { createClient } from "@/lib/supabase/client";
import { SOUND_MAX_BYTES } from "@/lib/screen/shared";

/** New screen link: the full URL is shown once, with a copy button; only its hash is kept. */
export function ScreenLinkForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const r = await createScreenLinkAction(String(form.get("name") ?? ""));
      if (!r.ok) return setError(r.error);
      setUrl(r.url);
      router.refresh();
    });
  }

  if (url) return <SecretBox title="Open this address on the TV. It is shown only now: copy it before closing." value={url} onDone={() => setUrl(null)} />;

  return (
    <form action={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Field label="Screen name" required hint="For example: Sales room TV.">
          <Input name="name" maxLength={80} required />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Creating..." : "Create link"}</Button>
      {error && <p role="alert" className="text-[14px] font-medium text-danger">{error}</p>}
    </form>
  );
}

/** Sound upload: the MP3 goes straight to the private sounds bucket with a signed URL, then the server checks it. */
export function SoundUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  function submit(form: FormData) {
    setError(null);
    const rights = form.get("rights") === "on";
    if (!file) return setError("Choose an MP3 file.");
    if (!rights) return setError("Tick the box to confirm you hold the rights to this sound.");
    if (file.size > SOUND_MAX_BYTES) return setError("Sounds can be at most 1 MB.");
    start(async () => {
      const target = await startSoundUploadAction({ bytes: file.size, rights });
      if (!target.ok) return setError(target.error);
      const { error: uploadError } = await createClient().storage.from("sounds").uploadToSignedUrl(target.path, target.token, file, { contentType: "audio/mpeg" });
      if (uploadError) return setError("The upload did not go through. Try again.");
      const done = await finishSoundUploadAction(target.path, { name: String(form.get("name") ?? ""), rights });
      if (!done.ok) return setError(done.error);
      setFile(null);
      router.push("/admin/organisation/screen?notice=Sound%20added.");
      router.refresh();
    });
  }

  return (
    <form action={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="File (MP3, at most 1 MB)" required>
        <Input type="file" accept="audio/mpeg,.mp3" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Name" required>
        <Input name="name" maxLength={60} required />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-[14px] sm:col-span-2">
        <input type="checkbox" name="rights" required className="size-5" />
        I hold the rights to this sound.
      </label>
      {error && (
        <p role="alert" className="text-[14px] font-medium text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Uploading..." : "Add sound"}</Button>
      </div>
    </form>
  );
}
