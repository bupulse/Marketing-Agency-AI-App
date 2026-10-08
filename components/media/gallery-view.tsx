"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FolderInput, FolderPlus, ImagePlus, Pencil, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button, Dialog, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { createFolder, deleteAssets, deleteFolder, listGalleryPage, moveAssets, renameAsset, renameFolder } from "@/app/dashboard/gallery/actions";
import { formatBytes, MEDIA_MAX_ASSETS, MEDIA_MAX_TOTAL_BYTES, MEDIA_TYPES } from "@/lib/media/rules";
import type { GalleryOverview, MediaItem } from "@/lib/media/service";
import { ImportMenu } from "./import-menu";
import { UploadProgress } from "./upload-progress";
import { useGalleryUpload } from "./use-gallery-upload";
import { useImporter } from "./use-importer";

type Dialogs =
  | null
  | { kind: "newFolder" }
  | { kind: "renameFolder" }
  | { kind: "deleteFolder" }
  | { kind: "move"; ids: string[] }
  | { kind: "deletePhotos"; ids: string[] };

const HOME = "/dashboard/gallery";

/** The Gallery screen: folder chips, photo grid, upload, multi-select and the photo viewer. `folder` is "all", "none" or a folder id. */
export function GalleryView({ folder, overview, initialItems, initialCursor }: { folder: string; overview: GalleryOverview; initialItems: MediaItem[]; initialCursor: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [extra, setExtra] = useState<MediaItem[]>([]);
  // Photos uploaded in this session show at once, ahead of the server refresh that follows.
  const [fresh, setFresh] = useState<MediaItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [dragging, setDragging] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = overview.folders.find((f) => f.id === folder);
  const uploadFolder = current?.id ?? null;
  const known = new Set(initialItems.map((i) => i.id));
  const items = [...fresh.filter((f) => !known.has(f.id)), ...initialItems, ...extra.filter((e) => !known.has(e.id))].filter((i) => !gone.has(i.id));
  const viewed = items.find((i) => i.id === viewing) ?? null;
  const count = folder === "all" ? overview.total : folder === "none" ? overview.unfiled : (current?.count ?? 0);
  const selecting = selected.size > 0;

  const added = (uploaded: MediaItem[]) => {
    setFresh((cur) => [...[...uploaded].reverse(), ...cur]);
    router.refresh();
  };
  const uploader = useGalleryUpload(added);
  const importer = useImporter(added);

  // After a refresh the first page is new; drop what was loaded beyond it so nothing shows twice or stale.
  const [seen, setSeen] = useState(initialItems);
  if (seen !== initialItems) {
    setSeen(initialItems);
    setExtra([]);
    setFresh([]);
    setCursor(initialCursor);
  }

  function done(message: string, after?: () => void) {
    toast(message, "success");
    after?.();
    setExtra([]);
    router.refresh();
  }

  function fail(error: string) {
    toast(error, "error");
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await listGalleryPage({ folder, cursor });
    setLoadingMore(false);
    if (!res.ok) return fail(res.error);
    setExtra((cur) => [...cur, ...res.items]);
    setCursor(res.nextCursor);
  }

  function addFiles(list: FileList | File[]) {
    void uploader.start(list, uploadFolder);
  }

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
  };

  function remove(ids: string[]) {
    start(async () => {
      const res = await deleteAssets(ids);
      if (!res.ok) return fail(res.error);
      setGone((cur) => new Set([...cur, ...ids]));
      setSelected(new Set());
      setViewing(null);
      setDialog(null);
      done(`${res.deleted} photo${res.deleted === 1 ? "" : "s"} deleted`);
    });
  }

  function move(ids: string[], target: string | null, label: string) {
    start(async () => {
      const res = await moveAssets(ids, target);
      if (!res.ok) return fail(res.error);
      setSelected(new Set());
      setViewing(null);
      setDialog(null);
      done(`Moved to ${label}`);
    });
  }

  const chips = [
    { href: HOME, label: "All photos", count: overview.total, active: folder === "all" },
    { href: `${HOME}?folder=none`, label: "Not in a folder", count: overview.unfiled, active: folder === "none" },
    ...overview.folders.map((f) => ({ href: `${HOME}?folder=${f.id}`, label: f.name, count: f.count, active: f.id === folder })),
  ];
  const title = current?.name ?? (folder === "none" ? "Not in a folder" : "All photos");

  return (
    <div className="relative flex flex-col gap-5" {...dropProps}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MEDIA_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <nav aria-label="Folders" className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1">
        {chips.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            aria-current={c.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[15px] font-medium whitespace-nowrap transition-[background-color,transform] duration-300 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              c.active ? "bg-brand-gradient text-white" : "glass text-text",
            )}
          >
            {c.label}
            <span className={cn("text-[13px]", c.active ? "text-white/80" : "text-muted")}>{c.count}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setDialog({ kind: "newFolder" })}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-dashed border-line px-4 text-[15px] font-medium text-muted hover:bg-soft hover:text-text"
        >
          <FolderPlus aria-hidden className="size-4" />
          New folder
        </button>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {current && (
            <>
              <button type="button" aria-label="Rename folder" onClick={() => setDialog({ kind: "renameFolder" })} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                <Pencil aria-hidden className="size-4" />
              </button>
              <button type="button" aria-label="Delete folder" onClick={() => setDialog({ kind: "deleteFolder" })} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-danger">
                <Trash2 aria-hidden className="size-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ImportMenu importer={importer} folders={overview.folders} defaultFolderId={uploadFolder} />
          <Button size="sm" leading={<Upload aria-hidden className="size-4" />} disabled={uploader.state.active} onClick={() => inputRef.current?.click()}>
            Upload photos
          </Button>
        </div>
      </div>

      <UploadProgress state={uploader.state} onDismiss={uploader.dismiss} />
      <UploadProgress state={importer.state} onDismiss={importer.dismiss} verb="Importing" />

      {items.length === 0 ? (
        <Empty total={overview.total} folder={folder} onUpload={() => inputRef.current?.click()} />
      ) : (
        <>
          <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", selecting && "pb-24")}>
            {items.map((item, i) => {
              const on = selected.has(item.id);
              return (
                <li key={item.id} className="animate-pop group relative" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <button
                    type="button"
                    onClick={() => (selecting ? toggle(item.id) : setViewing(item.id))}
                    aria-label={selecting ? `${on ? "Deselect" : "Select"} ${item.name}` : `Open ${item.name}`}
                    className={cn(
                      "relative block aspect-square w-full cursor-pointer overflow-hidden rounded-2xl bg-soft ring-2 transition-[box-shadow] duration-300",
                      on ? "ring-pulse-blue" : "ring-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
                    <img src={item.url} alt="" loading="lazy" decoding="async" className={cn("size-full object-cover transition-transform duration-500 ease-out-soft group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100", on && "scale-95")} />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-3 pt-6 pb-2 text-left text-xs font-medium text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100 max-sm:hidden">
                      {item.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`Select ${item.name}`}
                    onClick={() => toggle(item.id)}
                    className={cn(
                      "absolute top-1.5 left-1.5 inline-flex size-9 cursor-pointer items-center justify-center rounded-full transition-opacity duration-300",
                      on ? "opacity-100" : selecting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                    )}
                  >
                    <span className={cn("inline-flex size-6 items-center justify-center rounded-full border-2 transition-colors duration-300", on ? "border-pulse-blue bg-pulse-blue text-white" : "border-white bg-black/30 text-transparent")}>
                      <Check aria-hidden className="size-4" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {cursor && (
            <div className="flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={more}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}

      <p className="px-1 text-[13px] text-muted">
        {overview.total} of {MEDIA_MAX_ASSETS} photos · {formatBytes(overview.usage.bytes)} of {formatBytes(MEDIA_MAX_TOTAL_BYTES)} used
        {count !== overview.total ? ` · ${count} here` : ""}
      </p>

      {dragging && (
        <div aria-hidden className="animate-pop pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-pulse-blue bg-bg/80 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <ImagePlus className="size-6" />
            Drop photos to add them{current ? ` to ${current.name}` : ""}
          </p>
        </div>
      )}

      {selecting && (
        <div role="toolbar" aria-label="Selected photos" className="glass-strong animate-pop fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-3xl p-3 sm:bottom-6">
          <span className="px-2 text-[15px] font-semibold">{selected.size} selected</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" leading={<FolderInput aria-hidden className="size-4" />} onClick={() => setDialog({ kind: "move", ids: [...selected] })}>
            Move
          </Button>
          <Button size="sm" variant="ghost" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => setDialog({ kind: "deletePhotos", ids: [...selected] })}>
            Delete
          </Button>
          <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
            <X aria-hidden className="size-5" />
          </button>
        </div>
      )}

      <Viewer
        item={viewed}
        folders={overview.folders}
        busy={pending}
        onClose={() => setViewing(null)}
        onMove={(id) => setDialog({ kind: "move", ids: [id] })}
        onDelete={(id) => setDialog({ kind: "deletePhotos", ids: [id] })}
        onRenamed={() => done("Name saved")}
        onError={fail}
      />

      <FolderNameDialog
        open={dialog?.kind === "newFolder" || dialog?.kind === "renameFolder"}
        title={dialog?.kind === "renameFolder" ? "Rename folder" : "New folder"}
        action={dialog?.kind === "renameFolder" ? "Save" : "Create folder"}
        initial={dialog?.kind === "renameFolder" ? (current?.name ?? "") : ""}
        placeholder="Summer party"
        busy={pending}
        onClose={() => setDialog(null)}
        onSubmit={(name) =>
          start(async () => {
            if (dialog?.kind === "renameFolder" && current) {
              const res = await renameFolder(current.id, name);
              if (!res.ok) return fail(res.error);
              setDialog(null);
              return done("Folder renamed");
            }
            const res = await createFolder(name);
            if (!res.ok) return fail(res.error);
            setDialog(null);
            toast(`Folder “${res.folder.name}” created`, "success");
            router.push(`${HOME}?folder=${res.folder.id}`);
          })
        }
      />

      <Dialog open={dialog?.kind === "deleteFolder"} onOpenChange={(o) => !o && setDialog(null)} title={`Delete “${current?.name ?? "folder"}”?`} description="The photos in it are not deleted. They move to “Not in a folder”.">
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setDialog(null)}>
            Keep folder
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              current &&
              start(async () => {
                const res = await deleteFolder(current.id);
                if (!res.ok) return fail(res.error);
                setDialog(null);
                toast(res.moved > 0 ? `Folder deleted. ${res.moved} photo${res.moved === 1 ? "" : "s"} kept in “Not in a folder”.` : "Folder deleted", "success");
                router.push(HOME);
              })
            }
          >
            Delete folder
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={dialog?.kind === "deletePhotos"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "deletePhotos" && dialog.ids.length > 1 ? `Delete ${dialog.ids.length} photos?` : "Delete this photo?"}
        description="This removes it from your gallery for good. Designs you already made are not affected."
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" onClick={() => setDialog(null)}>
            Keep
          </Button>
          <Button disabled={pending} onClick={() => dialog?.kind === "deletePhotos" && remove(dialog.ids)}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Dialog>

      <MoveDialog
        ids={dialog?.kind === "move" ? dialog.ids : null}
        folders={overview.folders}
        busy={pending}
        onClose={() => setDialog(null)}
        onMove={move}
        onCreate={(ids, name) =>
          start(async () => {
            const made = await createFolder(name);
            if (!made.ok) return fail(made.error);
            const res = await moveAssets(ids, made.folder.id);
            if (!res.ok) return fail(res.error);
            setSelected(new Set());
            setViewing(null);
            setDialog(null);
            done(`Moved to ${made.folder.name}`);
          })
        }
      />
    </div>
  );
}

function Empty({ total, folder, onUpload }: { total: number; folder: string; onUpload: () => void }) {
  const first = total === 0;
  return (
    <div className="glass animate-pop flex flex-col items-center gap-3 rounded-glass px-6 py-14 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-soft">
        <ImagePlus aria-hidden className="size-7 text-pulse-blue" />
      </span>
      <h3 className="text-lg font-semibold">{first ? "Add your first photos" : folder === "none" ? "Every photo is in a folder" : "This folder is empty"}</h3>
      <p className="max-w-sm text-[15px] text-muted">
        {first ? "Drag photos here, or choose them from your device. They are yours to use in posts and designs, free." : folder === "none" ? "Photos you take out of a folder show up here." : "Drag photos onto this page to add them here."}
      </p>
      {(first || folder !== "none") && (
        <Button leading={<Upload aria-hidden className="size-4" />} onClick={onUpload}>
          Choose photos
        </Button>
      )}
      <p className="text-[13px] text-muted">JPG, PNG or WebP, up to 10 MB each</p>
    </div>
  );
}

function Viewer({
  item,
  folders,
  busy,
  onClose,
  onMove,
  onDelete,
  onRenamed,
  onError,
}: {
  item: MediaItem | null;
  folders: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
  onRenamed: () => void;
  onError: (message: string) => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()} title={item?.name ?? "Photo"} className="max-w-3xl">
      {item && <ViewerBody key={`${item.id}:${item.name}`} item={item} folders={folders} busy={busy} onMove={onMove} onDelete={onDelete} onRenamed={onRenamed} onError={onError} />}
    </Dialog>
  );
}

function ViewerBody({ item, folders, busy, onMove, onDelete, onRenamed, onError }: { item: MediaItem; folders: { id: string; name: string }[]; busy: boolean; onMove: (id: string) => void; onDelete: (id: string) => void; onRenamed: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState(item.name);
  const [saving, start] = useTransition();
  const folder = folders.find((f) => f.id === item.folderId);
  const changed = name.trim() !== "" && name.trim() !== item.name;

  return (
        <div className="flex flex-col gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
          <img src={item.url} alt={item.name} className="max-h-[55vh] w-full rounded-2xl bg-soft object-contain" />
          <p className="text-[13px] text-muted">
            {[item.width && item.height ? `${item.width} × ${item.height}` : null, formatBytes(item.bytes), folder ? `In ${folder.name}` : "Not in a folder"].filter(Boolean).join(" · ")}
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!changed) return;
              start(async () => {
                const res = await renameAsset(item.id, name);
                if (res.ok) onRenamed();
                else onError(res.error);
              });
            }}
          >
            <Input aria-label="Photo name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="ghost" disabled={!changed || saving}>
              Save
            </Button>
          </form>
          <div className="flex flex-wrap gap-3">
            <Button href={`/dashboard/designs?photo=${item.id}`} leading={<Sparkles aria-hidden className="size-4" />}>
              Make a design
            </Button>
            <Button variant="ghost" disabled={busy} leading={<FolderInput aria-hidden className="size-4" />} onClick={() => onMove(item.id)}>
              Move
            </Button>
            <Button variant="outline" disabled={busy} leading={<Trash2 aria-hidden className="size-4" />} onClick={() => onDelete(item.id)}>
              Delete
            </Button>
          </div>
        </div>
  );
}

function FolderNameDialog({ open, title, action, initial, placeholder, busy, onClose, onSubmit }: { open: boolean; title: string; action: string; initial: string; placeholder: string; busy: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      {open && <FolderNameForm initial={initial} action={action} placeholder={placeholder} busy={busy} onClose={onClose} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function FolderNameForm({ initial, action, placeholder, busy, onClose, onSubmit }: { initial: string; action: string; placeholder: string; busy: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name);
      }}
    >
      <Input aria-label="Folder name" autoFocus value={name} maxLength={60} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {action}
        </Button>
      </div>
    </form>
  );
}

function MoveDialog({ ids, folders, busy, onClose, onMove, onCreate }: { ids: string[] | null; folders: { id: string; name: string }[]; busy: boolean; onClose: () => void; onMove: (ids: string[], target: string | null, label: string) => void; onCreate: (ids: string[], name: string) => void }) {
  return (
    <Dialog open={!!ids} onOpenChange={(o) => !o && onClose()} title={ids && ids.length > 1 ? `Move ${ids.length} photos` : "Move photo"} description="Pick a folder.">
      {ids && <MoveBody ids={ids} folders={folders} busy={busy} onMove={onMove} onCreate={onCreate} />}
    </Dialog>
  );
}

function MoveBody({ ids, folders, busy, onMove, onCreate }: { ids: string[]; folders: { id: string; name: string }[]; busy: boolean; onMove: (ids: string[], target: string | null, label: string) => void; onCreate: (ids: string[], name: string) => void }) {
  const [name, setName] = useState("");
  const rowClass = "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 text-left text-[15px] font-medium hover:bg-soft disabled:opacity-50";
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-[40vh] flex-col overflow-y-auto">
        <li>
          <button type="button" disabled={busy} className={rowClass} onClick={() => onMove(ids, null, "Not in a folder")}>
            <ImagePlus aria-hidden className="size-4 text-muted" />
            Not in a folder
          </button>
        </li>
        {folders.map((f) => (
          <li key={f.id}>
            <button type="button" disabled={busy} className={rowClass} onClick={() => onMove(ids, f.id, f.name)}>
              <FolderInput aria-hidden className="size-4 text-muted" />
              {f.name}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(ids, name);
        }}
      >
        <Input aria-label="New folder name" value={name} maxLength={60} placeholder="Or start a new folder" onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="ghost" disabled={busy || !name.trim()}>
          Create
        </Button>
      </form>
    </div>
  );
}
