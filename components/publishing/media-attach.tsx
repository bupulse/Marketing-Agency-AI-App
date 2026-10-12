"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Images, LoaderCircle, Palette, Upload, X } from "lucide-react";
import { Dialog } from "@/components/ui";
import { MediaPicker } from "@/components/media/media-picker";
import { DestinationDialog } from "@/components/media/destination-dialog";
import { getGalleryOverview } from "@/app/dashboard/gallery/actions";
import { destinationOptions, type DestinationOption } from "@/lib/media/destinations";
import { UploadProgress } from "@/components/media/upload-progress";
import { useGalleryUpload } from "@/components/media/use-gallery-upload";
import { listDesignsAction, type DesignChoice } from "@/app/dashboard/calendar/actions";
import { MEDIA_TYPES } from "@/lib/media/rules";
import { cn } from "@/lib/cn";
import type { MediaItem } from "@/lib/publishing/types";

const pill =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-glass px-4 text-sm font-semibold text-text transition-colors hover:bg-soft disabled:pointer-events-none disabled:opacity-50";

function DesignList({ onOpenChange, onPick, max }: { onOpenChange: (o: boolean) => void; onPick: (items: MediaItem[]) => void; max: number }) {
  const [designs, setDesigns] = useState<DesignChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void listDesignsAction().then((res) => {
      if (!live) return;
      if (res.ok) setDesigns(res.designs);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < max ? [...cur, id] : cur));
  }

  function confirm() {
    const chosen = (designs ?? []).filter((d) => selected.includes(d.id));
    onPick(chosen.map((d) => ({ path: d.path, url: d.url, mimeType: "image/png" })));
    onOpenChange(false);
  }

  return (
    <>
      {error ? (
        <p role="alert" className="text-danger">{error}</p>
      ) : designs === null ? (
        <p className="flex items-center gap-2 py-8 text-muted"><LoaderCircle aria-hidden className="size-4 animate-spin" /> Loading your designs</p>
      ) : designs.length === 0 ? (
        <p className="rounded-2xl bg-soft px-4 py-8 text-center text-[15px] text-muted">No designs yet. Make one in Designs and it shows up here.</p>
      ) : (
        <>
          <ul className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {designs.map((d) => {
              const on = selected.includes(d.id);
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => toggle(d.id)} aria-pressed={on} className={cn("relative block w-full cursor-pointer overflow-hidden rounded-2xl border-2 bg-soft", on ? "border-pulse-blue" : "border-transparent")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.url} alt={`Design ${d.aspectRatio}`} loading="lazy" className="aspect-square w-full object-cover" />
                    {on && <span className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-pulse-blue text-white"><Check aria-hidden className="size-4" /></span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={selected.length === 0} onClick={confirm} className={cn(pill, "bg-brand-gradient text-white")}>
              {selected.length === 0 ? "Choose a design" : `Use ${selected.length} ${selected.length === 1 ? "design" : "designs"}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function DesignPicker({ open, onOpenChange, onPick, max }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (items: MediaItem[]) => void; max: number }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Choose from my designs" description="Branded images you made in Designs." className="max-w-3xl">
      {open && <DesignList onOpenChange={onOpenChange} onPick={onPick} max={max} />}
    </Dialog>
  );
}

/** Photos on a post: from the Gallery, from Designs, or uploaded from the computer (straight into the Gallery). */
export function MediaAttach({ media, onChange, max, album }: { media: MediaItem[]; onChange: (media: MediaItem[]) => void; max: number; /** "product:<id>" / "campaign:<id>": the post's album, where uploads go and the gallery opens. */ album?: string }) {
  const [gallery, setGallery] = useState(false);
  const [asking, setAsking] = useState(false);
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [designs, setDesigns] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(media);
  useEffect(() => {
    latest.current = media;
  });

  const add = (items: MediaItem[]) => {
    const have = new Set(latest.current.map((m) => m.path));
    onChange([...latest.current, ...items.filter((i) => !have.has(i.path))].slice(0, max));
  };
  const uploader = useGalleryUpload((items) => add(items.map((i) => ({ path: i.path, url: i.url, mimeType: i.mimeType }))));
  const room = max - media.length;

  return (
    <div className="flex flex-col gap-3">
      {media.length > 0 && (
        <ul aria-label="Attached photos" className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <li key={m.path} className="relative size-20 overflow-hidden rounded-xl bg-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(media.filter((x) => x.path !== m.path))} className="absolute top-1 right-1 inline-flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/65 text-white">
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={pill} disabled={room <= 0} onClick={() => setGallery(true)}>
          <Images aria-hidden className="size-4" /> Gallery
        </button>
        <button type="button" className={pill} disabled={room <= 0} onClick={() => setDesigns(true)}>
          <Palette aria-hidden className="size-4" /> Designs
        </button>
        <button
          type="button"
          className={pill}
          disabled={room <= 0 || uploader.state.active}
          onClick={() => {
            if (album) {
              setTarget(album);
              input.current?.click();
              return;
            }
            // Every upload goes somewhere: a folder or an album (lib/media/destinations.ts).
            void getGalleryOverview().then((res) => res.ok && setDestinations(destinationOptions(res.overview)));
            setAsking(true);
          }}
        >
          <Upload aria-hidden className="size-4" /> Upload
        </button>
        <input ref={input} type="file" multiple accept={MEDIA_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-label="Upload photos" onChange={(e) => {
          if (e.target.files && target) void uploader.start(Array.from(e.target.files).slice(0, room), target);
          e.target.value = "";
        }} />
      </div>
      <UploadProgress state={uploader.state} onDismiss={uploader.dismiss} />
      <DestinationDialog
        open={asking}
        onOpenChange={setAsking}
        destinations={destinations}
        onPick={(key) => {
          setAsking(false);
          setTarget(key);
          input.current?.click();
        }}
      />
      <MediaPicker open={gallery} onOpenChange={setGallery} initialFolder={album} multiple max={Math.max(room, 1)} onPick={(photos) => add(photos.map((p) => ({ path: p.path, url: p.url, mimeType: p.mimeType })))} />
      <DesignPicker open={designs} onOpenChange={setDesigns} max={Math.max(room, 1)} onPick={add} />
    </div>
  );
}
