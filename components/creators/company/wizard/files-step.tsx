"use client";

// Step 10 of the campaign wizard: the campaign's files (docs/CREATOR_CAMPAIGN_WIZARD.md, "Files"). Three Photos
// folders made for the campaign (Images, Videos, Documents), filled with the gallery's own upload and Import menu; a
// shared Google Drive folder; links to posts the owner likes; and what must be there before going live.

import { CheckCircle2, Circle, ExternalLink, FileText, Film, ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Field, Input } from "@/components/ui";
import { ImportMenu } from "@/components/media/import-menu";
import { GalleryThumb, type ThumbItem } from "@/components/media/media-thumb";
import { UploadProgress } from "@/components/media/upload-progress";
import { useGalleryUpload } from "@/components/media/use-gallery-upload";
import { useImporter } from "@/components/media/use-importer";
import type { DestinationOption } from "@/lib/media/destinations";
import { readinessChecklist, SUGGESTED_DOCUMENTS } from "@/lib/creators/wizard-steps";
import { Question } from "./controls";
import type { StepProps } from "./wizard";

const DOCS_EVENT = "bp-wizard-docs";
const readStored = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
};
const subscribeDocs = (change: () => void) => {
  window.addEventListener(DOCS_EVENT, change);
  window.addEventListener("storage", change);
  return () => {
    window.removeEventListener(DOCS_EVENT, change);
    window.removeEventListener("storage", change);
  };
};

export type FolderView = { key: "images" | "videos" | "documents"; id: string; name: string; count: number; items: (ThumbItem & { id: string; name: string })[] };

const FOLDER_COPY = {
  images: { title: "Images", hint: "Your logo and product photos. Required before going live.", accept: "image/jpeg,image/png,image/webp", icon: ImageIcon },
  videos: { title: "Videos", hint: "Example videos or a mood board: what good looks like.", accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm", icon: Film },
  documents: { title: "Documents", hint: "Photos or screenshots of your guides and price lists. PDFs go in your Drive folder below.", accept: "image/jpeg,image/png,image/webp", icon: FileText },
} as const;

export function FilesStep({ a, set, o }: StepProps) {
  const router = useRouter();
  const done = useCallback(() => router.refresh(), [router]);
  const upload = useGalleryUpload(done);
  const importer = useImporter(done);
  const folders = o.folders ?? [];
  const destinations: DestinationOption[] = folders.map((f) => ({ key: `folder:${f.id}`, label: f.name, group: "Folders" }));
  const [link, setLink] = useState("");
  const files = a.files;
  const counts = Object.fromEntries(folders.map((f) => [f.key, f.count])) as Record<FolderView["key"], number>;
  const checklist = readinessChecklist({ brief: a.brief, dos: a.dos, donts: a.donts, tasks: a.tasks.length, images: counts.images ?? 0, videos: counts.videos ?? 0, exampleLinks: files.exampleLinks.length });
  const addLink = () => {
    const v = link.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(v) || files.exampleLinks.includes(v) || files.exampleLinks.length >= 10) return;
    set({ files: { ...files, exampleLinks: [...files.exampleLinks, v] } });
    setLink("");
  };

  return (
    <div className="flex flex-col gap-7">
      <Question label="Before you can go live" id="q-ready">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-[14px]">
              {c.done ? <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" /> : <Circle aria-hidden className="size-5 shrink-0 text-muted" />}
              <span className={c.done ? "" : "text-muted"}>
                {c.label}
                <span className="sr-only">{c.done ? ": done" : ": missing"}</span>
              </span>
            </li>
          ))}
        </ul>
      </Question>

      {(upload.state.total > 0 || importer.state.total > 0) && (
        <div className="flex flex-col gap-2">
          <UploadProgress state={upload.state} onDismiss={upload.dismiss} />
          <UploadProgress state={importer.state} onDismiss={importer.dismiss} verb="Importing" />
        </div>
      )}

      {folders.length === 0 ? (
        <p className="rounded-2xl bg-danger-bg px-4 py-3 text-[15px] text-danger">Your campaign&apos;s folders could not be made. Open this step again.</p>
      ) : (
        folders.map((f) => <FolderCard key={f.key} folder={f} busy={upload.state.active || importer.state.active} onFiles={(list) => void upload.start(list, `folder:${f.id}`)} importer={importer} destinations={destinations} />)
      )}

      <Field label="A shared Google Drive folder (optional)" hint="For PDFs and big files. Share it with “Anyone with the link”.">
        <Input type="url" inputMode="url" value={files.driveUrl ?? ""} onChange={(e) => set({ files: { ...files, driveUrl: e.target.value || null } })} placeholder="https://drive.google.com/drive/folders/…" autoCapitalize="off" />
      </Field>

      <Question label="Posts you like (optional)" hint="Links to TikToks, Reels or posts that show the style you want. Up to 10." id="q-examples">
        {files.exampleLinks.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {files.exampleLinks.map((l) => (
              <li key={l} className="flex items-center gap-2 rounded-xl bg-soft py-1 pr-1 pl-3 text-[14px]">
                <a href={l} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-[color:var(--bp-link)] underline">
                  <span className="truncate">{l}</span> <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                </a>
                <button type="button" aria-label={`Remove ${l}`} onClick={() => set({ files: { ...files, exampleLinks: files.exampleLinks.filter((x) => x !== l) } })} className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-glass hover:text-text">
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            aria-label="Link to a post you like"
            type="url"
            inputMode="url"
            value={link}
            autoCapitalize="off"
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="https://www.tiktok.com/@someone/video/…"
          />
          <Button variant="outline" onClick={addLink} disabled={!/^https?:\/\/\S+\.\S+/.test(link.trim())} leading={<Plus aria-hidden className="size-4" />}>
            Add
          </Button>
        </div>
      </Question>

      <SuggestedDocuments campaignId={o.campaignId ?? "new"} />
    </div>
  );
}

function FolderCard({ folder: f, busy, onFiles, importer, destinations }: { folder: FolderView; busy: boolean; onFiles: (list: FileList) => void; importer: ReturnType<typeof useImporter>; destinations: DestinationOption[] }) {
  const copy = FOLDER_COPY[f.key];
  const Icon = copy.icon;
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby={`folder-${f.key}`} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-muted">
            <Icon aria-hidden className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 id={`folder-${f.key}`} className="text-[16px] font-semibold">
              {copy.title} <span className="font-normal text-muted">· {f.count} {f.count === 1 ? "file" : "files"}</span>
            </h3>
            <p className="text-[13px] text-muted">{copy.hint}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" multiple accept={copy.accept} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.length && (onFiles(e.target.files), (e.target.value = ""))} />
          <Button size="sm" disabled={busy} leading={<Upload aria-hidden className="size-4" />} onClick={() => input.current?.click()}>
            Upload
          </Button>
          <ImportMenu importer={importer} destinations={destinations} defaultDestination={`folder:${f.id}`} />
        </div>
      </div>
      {f.items.length > 0 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {f.items.map((m) => (
            <li key={m.id} className="aspect-square overflow-hidden rounded-xl bg-soft">
              <GalleryThumb item={m} alt={m.name} />
            </li>
          ))}
          {f.count > f.items.length && (
            <li className="flex aspect-square items-center justify-center rounded-xl bg-soft text-[13px] font-semibold text-muted">+{f.count - f.items.length}</li>
          )}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">Empty for now.</p>
      )}
      <Link href={`/dashboard/gallery?folder=folder:${f.id}`} className="self-start text-[13px] font-medium text-muted underline">
        Open “{f.name}” in Photos
      </Link>
    </section>
  );
}

/** The documents worth adding, ticked on this device only (a reminder, not a rule). */
function SuggestedDocuments({ campaignId }: { campaignId: string }) {
  const key = `bp-wizard-docs:${campaignId}`;
  const raw = useSyncExternalStore(subscribeDocs, () => readStored(key), () => "[]");
  const ticked = useMemo(() => {
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [raw]);
  const flip = (d: string) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(ticked.includes(d) ? ticked.filter((x) => x !== d) : [...ticked, d]));
      window.dispatchEvent(new Event(DOCS_EVENT));
    } catch {}
  };
  return (
    <Question label="Good to add (optional)" hint="Creators make better posts with these. Tick what you added." id="q-docs">
      <ul className="grid gap-1 sm:grid-cols-2">
        {SUGGESTED_DOCUMENTS.map((d) => (
          <li key={d}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-[14px] hover:bg-soft">
              <input type="checkbox" className="size-5 accent-[var(--color-pulse-blue)]" checked={ticked.includes(d)} onChange={() => flip(d)} />
              {d}
            </label>
          </li>
        ))}
      </ul>
    </Question>
  );
}
