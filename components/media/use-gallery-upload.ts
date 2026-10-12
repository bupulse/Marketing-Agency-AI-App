"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createUploadTargets, discardUpload, finalizeUpload } from "@/app/dashboard/gallery/actions";
import { fileProblem, inferMimeType, MEDIA_MAX_BYTES, nameFromFile, scaledSize, UPLOAD_BATCH_MAX } from "@/lib/media/rules";
import type { MediaItem } from "@/lib/media/service";

export type UploadState = { active: boolean; total: number; done: number; failed: number; errors: string[]; /** The file being worked on (imports only). */ current?: string };

const IDLE: UploadState = { active: false, total: 0, done: 0, failed: 0, errors: [] };
const PARALLEL = 3;

type Prepared = { file: File; width: number | null; height: number | null } | "broken";

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void } | null> {
  try {
    // "from-image" applies the EXIF rotation, so phone photos come out the right way up.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {}
  // Older Safari: an <img> applies the EXIF rotation itself.
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Reads the photo's size and scales it down when its long side is over 2048 px, so files stay small and the
 * server never decodes huge images. Scaled photos become JPEG (quality 0.9); a PNG with transparency stays PNG
 * unless that would pass the size limit. Photos that already fit are uploaded untouched.
 */
async function prepareImage(file: File): Promise<Prepared> {
  const image = await decode(file);
  if (!image || image.width === 0) return "broken";
  try {
    const target = scaledSize(image.width, image.height);
    if (target.width === image.width && target.height === image.height) return { file, width: image.width, height: image.height };
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { file, width: image.width, height: image.height };
    ctx.drawImage(image.source, 0, 0, target.width, target.height);

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const mime = inferMimeType(file.name, file.type);
    if (mime === "image/png" || mime === "image/webp") {
      const px = ctx.getImageData(0, 0, target.width, target.height).data;
      let transparent = false;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] < 255) {
          transparent = true;
          break;
        }
      }
      if (transparent) {
        const png = await toBlob(canvas, "image/png");
        if (png && png.size <= MEDIA_MAX_BYTES) return { file: new File([png], `${baseName}.png`, { type: "image/png" }), ...target };
      }
    }
    // JPEG has no transparency: put the photo on white.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, target.width, target.height);
    const jpeg = await toBlob(canvas, "image/jpeg", 0.9);
    if (!jpeg || jpeg.size === 0) return { file, width: image.width, height: image.height };
    return { file: new File([jpeg], `${baseName}.jpg`, { type: "image/jpeg" }), ...target };
  } finally {
    image.close();
  }
}

/**
 * Uploads photos straight from the browser to Storage, three at a time. Each batch asks the server for
 * signed upload URLs (type, size, quota and the destination are checked there), uploads, then finalizes each file.
 * `destination` is "folder:<id>", "product:<id>" or "campaign:<id>" (lib/media/destinations.ts): every upload needs one.
 * `onUploaded` gets the photos that made it, once the whole drop is finished.
 */
export function useGalleryUpload(onUploaded?: (items: MediaItem[]) => void) {
  const [state, setState] = useState<UploadState>(IDLE);
  const running = useRef(false);

  const bump = useCallback((patch: (s: UploadState) => UploadState) => setState((s) => patch(s)), []);
  const dismiss = useCallback(() => setState((s) => (s.active ? s : IDLE)), []);

  const start = useCallback(
    async (list: FileList | File[], destination: string) => {
      if (running.current) return;
      const files = Array.from(list);
      if (files.length === 0) return;
      running.current = true;
      const errors: string[] = [];
      const valid = files.filter((file) => {
        const problem = fileProblem(file);
        if (problem) errors.push(problem);
        return !problem;
      });
      setState({ active: valid.length > 0, total: files.length, done: 0, failed: errors.length, errors });
      const uploaded: MediaItem[] = [];
      const fail = (message: string) => bump((s) => ({ ...s, failed: s.failed + 1, errors: s.errors.includes(message) ? s.errors : [...s.errors, message] }));

      try {
        for (let i = 0; i < valid.length; i += UPLOAD_BATCH_MAX) {
          // Scale down first so the sizes sent to the server are the real ones.
          const prepared: { file: File; width: number | null; height: number | null }[] = [];
          for (const original of valid.slice(i, i + UPLOAD_BATCH_MAX)) {
            const p = await prepareImage(original);
            if (p === "broken") fail(`${original.name} could not be read as a photo.`);
            else prepared.push(p);
          }
          if (prepared.length === 0) continue;
          const batch = prepared.map((p) => p.file);
          const res = await createUploadTargets({ destination, files: batch.map((f) => ({ name: f.name, type: inferMimeType(f.name, f.type), size: f.size })) });
          if (!res.ok) {
            batch.forEach(() => fail(res.error));
            continue;
          }
          const storage = createClient().storage.from("media");
          let next = 0;
          const worker = async () => {
            while (next < batch.length) {
              const index = next++;
              const { file, width, height } = prepared[index];
              const target = res.targets[index];
              if (!target?.ok) {
                fail(target?.error ?? `${file.name} could not be uploaded.`);
                continue;
              }
              try {
                const { error } = await storage.uploadToSignedUrl(target.path, target.token, file, { contentType: inferMimeType(file.name, file.type) });
                if (error) throw error;
                const saved = await finalizeUpload({ path: target.path, name: nameFromFile(file.name), destination, width, height });
                if (!saved.ok) {
                  void discardUpload(target.path);
                  fail(saved.error);
                  continue;
                }
                uploaded.push(saved.item);
                bump((s) => ({ ...s, done: s.done + 1 }));
              } catch {
                void discardUpload(target.path);
                fail(`${file.name} did not upload. Please try again.`);
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, worker));
        }
      } finally {
        running.current = false;
        bump((s) => ({ ...s, active: false }));
        if (uploaded.length > 0) onUploaded?.(uploaded);
      }
    },
    [bump, onUploaded],
  );

  return { state, start, dismiss };
}
