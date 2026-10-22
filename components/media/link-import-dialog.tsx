"use client";

import { useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { finishLinkedVideo, importFromLink, type ImportResult } from "@/app/dashboard/gallery/import-actions";
import { createClient } from "@/lib/supabase/client";
import { parseMediaLink } from "@/lib/media/links";
import { GALLERY_VIDEO_BUCKET } from "@/lib/media/rules";
import type { MediaItem, PosterTarget } from "@/lib/media/service";
import { videoFrame } from "./use-gallery-upload";
import type { ImportTask } from "./use-importer";

type Result = ImportResult<{ item: MediaItem }>;

/**
 * An imported video's poster: the server cannot draw frames, so the browser loads the video it just saved, draws the
 * first frame the way an upload does and uploads it to the server's poster slot. Best effort: without it the gallery
 * shows a plain video tile, and the video is imported either way.
 */
async function withPoster(item: MediaItem, poster: PosterTarget): Promise<Result> {
  try {
    const frame = await videoFrame(item.url, { crossOrigin: true });
    if (!frame) return { ok: true, item };
    if (frame.poster) {
      const bucket = createClient().storage.from(GALLERY_VIDEO_BUCKET);
      await bucket.uploadToSignedUrl(poster.path, poster.token, frame.poster, { contentType: "image/jpeg" }).catch(() => null);
    }
    const saved = await finishLinkedVideo({ id: item.id, width: frame.width, height: frame.height });
    return saved.ok ? saved : { ok: true, item };
  } catch {
    return { ok: true, item };
  }
}

async function importLink(link: string, destination: string, videos: boolean): Promise<Result> {
  const res = await importFromLink({ link, destination, videos });
  if (!res.ok || res.item.kind !== "video" || !res.poster) return res;
  return withPoster(res.item, res.poster);
}

/**
 * "Import from a link": one field for a link to a photo or video on Google Drive, Dropbox or a website. It stays open
 * while the file is imported (the host's progress bar shows it too) and closes when it is in; a problem shows under
 * the field so the person can fix the link. `videos: false` in a photo-only picker.
 */
export function LinkImportDialog({ open, onOpenChange, destination, videos, onImport }: { open: boolean; onOpenChange: (open: boolean) => void; destination: string; videos: boolean; onImport: (tasks: ImportTask[]) => Promise<void> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import from a link" description={`BuPulse copies the ${videos ? "photo or video" : "photo"} into your gallery.`}>
      {open && <Body onOpenChange={onOpenChange} destination={destination} videos={videos} onImport={onImport} />}
    </Dialog>
  );
}

function Body({ onOpenChange, destination, videos, onImport }: { onOpenChange: (open: boolean) => void; destination: string; videos: boolean; onImport: (tasks: ImportTask[]) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = parseMediaLink(value);
    if (!checked.ok) return setError(checked.error);
    setError(undefined);
    setBusy(true);
    const out: { result?: Result } = {};
    const name = videos ? "Photo or video from a link" : "Photo from a link";
    await onImport([{ name, run: async () => (out.result = await importLink(value.trim(), destination, videos)) }]);
    setBusy(false);
    if (out.result?.ok) onOpenChange(false);
    else setError(out.result?.error ?? "That link could not be imported. Check your connection and try again.");
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        label={videos ? "Paste a link to a photo or video: Google Drive, Dropbox or a website" : "Paste a link to a photo: Google Drive, Dropbox or a website"}
        hint="A Google Drive file must be shared with Anyone with the link."
        error={error}
      >
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(undefined);
          }}
          placeholder="https://"
          disabled={busy}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || !value.trim()}>
          {busy ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}
