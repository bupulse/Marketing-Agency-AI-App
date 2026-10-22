"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Images, Star, Upload, X } from "lucide-react";
import { Button, GlassCard, useToast } from "@/components/ui";
import { MediaPicker } from "@/components/media/media-picker";
import { UploadProgress } from "@/components/media/upload-progress";
import { useGalleryUpload } from "@/components/media/use-gallery-upload";
import { addToAlbum, removeFromAlbum, setAlbumCover } from "@/app/dashboard/knowledge/actions";
import { MAX_ALBUM_PHOTOS } from "@/lib/knowledge/products";
import { UPLOAD_ACCEPT } from "@/lib/media/rules";
import { GalleryThumb } from "@/components/media/media-thumb";

export type AlbumPhoto = { id: string; path: string; url: string; name: string; kind?: string; posterUrl?: string | null; durationMs?: number | null };

/**
 * A product's or campaign's album: upload straight into it, add photos already in the gallery, set the cover (the
 * first photo, used first in designs and posts) or take a photo out (it stays in the gallery).
 */
export function AlbumCard({ kind, id, name, photos }: { kind: "product" | "campaign"; id: string; name: string; photos: AlbumPhoto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const uploader = useGalleryUpload(() => router.refresh());
  const room = MAX_ALBUM_PHOTOS - photos.length;
  const destination = `${kind}:${id}`;

  function act(task: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    start(async () => {
      const result = await task();
      if (!result.ok) return toast(result.error, "error");
      toast(done, "success");
      router.refresh();
    });
  }

  return (
    <GlassCard as="section" aria-labelledby="album-title" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="album-title" className="text-lg font-semibold tracking-[-0.02em]">
            Photos
          </h2>
          <p className="text-[14px] text-muted">
            This {kind}&apos;s album in your gallery. The first photo is the cover. {photos.length} of {MAX_ALBUM_PHOTOS}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={room <= 0} leading={<Images aria-hidden className="size-4" />} onClick={() => setPicking(true)}>
            From gallery
          </Button>
          <Button size="sm" disabled={room <= 0 || uploader.state.active} leading={<Upload aria-hidden className="size-4" />} onClick={() => input.current?.click()}>
            Upload
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={`Upload photos to ${name}`}
        onChange={(e) => {
          if (e.target.files) void uploader.start(Array.from(e.target.files).slice(0, Math.max(room, 0)), destination);
          e.target.value = "";
        }}
      />
      <UploadProgress state={uploader.state} onDismiss={uploader.dismiss} />
      {photos.length === 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center hover:bg-soft"
        >
          <ImagePlus aria-hidden className="size-7 text-pulse-blue" />
          <span className="font-semibold">Add photos of {name}</span>
          <span className="text-[13px] text-muted">Real photos and videos make the best posts. Photos: JPG, PNG or WebP, up to 10 MB. Videos: MP4, MOV or WebM, up to 60 s and 50 MB.</span>
        </button>
      ) : (
        <ul aria-label={`Photos of ${name}`} className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((p, i) => (
            <li key={p.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-soft">
              <GalleryThumb item={p} alt={`${name}, ${p.kind === "video" ? "video" : "photo"} ${i + 1}`} />
              {i === 0 && <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[12px] font-semibold text-white">Cover</span>}
              <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1">
                {i > 0 && (
                  <button
                    type="button"
                    aria-label={`Make photo ${i + 1} the cover`}
                    disabled={pending}
                    onClick={() => act(() => setAlbumCover(kind, id, p.id), "Cover photo set")}
                    className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <Star aria-hidden className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove photo ${i + 1} from this album`}
                  disabled={pending}
                  onClick={() => act(() => removeFromAlbum(kind, id, [p.id]), "Removed from the album. The photo stays in your gallery.")}
                  className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        multiple
        max={Math.max(room, 1)}
        videos
        saveTo={`${kind}:${id}`}
        title={`Add photos or videos to ${name}`}
        confirmLabel={(n) => `Add ${n || ""} item${n === 1 ? "" : "s"}`}
        onPick={(picked) => {
          act(() => addToAlbum(kind, id, picked.map((p) => p.id)), `Added to ${name}`);
        }}
      />
    </GlassCard>
  );
}
