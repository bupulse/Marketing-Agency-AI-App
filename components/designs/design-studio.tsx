"use client";

/**
 * <DesignStudio> shows the business's designs: every picture BuPulse made (the image engine's AI ads, the owner's photos
 * used in posts, and older template designs), grouped by day, to save, edit in Canva or delete. Pictures are made by
 * "Unique AI ads" (components/designs/unique-ads.tsx); templates are no more (owner decision, 23 October 2026).
 *
 * Props:
 *   designs      Existing designs: { id, url, kind, aspectRatio, template, createdAt? }[] (lib/designs/service.ts listDesigns).
 *   galleryTop, galleryBottom  Shown above and below the gallery (the date filter and the page links).
 *   timeZone     The business's time zone, for the day headings.
 *   canva        Show "Edit in Canva" (isCanvaEnabled() and the plan's canva feature).
 *   showGallery  Show the gallery (default true).
 */

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { EditInCanva } from "./edit-in-canva";
import { deleteDesign, getDesignDownloadUrl } from "@/app/dashboard/designs/actions";
import { groupByDay } from "@/lib/designs/list";

export type StudioDesign = {
  id: string;
  url: string;
  kind: string;
  aspectRatio: string;
  template: string | null;
  /** ISO time it was made; when given, the gallery groups designs by day. */
  createdAt?: string;
};

export type DesignStudioProps = {
  designs: StudioDesign[];
  showGallery?: boolean;
  /** Shown above and below the gallery, e.g. the date filter and the page links on the Designs page. */
  galleryTop?: ReactNode;
  galleryBottom?: ReactNode;
  /** The business's time zone, for the gallery's day headings. */
  timeZone?: string;
  /** Pass `isCanvaEnabled()` (and the plan's canva feature) from the server page to show "Edit in Canva" on designs. */
  canva?: boolean;
};

const CanvaEnabled = createContext(false);

function DownloadButton({ id, size = "md", label = "Download" }: { id: string; size?: "sm" | "md"; label?: string }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await getDesignDownloadUrl(id);
          if (res.ok) window.location.assign(res.url);
          else toast(res.error, "error");
        })
      }
    >
      <Download aria-hidden className="size-4" />
      {pending ? "Preparing…" : label}
    </Button>
  );
}

function Gallery({ designs, timeZone = "UTC" }: { designs: StudioDesign[]; timeZone?: string }) {
  const canva = useContext(CanvaEnabled);
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (designs.length === 0) return <p className="px-1 text-sm text-muted">Your designs will appear here.</p>;

  function remove(id: string) {
    start(async () => {
      const res = await deleteDesign(id);
      setConfirming(null);
      if (res.ok) router.refresh();
      else toast(res.error ?? "Could not delete", "error");
    });
  }

  const groups = designs.every((d) => d.createdAt) ? groupByDay(designs as (StudioDesign & { createdAt: string })[], new Date(), timeZone) : [{ day: "", label: "", items: designs }];

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.day || "all"} aria-label={g.label || undefined} className="flex flex-col gap-3">
          {g.label && <h3 className="px-1 text-[14px] font-semibold text-muted">{g.label}</h3>}
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {g.items.map((d) => (
        <li key={d.id} className="flex flex-col gap-2">
          {/* The whole design, whatever its shape: fitted inside the square tile, never cut. */}
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-line bg-soft">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
            <img
              src={d.url}
              alt={`${d.kind === "AI" ? "AI picture" : "Picture"}, ${d.aspectRatio}`}
              loading="lazy"
              className="absolute inset-0 size-full object-contain"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <DownloadButton id={d.id} size="sm" label="Save" />
              <EditInCanva designId={d.id} enabled={canva} />
            </div>
            {confirming === d.id ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => remove(d.id)}>
                Delete?
              </Button>
            ) : (
              <Button size="sm" variant="ghost" aria-label="Delete design" onClick={() => setConfirming(d.id)}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
        </section>
      ))}
    </div>
  );
}

export function DesignStudio({ designs, showGallery = true, galleryTop, galleryBottom, timeZone, canva = false }: DesignStudioProps) {
  if (!showGallery) return null;
  return (
    <CanvaEnabled value={canva}>
      <section aria-label="Your designs" className="flex flex-col gap-4">
        <h2 className="px-1 text-lg font-semibold">Your designs</h2>
        {galleryTop}
        <Gallery designs={designs} timeZone={timeZone} />
        {galleryBottom}
      </section>
    </CanvaEnabled>
  );
}
