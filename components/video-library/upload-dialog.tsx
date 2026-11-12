"use client";

/**
 * <UploadVideoDialog> is "Upload a video" on the Videos page (lib/video-library/upload.ts): the company's own finished
 * videos into the library. Pick one or several MP4, MOV or WebM files, give each a title (it is also the caption) and,
 * when it is about one, a product; each file goes straight from the browser to Storage with the server's signed upload
 * (with a progress bar), then the server checks it and adds it to the library. No credits are used.
 *
 * Props:
 *   open, onOpenChange  the dialog (it stays open while files are uploading)
 *   products            the company's products, for "What is it about?" (optional per video)
 *   storage             the company's video storage: bytes used and its cap (lib/media/rules.ts companyVideoMaxBytes)
 *   onUploaded          each video once it is in the library
 */

import { useRef, useState, type DragEvent } from "react";
import { CheckCircle2, Film, Loader2, Upload, X } from "lucide-react";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";
import { discardVideoUploadAction, finishVideoUploadAction, startVideoUploadsAction } from "@/app/dashboard/video/actions";
import { videoFrame } from "@/components/media/use-gallery-upload";
import { cn } from "@/lib/cn";
import { fileProblem, formatBytes, GALLERY_VIDEO_BUCKET, inferMimeType, isVideoType, storedVideoType, VIDEO_MAX_MS } from "@/lib/media/rules";
import { createClient } from "@/lib/supabase/client";
import type { LibraryVideo } from "@/lib/video-library/service";
import { titleFromFile, UPLOAD_PICK_MAX, UPLOAD_TITLE_MAX, VIDEO_ACCEPT } from "@/lib/video-library/upload-rules";

type Status = "waiting" | "uploading" | "saving" | "done" | "failed";
type Row = { key: string; file: File; title: string; productId: string; status: Status; pct: number; error: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: { id: string; name: string }[];
  storage: { used: number; max: number };
  /** Each video once it is in the library, with the bytes it added to the video storage. */
  onUploaded: (video: LibraryVideo, bytes: number) => void;
};

/** Two files at a time: phones on mobile data do better with fewer streams. */
const PARALLEL = 2;

/** Why a picked file cannot go (the server checks the same again), or null. */
function problemOf(file: File): string | null {
  if (!isVideoType(inferMimeType(file.name, file.type))) return `${file.name}: use an MP4, MOV or WebM video.`;
  return fileProblem(file);
}

/**
 * The file to its signed upload address with progress (a raw PUT, as the Storage client sends a file); the Storage
 * client itself when that fails. A MOV is stored and served as MP4 (the bucket takes MP4 and WebM).
 */
function putFile(path: string, token: string, file: File, onPct: (pct: number) => void): Promise<void> {
  const type = storedVideoType(inferMimeType(file.name, file.type));
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const fallback = () =>
    createClient()
      .storage.from(GALLERY_VIDEO_BUCKET)
      .uploadToSignedUrl(path, token, file, { contentType: type })
      .then(({ error }) => {
        if (error) throw error;
      });
  if (!base) return fallback();
  return new Promise((resolve, reject) => {
    const url = new URL(`${base.replace(/\/$/, "")}/storage/v1/object/upload/sign/${GALLERY_VIDEO_BUCKET}/${path}`);
    url.searchParams.set("token", token);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url.toString());
    xhr.setRequestHeader("content-type", type);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    const retry = () => fallback().then(resolve, reject);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : retry());
    xhr.onerror = retry;
    xhr.send(file);
  });
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-line">
      <span className="block h-full rounded-full bg-brand-gradient transition-[width] duration-300" style={{ width: `${value}%` }} />
    </div>
  );
}

const STATUS_TEXT: Record<Status, string> = { waiting: "Ready to upload", uploading: "Uploading", saving: "Checking the video", done: "In your library", failed: "Not uploaded" };

export function UploadVideoDialog({ open, onOpenChange, products, storage, onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const patch = (key: string, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const left = Math.max(0, storage.max - storage.used);
  const waiting = rows.filter((r) => r.status === "waiting" && !r.error);
  const picked = waiting.reduce((sum, r) => sum + r.file.size, 0);
  const finished = rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "failed" || r.error);

  const close = (next: boolean) => {
    if (next || busy) return; // Closing while files are uploading would lose them.
    onOpenChange(false);
    setRows([]);
    setNotice(null);
  };

  const add = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setNotice(null);
    setRows((old) => {
      const kept = old.filter((r) => r.status !== "done");
      const room = Math.max(0, UPLOAD_PICK_MAX - kept.length);
      if (files.length > room) setNotice(`Up to ${UPLOAD_PICK_MAX} videos at a time. Upload these first, then pick more.`);
      const fresh = files.slice(0, room).map((file): Row => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file, title: titleFromFile(file.name), productId: "", status: "waiting", pct: 0, error: problemOf(file) }));
      return [...kept, ...fresh];
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setHover(false);
    if (!busy) add(e.dataTransfer.files);
  };

  const uploadOne = async (row: Row, slot: { path: string; token: string; poster: { path: string; token: string } | null }, frame: Awaited<ReturnType<typeof videoFrame>>) => {
    try {
      patch(row.key, { status: "uploading", pct: 0 });
      await putFile(slot.path, slot.token, row.file, (pct) => patch(row.key, { pct }));
      if (slot.poster && frame?.poster) {
        await createClient().storage.from(GALLERY_VIDEO_BUCKET).uploadToSignedUrl(slot.poster.path, slot.poster.token, frame.poster, { contentType: "image/jpeg" }).catch(() => null);
      }
      patch(row.key, { status: "saving", pct: 100 });
      const res = await finishVideoUploadAction({ path: slot.path, title: row.title.trim(), productId: row.productId || null, width: frame?.width ? Math.round(frame.width) : null, height: frame?.height ? Math.round(frame.height) : null });
      if (!res.ok) {
        void discardVideoUploadAction(slot.path);
        return patch(row.key, { status: "failed", error: res.error });
      }
      patch(row.key, { status: "done" });
      onUploaded(res.video, row.file.size + (frame?.poster?.size ?? 0));
    } catch {
      void discardVideoUploadAction(slot.path);
      patch(row.key, { status: "failed", error: `${row.file.name} did not upload. Check your connection and try again.` });
    }
  };

  const start = async () => {
    if (busy || waiting.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      // The length, size and poster (a frame at about 1 second) are read in the browser first.
      const frames = new Map<string, Awaited<ReturnType<typeof videoFrame>>>();
      const ready: Row[] = [];
      for (const row of waiting) {
        const url = URL.createObjectURL(row.file);
        try {
          const frame = await videoFrame(url, { at: 1 });
          if (frame?.durationMs && frame.durationMs > VIDEO_MAX_MS + 500) {
            patch(row.key, { status: "failed", error: `${row.file.name} is longer than 60 seconds. Trim it and upload it again.` });
            continue;
          }
          frames.set(row.key, frame);
          ready.push(row);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (ready.length === 0) return;
      const res = await startVideoUploadsAction(ready.map((r) => ({ name: r.file.name, type: inferMimeType(r.file.name, r.file.type), size: r.file.size })));
      if (!res.ok) {
        ready.forEach((r) => patch(r.key, { status: "failed", error: res.error }));
        return;
      }
      const jobs = ready.flatMap((row, i) => {
        const slot = res.slots[i];
        if (!slot?.ok) {
          patch(row.key, { status: "failed", error: slot?.error ?? `${row.file.name} could not be started.` });
          return [];
        }
        return [{ row, slot }];
      });
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const { row, slot } = jobs[next++];
          await uploadOne(row, slot, frames.get(row.key) ?? null);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
    } finally {
      setBusy(false);
    }
  };

  const doneCount = rows.filter((r) => r.status === "done").length;

  return (
    <Dialog open={open} onOpenChange={close} title="Upload a video" description="Add videos you already made. They go in your library to watch, download and schedule. Uploading uses no credits." className="max-w-2xl">
      <div className="mt-4 flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={onDrop}
          className={cn("flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center", hover ? "border-pulse-blue bg-soft" : "border-line")}
        >
          <Film aria-hidden className="size-7 text-pulse-blue" />
          <span className="text-sm font-medium">Drop videos here, or pick them</span>
          <span className="text-xs text-muted">MP4, MOV or WebM, up to 60 seconds and 50 MB each. Up to {UPLOAD_PICK_MAX} at a time.</span>
          <input ref={input} type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy} leading={<Upload className="size-4" aria-hidden />}>
            Pick videos
          </Button>
        </div>

        <p className="text-xs text-muted">
          Video storage: {formatBytes(storage.used)} of {formatBytes(storage.max)} used, {formatBytes(left)} left.
          {picked > left && picked > 0 ? ` These videos (${formatBytes(picked)}) need more room than is left: delete some videos first, or upload fewer.` : ""}
        </p>
        {notice && <p className="text-sm text-danger">{notice}</p>}

        {rows.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label="Videos to upload">
            {rows.map((r) => {
              const editable = r.status === "waiting" && !busy;
              return (
                <li key={r.key} className="flex flex-col gap-3 rounded-2xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{r.file.name}</span>
                      <span className="text-xs text-muted">
                        {formatBytes(r.file.size)} · {r.error && r.status === "waiting" ? "Cannot be uploaded" : STATUS_TEXT[r.status]}
                        {r.status === "uploading" ? ` ${r.pct}%` : ""}
                      </span>
                    </div>
                    {r.status === "done" && <CheckCircle2 aria-label="Uploaded" className="size-5 shrink-0 text-success" />}
                    {(r.status === "saving" || (r.status === "uploading" && r.pct >= 99)) && <Loader2 aria-hidden className="size-5 shrink-0 animate-spin text-pulse-blue" />}
                    {editable && (
                      <button type="button" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-soft hover:text-text" aria-label={`Remove ${r.file.name}`}>
                        <X aria-hidden className="size-4" />
                      </button>
                    )}
                  </div>
                  {(r.status === "uploading" || r.status === "saving") && <Progress value={r.status === "saving" ? 100 : r.pct} label={`Uploading ${r.file.name}`} />}
                  {r.error ? (
                    <p className="text-sm text-danger">{r.error}</p>
                  ) : (
                    r.status === "waiting" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Title (also the caption)">
                          <Input value={r.title} maxLength={UPLOAD_TITLE_MAX} disabled={!editable} onChange={(e) => patch(r.key, { title: e.target.value })} placeholder="What is this video about?" />
                        </Field>
                        {products.length > 0 && (
                          <Field label="Product (optional)">
                            <Select value={r.productId} disabled={!editable} onChange={(e) => patch(r.key, { productId: e.target.value })}>
                              <option value="">The whole business</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        )}
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {rows.some((r) => r.status === "waiting" && !r.error) && <p className="text-xs text-muted">Titles are optional. You can change the caption when you schedule the video.</p>}
      </div>
      {/* The buttons stay in sight at the bottom while the list scrolls (the Dialog's own scroll area). */}
      <div className="sticky -bottom-6 z-10 -mx-4 mt-4 -mb-6 flex flex-col gap-3 border-t border-line bg-[var(--bp-dialog)] px-4 pt-4 pb-6">
        {busy && <p className="text-sm text-muted">Keep this window open until the uploads finish.</p>}
        {finished && !busy && doneCount > 0 && (
          <p className="text-sm font-medium text-success">
            {doneCount === 1 ? "1 video is" : `${doneCount} videos are`} in your library now.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {finished ? "Done" : "Cancel"}
          </Button>
          {waiting.length > 0 && (
            <Button onClick={start} disabled={busy} leading={busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}>
              {busy ? "Uploading…" : waiting.length === 1 ? "Upload 1 video" : `Upload ${waiting.length} videos`}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
