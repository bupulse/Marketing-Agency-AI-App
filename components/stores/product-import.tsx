"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ImageIcon, Search } from "lucide-react";
import { Badge, Button, GlassCard, Input } from "@/components/ui";
import { importChunkAction, listProductsAction, type ListedProduct } from "@/app/dashboard/stores/actions";
import type { ProductResult } from "@/lib/stores/sync";
import { IMPORT_ALL_CAP, IMPORT_CHUNK } from "@/lib/stores/types";

const FIELD_LABEL: Record<string, string> = { title: "name", price: "price", features: "features", description: "description", photos: "photos" };

/** The "Products from your store" picker: thumbnails, checkboxes, import with progress. */
export function ProductImport({ provider, storeName }: { provider: string; storeName: string }) {
  const [products, setProducts] = useState<ListedProduct[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ProductResult[] | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const latest = useRef(0);

  const load = useCallback(
    (nextCursor: string | null, query: string, append: boolean) => {
      const request = ++latest.current;
      startTransition(async () => {
        const res = await listProductsAction(provider, { cursor: nextCursor, search: query });
        if (request !== latest.current) return; // a newer search or page was asked for meanwhile
        setLoaded(true);
        if (!res.ok) return setError(res.error);
        setError(null);
        setProducts((prev) => (append ? [...prev, ...res.products.filter((p) => !prev.some((q) => q.externalId === p.externalId))] : res.products));
        setCursor(res.nextCursor);
      });
    },
    [provider],
  );

  useEffect(() => load(null, "", false), [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const run = async (ids: string[]) => {
    if (busy.current || ids.length === 0) return;
    busy.current = true;
    setResults(null);
    setError(null);
    const all: ProductResult[] = [];
    setProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += IMPORT_CHUNK) {
      const chunk = ids.slice(i, i + IMPORT_CHUNK);
      const res = await importChunkAction(provider, chunk);
      if (!res.ok) {
        setError(res.error);
        break;
      }
      all.push(...res.results);
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    setResults(all);
    setProgress(null);
    setSelected(new Set());
    setProducts((prev) => prev.map((p) => (all.some((r) => r.externalId === p.externalId && r.status !== "failed" && r.status !== "missing") ? { ...p, imported: true } : p)));
    busy.current = false;
  };

  /** Collects up to the cap of products (following the store's pages), then imports them. */
  const importAll = async () => {
    setError(null);
    const ids = products.map((p) => p.externalId);
    let next = cursor;
    while (next && ids.length < IMPORT_ALL_CAP) {
      const res = await listProductsAction(provider, { cursor: next, search });
      if (!res.ok) return setError(res.error);
      for (const p of res.products) if (!ids.includes(p.externalId)) ids.push(p.externalId);
      next = res.nextCursor;
    }
    await run(ids.slice(0, IMPORT_ALL_CAP));
  };

  const importing = progress !== null;
  const summary = results && {
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    failed: results.filter((r) => r.status === "failed" || r.status === "missing"),
    kept: results.filter((r) => r.kept?.length),
    skippedPhotos: results.reduce((n, r) => n + (r.skippedPhotos ?? 0), 0),
  };

  return (
    <section aria-label={`Products from ${storeName}`} className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSelected(new Set());
          load(null, search, false);
        }}
      >
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your products" aria-label="Search your products" className="flex-1" maxLength={80} />
        <Button type="submit" variant="ghost" aria-label="Search" leading={<Search aria-hidden className="size-[18px]" />} disabled={pending || importing}>
          <span className="hidden sm:inline">Search</span>
        </Button>
      </form>

      {error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">{error}</p>}

      {progress && (
        <GlassCard padding="sm" className="flex flex-col gap-2" role="status" aria-live="polite">
          <p className="text-[14px] font-semibold">Importing {progress.done} of {progress.total}…</p>
          <div className="h-2 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="text-[13px] text-muted">Copying photos can take a moment. Keep this page open.</p>
        </GlassCard>
      )}

      {summary && (
        <GlassCard padding="sm" className="flex flex-col gap-2" role="status">
          <p className="text-[15px] font-semibold">
            {[summary.created > 0 && `${summary.created} imported`, summary.updated > 0 && `${summary.updated} updated`, summary.unchanged > 0 && `${summary.unchanged} already up to date`].filter(Boolean).join(", ") || "Nothing was imported"}
          </p>
          {summary.kept.length > 0 && (
            <p className="text-[13px] text-muted">
              Kept your own edits on {summary.kept.length} {summary.kept.length === 1 ? "product" : "products"} ({[...new Set(summary.kept.flatMap((r) => r.kept ?? []))].map((f) => FIELD_LABEL[f] ?? f).join(", ")}).
            </p>
          )}
          {summary.skippedPhotos > 0 && (
            <p className="text-[13px] text-danger">
              Gallery full: {summary.skippedPhotos} store {summary.skippedPhotos === 1 ? "photo was" : "photos were"} not imported. Delete some photos in your gallery, then sync again.
            </p>
          )}
          {summary.failed.map((r) => (
            <p key={r.externalId} className="text-[13px] text-danger">{r.title}: {r.error}</p>
          ))}
          {summary.created + summary.updated + summary.unchanged > 0 && (
            <Link href="/dashboard/knowledge/products" className="text-[14px] font-semibold text-pulse-blue">View your products</Link>
          )}
        </GlassCard>
      )}

      {!loaded ? (
        <p className="px-1 text-[14px] text-muted" role="status">Loading your products…</p>
      ) : products.length === 0 && !error ? (
        <p className="px-1 text-[14px] text-muted">{search ? "No products match that search." : "No published products found in your store."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.externalId}>
              <label className="glass flex min-h-[72px] cursor-pointer items-center gap-3 rounded-2xl p-3">
                <input type="checkbox" className="size-5 shrink-0 accent-pulse-blue" checked={selected.has(p.externalId)} onChange={() => toggle(p.externalId)} disabled={importing} />
                <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-soft">
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the store's own image host
                    <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                  ) : (
                    <span aria-hidden className="flex size-full items-center justify-center text-muted"><ImageIcon className="size-5" /></span>
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.title}</span>
                  {p.price && <span className="truncate text-[13px] text-muted">{p.price}</span>}
                </span>
                {p.imported && <Badge tone="success" className="shrink-0">Imported</Badge>}
              </label>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <Button variant="ghost" onClick={() => load(cursor, search, true)} disabled={pending || importing} className="self-center">
          {pending ? "Loading…" : "Show more"}
        </Button>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-glass glass-strong p-3">
        <span className="px-1 text-[14px] text-muted">{selected.size === 0 ? "Tick the products to import" : `${selected.size} selected`}</span>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={importAll} disabled={importing || pending || products.length === 0}>
            Import all (up to {IMPORT_ALL_CAP})
          </Button>
          <Button size="sm" onClick={() => run([...selected])} disabled={importing || selected.size === 0}>
            Import selected
          </Button>
        </div>
      </div>
    </section>
  );
}
