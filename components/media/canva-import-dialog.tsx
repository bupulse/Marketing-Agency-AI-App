"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Palette, Search } from "lucide-react";
import { Button, buttonClasses, Dialog } from "@/components/ui";
import { cn } from "@/lib/cn";
import { importFromCanva, listFromCanva } from "@/app/dashboard/gallery/import-actions";
import type { CanvaDesignSummary } from "@/lib/canva/client";
import { IMPORT_MAX_FILES } from "@/lib/media/rules";
import type { ImportTask } from "./use-importer";

type Page = { key: string; items: CanvaDesignSummary[]; cursor: string | null; error: string | null; needsConnect: boolean };

/** "Import from Canva": the person's designs with thumbnails, search and paging; the chosen ones are exported as PNGs. */
export function CanvaImportDialog({ open, onOpenChange, destination, onImport }: { open: boolean; onOpenChange: (open: boolean) => void; destination: string; onImport: (tasks: ImportTask[]) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import from Canva" description="Pick the designs to add to your gallery. Each one is saved as a PNG." className="max-w-3xl">
      {open && <Body onOpenChange={onOpenChange} destination={destination} onImport={onImport} />}
    </Dialog>
  );
}

function Body({ onOpenChange, destination, onImport }: { onOpenChange: (open: boolean) => void; destination: string; onImport: (tasks: ImportTask[]) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<CanvaDesignSummary[]>([]);
  const key = query;
  const loading = page?.key !== key;
  const items = page?.items ?? [];

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    void listFromCanva({ query }).then((res) => {
      if (!live) return;
      setPage(res.ok ? { key: query, items: res.items, cursor: res.nextCursor, error: null, needsConnect: false } : { key: query, items: [], cursor: null, error: res.error, needsConnect: !!res.needsConnect });
    });
    return () => {
      live = false;
    };
  }, [query]);

  async function more() {
    if (!page?.cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await listFromCanva({ query, cursor: page.cursor });
    setLoadingMore(false);
    setPage((p) => {
      if (!p || p.key !== key) return p;
      if (!res.ok) return { ...p, error: res.error };
      return { ...p, items: [...p.items, ...res.items.filter((i) => !p.items.some((c) => c.id === i.id))], cursor: res.nextCursor };
    });
  }

  function toggle(design: CanvaDesignSummary) {
    setSelected((cur) => (cur.some((c) => c.id === design.id) ? cur.filter((c) => c.id !== design.id) : cur.length < IMPORT_MAX_FILES ? [...cur, design] : cur));
  }

  function confirm() {
    onImport(selected.map((d) => ({ name: d.title, run: () => importFromCanva({ designId: d.id, title: d.title, destination }) })));
    onOpenChange(false);
  }

  if (page?.needsConnect || (page?.error && items.length === 0 && !loading)) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <Palette aria-hidden className="size-8 text-muted" />
        <p role="alert" className={cn("max-w-sm text-[15px]", page.needsConnect ? "font-medium" : "font-medium text-danger")}>
          {page.error}
        </p>
        {page.needsConnect && (
          // A plain link: the connect route redirects to Canva, which next/link must not prefetch.
          <a href="/api/canva/connect?next=/dashboard/gallery" className={buttonClasses({ size: "sm" })}>
            Connect Canva
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your designs"
          aria-label="Search your Canva designs"
          className="min-h-11 w-full rounded-full border border-line bg-transparent pr-4 pl-10 text-[15px] outline-none focus:border-pulse-blue"
        />
      </div>
      <div className="min-h-56">
        {page === null ? (
          <div role="status" className="flex justify-center py-12">
            <LoaderCircle aria-hidden className="size-6 animate-spin text-muted motion-reduce:animate-none" />
            <span className="sr-only">Loading your designs</span>
          </div>
        ) : items.length === 0 && !loading ? (
          <p className="py-12 text-center text-sm text-muted">{query.trim() ? "No designs match that search." : "You have no Canva designs yet."}</p>
        ) : (
          <ul className={cn("grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto p-1 transition-opacity duration-300 sm:grid-cols-3", loading && "pointer-events-none opacity-50")}>
            {items.map((d) => {
              const on = selected.some((s) => s.id === d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(d)}
                    className={cn("relative block w-full cursor-pointer overflow-hidden rounded-xl bg-soft text-left ring-2 transition-[box-shadow] duration-300", on ? "ring-pulse-blue" : "ring-transparent")}
                  >
                    <span className="block aspect-[4/3] w-full bg-soft">
                      {d.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- Canva thumbnail, expires after about 15 minutes
                        <img src={d.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />
                      )}
                    </span>
                    <span className="block truncate px-3 py-2 text-[13px] font-medium">{d.title}</span>
                    {on && (
                      <span className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-pulse-blue text-white">
                        <Check aria-hidden className="size-4" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {page.cursor && (
              <li className="col-span-full flex justify-center py-2">
                <Button variant="outline" size="sm" disabled={loadingMore} onClick={more}>
                  {loadingMore ? "Loading…" : "Show more"}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
      {page?.error && items.length > 0 && (
        <p role="alert" className="text-sm font-medium text-danger">
          {page.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm text-muted">{selected.length === 0 ? `Pick up to ${IMPORT_MAX_FILES}` : `${selected.length} selected`}</span>
        <Button size="sm" disabled={selected.length === 0} onClick={confirm}>
          Import {selected.length || ""} design{selected.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
