"use client";

/**
 * <MediaPicker> is a dialog for choosing photos from the business's gallery, with folder and album tabs,
 * search by name and "Upload new" inline (new photos land in the open folder or album and are selected; from
 * "All photos" the person picks where they go first).
 *
 * Props:
 *   open           Whether the dialog is shown (controlled).
 *   onOpenChange   Called with false when the person closes it.
 *   onPick         Called once with the chosen photos, then the dialog closes:
 *                    { id, path, url, width, height, mimeType }[]  (`id` is the gallery photo's id)
 *                  `path` is the object path in the private "media" bucket (<userId>/gallery/<id>.<ext>),
 *                  `url` a signed display URL that expires after about an hour. Store the `path`.
 *                  On the server, verify paths with assetsByPaths(businessId, paths) from lib/media/service.
 *   multiple       Allow choosing several photos (default false: one click picks the photo and closes).
 *   max            The most photos that can be chosen when `multiple` (default 10).
 *   title          Dialog title (default "Choose from my gallery" / "Choose photos").
 *   confirmLabel   Button text in multiple mode; gets the count (default "Use N photos").
 *   initialFolder  The tab to open on: "all" (default), or an album such as "product:<id>" (a product's page and
 *                  the posts and designs made for it start in its album).
 *
 * The "Import" menu (Google Drive, Dropbox, Canva) is built in: imported photos land in the open folder and are selected.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Search, Upload } from "lucide-react";
import { Dialog } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getGalleryOverview, listGalleryPage } from "@/app/dashboard/gallery/actions";
import { MEDIA_TYPES } from "@/lib/media/rules";
import type { GalleryOverview, MediaItem } from "@/lib/media/service";
import { destinationKey, destinationOptions, parseFilter, uploadDestinationFor } from "@/lib/media/destinations";
import { DestinationDialog } from "./destination-dialog";
import { ImportMenu } from "./import-menu";
import { UploadProgress } from "./upload-progress";
import { useGalleryUpload } from "./use-gallery-upload";
import { useImporter } from "./use-importer";

export type PickedPhoto = { id: string; path: string; url: string; width: number | null; height: number | null; mimeType: string };

export type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (photos: PickedPhoto[]) => void;
  multiple?: boolean;
  max?: number;
  title?: string;
  confirmLabel?: (count: number) => string;
  initialFolder?: string;
};

type Folder = "all" | "none" | string;

export const toPicked = (m: Pick<MediaItem, "id" | "path" | "url" | "width" | "height" | "mimeType">): PickedPhoto => ({ id: m.id, path: m.path, url: m.url, width: m.width, height: m.height, mimeType: m.mimeType });

export function MediaPicker({ open, onOpenChange, onPick, multiple = false, max = 10, title, confirmLabel, initialFolder }: MediaPickerProps) {
  // Google's Picker cannot show above a modal <dialog>, so while it is open this dialog steps aside (its state stays).
  const [aside, setAside] = useState(false);
  const asideRef = useRef(false);
  const stepAside = useCallback((on: boolean) => {
    asideRef.current = on;
    setAside(on);
  }, []);
  return (
    <Dialog
      open={open && !aside}
      onOpenChange={(next) => {
        if (!next && asideRef.current) return;
        onOpenChange(next);
      }}
      title={title ?? (multiple ? "Choose photos" : "Choose from my gallery")}
      className="max-w-3xl"
    >
      {/* Mounted only while open, so every opening starts on "All photos" with nothing selected. */}
      {open && <PickerBody onOpenChange={onOpenChange} onPick={onPick} multiple={multiple} max={max} confirmLabel={confirmLabel} initialFolder={initialFolder} onPickerVisible={stepAside} />}
    </Dialog>
  );
}

type Page = { key: string; items: MediaItem[]; cursor: string | null; error: string | null };

function PickerBody({ onOpenChange, onPick, multiple, max, confirmLabel, initialFolder, onPickerVisible }: Pick<MediaPickerProps, "onOpenChange" | "onPick" | "confirmLabel" | "initialFolder"> & { multiple: boolean; max: number; onPickerVisible: (visible: boolean) => void }) {
  const [overview, setOverview] = useState<Pick<GalleryOverview, "folders" | "albums">>({ folders: [], albums: [] });
  const folders = overview.folders;
  const [folder, setFolder] = useState<Folder>(initialFolder ?? "all");
  const [asking, setAsking] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<MediaItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const viewDestination = uploadDestinationFor(parseFilter(folder));
  const uploadDestination = viewDestination ? destinationKey(viewDestination) : null;
  const destinations = destinationOptions(overview);
  const key = `${folder}|${query}`;
  const loading = page?.key !== key;
  // While another folder or search loads, the previous photos stay (dimmed) instead of flashing empty.
  const items = page?.items ?? [];
  const cursor = loading ? null : (page?.cursor ?? null);
  const error = loading ? null : (page?.error ?? null);
  const first = page === null;

  const loadOverview = useCallback(async () => {
    const res = await getGalleryOverview();
    if (res.ok) setOverview(res.overview);
  }, []);

  const added = useCallback(
    (uploaded: MediaItem[]) => {
      setPage((p) => (p ? { ...p, items: [...[...uploaded].reverse(), ...p.items.filter((c) => !uploaded.some((u) => u.id === c.id))] } : p));
      setSelected((cur) => (multiple ? [...cur, ...uploaded].slice(0, max) : cur));
      void loadOverview();
    },
    [loadOverview, max, multiple],
  );
  const uploader = useGalleryUpload(added);
  const importer = useImporter(added);

  useEffect(() => {
    void getGalleryOverview().then((res) => res.ok && setOverview(res.overview));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    void listGalleryPage({ folder, search: query }).then((res) => {
      if (!live) return;
      setPage(res.ok ? { key, items: res.items, cursor: res.nextCursor, error: null } : { key, items: [], cursor: null, error: res.error });
    });
    return () => {
      live = false;
    };
  }, [folder, query, key]);

  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await listGalleryPage({ folder, search: query, cursor });
    setLoadingMore(false);
    setPage((p) => {
      if (!p || p.key !== key) return p;
      if (!res.ok) return { ...p, error: res.error };
      return { ...p, items: [...p.items, ...res.items.filter((i) => !p.items.some((c) => c.id === i.id))], cursor: res.nextCursor };
    });
  }

  function choose(item: MediaItem) {
    if (!multiple) {
      onPick([toPicked(item)]);
      onOpenChange(false);
      return;
    }
    setSelected((cur) => (cur.some((c) => c.id === item.id) ? cur.filter((c) => c.id !== item.id) : cur.length < max ? [...cur, item] : cur));
  }

  function confirm() {
    onPick(selected.map(toPicked));
    onOpenChange(false);
  }

  const tabs: { value: Folder; label: string }[] = [
    { value: "all", label: "All photos" },
    { value: "none", label: "Not in a folder" },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
    ...overview.albums.map((a) => ({ value: `${a.kind}:${a.id}`, label: a.name })),
  ];
  const filtering = query.trim() !== "";

  return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-48">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name"
              aria-label="Search photos by name"
              className="min-h-11 w-full rounded-full border border-line bg-transparent pr-4 pl-10 text-[15px] outline-none focus:border-pulse-blue"
            />
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={MEDIA_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const to = target ?? uploadDestination;
              if (e.target.files && to) void uploader.start(e.target.files, to);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploader.state.active}
            onClick={() => {
              if (uploadDestination) {
                setTarget(null);
                inputRef.current?.click();
              } else setAsking(true);
            }}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold hover:bg-soft disabled:opacity-50"
          >
            <Upload aria-hidden className="size-4" />
            Upload new
          </button>
          <ImportMenu importer={importer} destinations={destinations} defaultDestination={uploadDestination} onPickerVisible={onPickerVisible} />
        </div>
        <DestinationDialog
          open={asking}
          onOpenChange={setAsking}
          destinations={destinations}
          onPick={(key) => {
            setAsking(false);
            setTarget(key);
            void loadOverview();
            inputRef.current?.click();
          }}
        />

        <div role="tablist" aria-label="Folders and albums" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              type="button"
              aria-selected={folder === t.value}
              onClick={() => setFolder(t.value)}
              className={cn(
                "min-h-10 shrink-0 cursor-pointer rounded-full px-4 text-sm font-semibold transition-colors duration-300",
                folder === t.value ? "bg-brand-gradient text-white" : "border border-line hover:bg-soft",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <UploadProgress state={uploader.state} onDismiss={uploader.dismiss} />
        <UploadProgress state={importer.state} onDismiss={importer.dismiss} verb="Importing" />

        <div className="min-h-56">
          {error ? (
            <p role="alert" className="py-10 text-center text-sm font-medium text-danger">
              {error}
            </p>
          ) : items.length === 0 && !loading && !first ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ImagePlus aria-hidden className="size-8 text-muted" />
              <p className="font-medium">{filtering ? "No photos match that name" : "No photos here yet"}</p>
              {!filtering && <p className="text-sm text-muted">Use “Upload new” to add some.</p>}
            </div>
          ) : (
            <ul className={cn("grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto p-1 transition-opacity duration-300 sm:grid-cols-4", loading && "pointer-events-none opacity-50")}>
              {items.map((item) => {
                const on = selected.some((s) => s.id === item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={multiple ? on : undefined}
                      aria-label={item.name}
                      onClick={() => choose(item)}
                      className={cn(
                        "relative block aspect-square w-full cursor-pointer overflow-hidden rounded-xl bg-soft ring-2 transition-[box-shadow,transform] duration-300 hover:scale-[1.02] motion-reduce:hover:scale-100",
                        on ? "ring-pulse-blue" : "ring-transparent",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
                      <img src={item.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                      {on && (
                        <span className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-pulse-blue text-white">
                          <Check aria-hidden className="size-4" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {cursor && (
                <li className="col-span-full flex justify-center py-2">
                  <button type="button" onClick={more} disabled={loadingMore} className="min-h-11 cursor-pointer rounded-full border border-line px-5 text-sm font-semibold hover:bg-soft disabled:opacity-50">
                    Show more
                  </button>
                </li>
              )}
            </ul>
          )}
          {first && (
            <div role="status" className="flex justify-center py-12">
              <LoaderCircle aria-hidden className="size-6 animate-spin text-muted motion-reduce:animate-none" />
              <span className="sr-only">Loading photos</span>
            </div>
          )}
        </div>

        {multiple && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-sm text-muted">{selected.length === 0 ? `Pick up to ${max}` : `${selected.length} selected`}</span>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={confirm}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-[28px] bg-brand-gradient px-6 text-sm font-semibold text-white shadow-glow disabled:pointer-events-none disabled:opacity-50"
            >
              {confirmLabel ? confirmLabel(selected.length) : `Use ${selected.length || ""} photo${selected.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
  );
}
