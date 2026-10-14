"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { startReleaseUploadAction, verifyReleaseAction } from "@/app/admin/(console)/(system)/settings/updates/actions";
import { createClient } from "@/lib/supabase/client";

const MAX_MB = 50;

/**
 * Upload a version: the zip goes straight to the private "releases" bucket with a signed upload address (never through
 * the app's server), then the server checks it against its .sig (signature, sha256, every path) before Install shows.
 */
export function ReleaseUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [sig, setSig] = useState<File | null>(null);

  function submit(form: FormData) {
    setError(null);
    if (!zip || !zip.name.endsWith(".zip")) return setError("Choose the .zip made by npm run release:zip.");
    if (!sig || !sig.name.endsWith(".sig")) return setError("Choose the matching .zip.sig file.");
    if (zip.size > MAX_MB * 1024 * 1024) return setError(`The zip can be at most ${MAX_MB} MB.`);
    start(async () => {
      setStage("Uploading…");
      const target = await startReleaseUploadAction({ bytes: zip.size });
      if (!target.ok || !target.path || !target.token) {
        setStage(null);
        return setError(target.ok ? "No upload address." : target.error);
      }
      const { error: uploadError } = await createClient().storage.from("releases").uploadToSignedUrl(target.path, target.token, zip, { contentType: "application/zip" });
      if (uploadError) {
        setStage(null);
        return setError("The upload did not go through. Try again.");
      }
      setStage("Checking the signature and every file…");
      const done = await verifyReleaseAction({ path: target.path, sig: await sig.text(), notes: String(form.get("notes") ?? "") });
      setStage(null);
      if (!done.ok) return setError(done.error);
      setZip(null);
      setSig(null);
      router.push(`/admin/settings/updates?notice=${encodeURIComponent(`${done.version} is verified. Install it from the list below.`)}#versions`);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Release zip" hint={`bupulse-x.y.z.zip, at most ${MAX_MB} MB.`} required>
        <Input type="file" accept=".zip,application/zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Signature" hint="bupulse-x.y.z.zip.sig, made with it." required>
        <Input type="file" accept=".sig" onChange={(e) => setSig(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Notes (optional)" hint="What changed; shown in the list of versions.">
        <Textarea name="notes" rows={2} maxLength={500} />
      </Field>
      <div className="flex flex-col justify-end gap-2">
        <Button type="submit" disabled={pending}>{pending ? stage ?? "Working…" : "Upload and check"}</Button>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        {pending && stage && <p role="status" className="text-sm text-muted">{stage}</p>}
      </div>
    </form>
  );
}
