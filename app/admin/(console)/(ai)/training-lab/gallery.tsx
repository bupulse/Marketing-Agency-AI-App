"use client";

import { AudioLines, CalendarClock, FileQuestion, Link2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui";
import { cn } from "@/lib/cn";
import { exampleIdFromHash, type GalleryItem, type Thumb } from "@/lib/training-lab/gallery";

/** What a card shows in place of a picture. A video shows its first frame and plays while the pointer is over it. */
function Picture({ thumb, title }: { thumb: Thumb; title: string }) {
  const icon = "size-10 text-muted";
  switch (thumb.type) {
    case "image":
      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
      return <img src={thumb.url} alt="" loading="lazy" className="size-full object-cover" />;
    case "video":
      return (
        <video
          src={`${thumb.url}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={title}
          className="size-full object-cover"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0.1;
          }}
        />
      );
    case "audio":
      return <AudioLines aria-hidden className={icon} />;
    case "habit":
      return <CalendarClock aria-hidden className={icon} />;
    case "link":
      return <Link2 aria-hidden className={icon} />;
    default:
      return <FileQuestion aria-hidden className={icon} />;
  }
}

const Stars = ({ rating }: { rating: number | null }) =>
  rating ? (
    <span aria-label={`${rating} of 5 stars`} className="text-[13px] leading-none tracking-tight text-amber-500">{"★".repeat(rating)}<span className="text-muted/50">{"★".repeat(5 - rating)}</span></span>
  ) : (
    <span className="text-[12px] leading-none text-muted">Not rated</span>
  );

/**
 * The examples as a grid of cards. A card opens a detail view (a sheet) with everything about the example; the anchor
 * "#ex-<id>" (from the health list, the Words tab, the Team page and the editor) opens the same sheet. `details` holds
 * the server-rendered detail of each example (the existing forms and actions), shown for the one that is open.
 */
export function Gallery({ items, details, empty }: { items: GalleryItem[]; details: Record<string, ReactNode>; empty: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const ids = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  // The address decides what is open: on arrival, when it changes, and after an action sends the page back to an example.
  useEffect(() => {
    const sync = () => {
      const id = exampleIdFromHash(window.location.hash);
      if (id && ids.has(id)) setOpenId(id);
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener("hashchange", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", sync);
    };
  }, [ids]);

  function open(id: string, from: HTMLElement | null) {
    opener.current = from;
    setOpenId(id);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#ex-${id}`);
  }
  function close() {
    setOpenId(null);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    opener.current?.focus();
  }

  if (items.length === 0) return <p role="status" className="rounded-2xl bg-soft px-4 py-8 text-center text-[15px] text-muted">{empty}</p>;
  const current = items.find((i) => i.id === openId) ?? null;

  return (
    <>
      <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.id} id={`ex-${item.id}`} className="min-w-0 scroll-mt-24">
            <button type="button" onClick={(e) => open(item.id, e.currentTarget)} className="group flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left transition-shadow hover:shadow-glass focus-visible:outline-2 focus-visible:outline-pulse-violet">
              <span className="relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden bg-soft">
                <Picture thumb={item.thumb} title={item.title} />
                {item.warning && (
                  <span title={item.warning} className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-amber-500 text-white shadow">
                    <TriangleAlert aria-hidden className="size-3.5" />
                    <span className="sr-only">Needs attention: {item.warning}</span>
                  </span>
                )}
                {item.never && <span className="absolute bottom-2 left-2 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white">Never</span>}
              </span>
              <span className="flex min-w-0 flex-col gap-1 p-2.5">
                <span className="line-clamp-2 break-words text-[14px] leading-snug font-semibold">{item.title}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-semibold text-muted">{item.kindLabel}</span>
                  <Stars rating={item.rating} />
                </span>
                {item.used !== null && <span className="text-[12px] text-muted">Used {item.used}×</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <Dialog open onOpenChange={(o) => !o && close()} title={current.title} description={current.kindLabel} className={cn("max-w-3xl")}>
          {details[current.id] ?? null}
        </Dialog>
      )}
    </>
  );
}
