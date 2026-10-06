"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { createPhotoUpload } from "@/app/dashboard/projects/actions";
import { MAX_PHOTOS, PHOTO_TYPES, photoProblem } from "./helpers";

export type PhotoItem = {
  key: string;
  /** Storage path once uploaded. */
  path?: string;
  preview: string;
  status: "uploading" | "done" | "error";
  /** True for a temporary browser link that must be released. */
  local?: boolean;
};

/** Drag-and-drop or pick up to 10 photos; each uploads straight to storage. */
export function PhotoPicker({
  photos,
  onChange,
  onBusyChange,
}: {
  photos: PhotoItem[];
  onChange: (updater: (current: PhotoItem[]) => PhotoItem[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
    onBusyChange(photos.some((p) => p.status === "uploading"));
  }, [photos, onBusyChange]);

  // Free temporary previews when the form closes.
  useEffect(
    () => () => {
      for (const p of photosRef.current) if (p.local) URL.revokeObjectURL(p.preview);
    },
    [],
  );

  async function upload(file: File, key: string) {
    const fail = (text: string) => {
      setMessage(text);
      onChange((cur) => cur.filter((p) => p.key !== key));
    };
    try {
      const target = await createPhotoUpload({ fileName: file.name, type: file.type, size: file.size });
      if (!target.ok) return fail(target.error);
      const { error } = await createClient().storage.from("media").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) return fail("A photo did not upload. Please try again.");
      onChange((cur) => cur.map((p) => (p.key === key ? { ...p, path: target.path, status: "done" } : p)));
    } catch {
      fail("A photo did not upload. Please try again.");
    }
  }

  function addFiles(list: FileList | File[]) {
    setMessage(null);
    const files = Array.from(list);
    const room = MAX_PHOTOS - photosRef.current.length;
    if (room <= 0) {
      setMessage(`You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const accepted: File[] = [];
    for (const file of files) {
      const problem = photoProblem(file);
      if (problem) {
        setMessage(problem);
        continue;
      }
      if (accepted.length < room) accepted.push(file);
      else setMessage(`You can add up to ${MAX_PHOTOS} photos. Some were left out.`);
    }
    const items = accepted.map((file) => ({
      file,
      item: { key: crypto.randomUUID(), preview: URL.createObjectURL(file), status: "uploading" as const, local: true },
    }));
    if (items.length === 0) return;
    onChange((cur) => [...cur, ...items.map((i) => i.item)]);
    for (const { file, item } of items) void upload(file, item.key);
  }

  function remove(item: PhotoItem) {
    if (item.local) URL.revokeObjectURL(item.preview);
    onChange((cur) => cur.filter((p) => p.key !== item.key));
  }

  const full = photos.length >= MAX_PHOTOS;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={PHOTO_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={full}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-60",
          dragging ? "border-pulse-blue bg-soft" : "border-line hover:bg-soft",
        )}
      >
        <ImagePlus aria-hidden className="size-7 text-muted" />
        <span className="text-[15px] font-medium">{full ? "Photo limit reached" : "Drop photos here or choose from your device"}</span>
        <span className="text-[13px] text-muted">
          JPG, PNG or WebP, up to 10 MB each. {photos.length} of {MAX_PHOTOS} added.
        </span>
      </button>

      <p role={message ? "alert" : "status"} className="text-[13px] font-medium text-danger">
        {message}
      </p>

      {photos.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
          {photos.map((p, i) => (
            <li key={p.key} className="glass relative aspect-square overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL or local blob */}
              <img src={p.preview} alt={`Photo ${i + 1}`} className="size-full object-cover" />
              {p.status === "uploading" && (
                <span role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-xs font-medium text-white">
                  <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                  Uploading
                </span>
              )}
              {p.status === "error" && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
                  <TriangleAlert aria-hidden className="size-5" />
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => remove(p)}
                className="absolute top-1 right-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
