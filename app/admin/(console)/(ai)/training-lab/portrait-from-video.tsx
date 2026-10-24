"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { PORTRAIT_QUALITY, momentOf, portraitSize } from "@/lib/training-lab/portrait";
import { confirmExampleFileAction } from "./actions";
import { createPortraitAction } from "./portrait-actions";

// The private bucket's name (lib/training-lab/storage.ts TRAINING_BUCKET; that file is server-only).
const BUCKET = "training-lab";
const UNREADABLE = "This video cannot be read by the browser; upload a photo instead.";

/**
 * "Use this moment as the portrait" for an actor's video: the browser draws the frame it is showing to a canvas as a JPEG,
 * the server makes a new actor example from it (same person and consent), and the still goes up like any example file.
 */
export function PortraitFromVideo({ id, url, title }: { id: string; url: string; title: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);

  async function use() {
    const v = video.current;
    if (!v || stage) return;
    setError(null);
    setMade(null);
    const size = portraitSize(v.videoWidth, v.videoHeight);
    if (!size) return setError("Play the video until the face is clear, then pause it and try again.");
    v.pause();
    const at = momentOf(v.currentTime);
    let blob: Blob | null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return setError("This browser cannot make the picture.");
      ctx.drawImage(v, 0, 0, size.width, size.height);
      // A video the browser may not read taints the canvas: toBlob then throws, and we say so instead of failing silently.
      blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          canvas.toBlob(resolve, "image/jpeg", PORTRAIT_QUALITY);
        } catch (e) {
          reject(e);
        }
      });
    } catch {
      return setError(UNREADABLE);
    }
    if (!blob) return setError(UNREADABLE);
    try {
      setStage("Saving the portrait…");
      const created = await createPortraitAction(id, at, { name: "portrait.jpg", type: "image/jpeg", size: blob.size });
      if (!created.ok) return setError(created.error);
      if (!created.upload) return setError(`The portrait is saved, but ${(created.warning ?? "the picture could not be uploaded.").replace(/^./, (c) => c.toLowerCase())} Open it and add the photo again.`);
      setStage("Uploading the picture…");
      const { error: failed } = await createClient().storage.from(BUCKET).uploadToSignedUrl(created.upload.path, created.upload.token, blob, { contentType: "image/jpeg" });
      if (failed) return setError("The portrait is saved, but the upload did not go through. Open it and add the photo again.");
      setStage("Checking the picture…");
      const confirmed = await confirmExampleFileAction(created.id, created.upload.path);
      if (!confirmed.ok) return setError(`The portrait is saved, but ${confirmed.error.charAt(0).toLowerCase()}${confirmed.error.slice(1)}`);
      setMade(created.id);
    } finally {
      setStage(null);
    }
  }

  return (
    <section aria-label={`Portrait from ${title}`} className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-line px-3 py-3">
      <p className="text-[14px] font-medium">Portrait from this video</p>
      <p className="text-[13px] text-muted">Pause on a clear shot of the face, then use that moment. It becomes a new actor example with the same consent, for the presenters.</p>
      <video ref={video} src={url} crossOrigin="anonymous" controls playsInline preload="metadata" onError={() => setError(UNREADABLE)} className="max-h-96 w-auto max-w-full rounded-xl bg-black" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={use} disabled={stage !== null}>{stage ?? "Use this moment as the portrait"}</Button>
      </div>
      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}
      {made && (
        <p role="status" className="text-[13px] font-medium text-success">
          Portrait saved. <a href={`/admin/training-lab#ex-${made}`} className="underline">See it in the Library</a>
        </p>
      )}
    </section>
  );
}
