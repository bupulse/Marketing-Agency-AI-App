"use client";

// An email's files: the cards under the message (picture of the first page, hover Preview / Download, Download all as
// one ZIP) and the full-screen viewer (pages, zoom, fit, rotate, find, print, details, a strip to switch files, arrow
// keys and Esc). Design: the "BuPulse Mail design" artifact, Attachments and Viewers screens (docs/mail-crm/GAPS.md B5,
// B6, B7, B9). Every preview is drawn in the browser (file-previews.tsx); B Mail does not virus-scan files, so the
// cards only say what is true: previews open inside B Mail with links and scripts off.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Download, ExternalLink, Eye, FileArchive, Forward, Info, Lock, Minus, Music, Play, Plus, Printer, RotateCw, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { badgeColor, badgeOf, extOf, fileKind, fileSizeLabel, inlineContentType, KIND_LABEL, type FileKind } from "@/lib/mail/attachment-kinds";
import { CsvPreview, DocxPreview, ImagePreview, MediaPreview, NotYet, PdfPreview, SheetPreview, SPEEDS, TextPreview, ZipPreview, type FileItem, type PreviewProps } from "./file-previews";
import { pdfThumb } from "./pdf-client";
import type { ViewAttachment } from "./thread-view";

export type MessageInfo = { id: string; fromName: string; fromAddress: string; dateLong: string };

const toItem = (a: ViewAttachment): FileItem => {
  const url = `/api/mail/attachments/${a.id}`;
  return { id: a.id, filename: a.filename, contentType: a.contentType, size: a.size, url, downloadUrl: `${url}?download=1`, openUrl: inlineContentType(a.filename, a.contentType) ? url : null };
};

// ---------------------------------------------------------------------------------------------------------------
// Cards

export function AttachmentCards({ files, message, onForward }: { files: ViewAttachment[]; message: MessageInfo; onForward?: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  const items = files.map(toItem);
  return (
    <div className="flex flex-col gap-2.5 border-t border-black/[0.08] pt-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <strong className="mr-1 text-[14px]">{files.length} attachment{files.length === 1 ? "" : "s"}</strong>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#e9f7ef] px-2.5 text-[12.5px] font-semibold text-[#146c3c] dark:bg-[#34c759]/15 dark:text-[#b6f5c6]" title="Previews are drawn inside B Mail with links and scripts in the file turned off. Files are not virus-scanned.">
          <Lock className="size-3.5" />Opens safely inside BuPulse
        </span>
        <span className="flex-1" />
        {files.length > 1 && (
          <a href={`/api/mail/attachments/zip?message=${encodeURIComponent(message.id)}`} className="inline-flex h-[34px] items-center gap-2 rounded-full px-3 text-[13.5px] font-medium hover:bg-black/[0.06] dark:hover:bg-white/10"><Download className="size-4" />Download all (ZIP)</a>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {items.map((a, i) => {
          const kind = fileKind(a.filename, a.contentType);
          const color = badgeColor(a.filename, kind);
          const n = pages[a.id];
          return (
            <div key={a.id} className="group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(60,60,67,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(60,60,67,0.12),0_14px_28px_-16px_rgba(15,23,42,0.5)] dark:bg-[#26262c]">
              <button type="button" onClick={() => setOpen(i)} aria-label={`Preview ${a.filename}`} className="relative flex h-[132px] cursor-pointer items-start justify-center overflow-hidden bg-[#eef0f4] dark:bg-white/5">
                <CardPicture item={a} kind={kind} color={color} onPages={(p) => setPages((s) => (s[a.id] === p ? s : { ...s, [a.id]: p }))} />
              </button>
              <span className="pointer-events-none absolute inset-x-0 top-0 flex h-[132px] items-end justify-center gap-2 bg-gradient-to-b from-transparent from-30% to-[rgba(15,15,20,0.55)] pb-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:bg-none [@media(hover:none)]:opacity-100">
                <button type="button" onClick={() => setOpen(i)} aria-label={`Preview ${a.filename}`} title="Preview" className="pointer-events-auto inline-flex size-10 cursor-pointer items-center justify-center rounded-xl bg-white/[0.92] text-[#1d1d1f] shadow-[0_6px_16px_-8px_rgba(0,0,0,0.45)] hover:bg-white [@media(hover:none)]:hidden"><Eye className="size-[18px]" /></button>
                <a href={a.downloadUrl} aria-label={`Download ${a.filename}`} title="Download" className="pointer-events-auto inline-flex size-10 items-center justify-center rounded-xl bg-white/[0.92] text-[#1d1d1f] shadow-[0_6px_16px_-8px_rgba(0,0,0,0.45)] hover:bg-white [@media(hover:none)]:ml-auto [@media(hover:none)]:mr-2 [@media(hover:none)]:size-9"><Download className="size-[18px]" /></a>
              </span>
              <div className="flex items-center gap-2 border-t border-black/[0.06] px-3 py-2.5 dark:border-white/10">
                <span className="inline-flex h-[22px] min-w-[38px] items-center justify-center rounded-md px-1.5 text-[10px] font-extrabold text-white" style={{ background: color }}>{badgeOf(a.filename)}</span>
                <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[13px] font-semibold">{a.filename}</span><span className="text-[11.5px] text-muted">{KIND_LABEL[kind]} · {n ? `${n} page${n === 1 ? "" : "s"} · ` : ""}{fileSizeLabel(a.size)}</span></span>
              </div>
            </div>
          );
        })}
      </div>
      {open !== null && <AttachmentViewer items={items} start={open} message={message} onClose={() => setOpen(null)} onForward={onForward ? () => { setOpen(null); onForward(); } : undefined} />}
    </div>
  );
}

const PDF_THUMB_MAX = 15 * 1024 * 1024;

function CardPicture({ item, kind, color, onPages }: { item: FileItem; kind: FileKind; color: string; onPages: (n: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const report = useRef(onPages);
  useEffect(() => {
    report.current = onPages;
  });
  useEffect(() => {
    const el = ref.current;
    if (kind !== "pdf" || item.size > PDF_THUMB_MAX || !el) return;
    let live = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      pdfThumb(item.url, 180).then(
        (t) => {
          if (!live) return;
          setThumb(t.src);
          report.current(t.pages);
        },
        () => undefined,
      );
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [item.url, item.size, kind]);

  if (kind === "image" && !bad) {
    // eslint-disable-next-line @next/next/no-img-element -- our own attachment route
    return <img src={item.url} alt="" loading="lazy" onError={() => setBad(true)} className="h-full w-full object-cover" />;
  }
  if (kind === "video" || kind === "audio" || kind === "zip") {
    const Icon = kind === "video" ? Play : kind === "audio" ? Music : FileArchive;
    return <span className="flex h-full w-full items-center justify-center" style={{ background: kind === "video" ? "#1c1c22" : `${color}1f` }}><span className="inline-flex size-12 items-center justify-center rounded-full text-white" style={{ background: kind === "video" ? "rgba(255,255,255,0.22)" : color }}><Icon className={cn("size-6", kind === "video" && "fill-white")} /></span></span>;
  }
  const table = kind === "sheet" || kind === "csv";
  return (
    <span ref={ref} className="mt-4 flex w-[72%] flex-col overflow-hidden rounded-[3px] bg-white shadow-[0_6px_16px_-8px_rgba(0,0,0,0.3)]">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- page 1, drawn here from the PDF
        <img src={thumb} alt="" className="block w-full" />
      ) : (
        <span className="flex min-h-[130px] flex-col gap-1.5 px-3 py-3.5">
          <span className="h-1.5 w-[55%] rounded" style={{ background: color }} />
          {table && <span className="mt-1 grid grid-cols-2 border border-[#c9ccd3]">{Array.from({ length: 6 }, (_, i) => <span key={i} className={cn("h-[9px] border-[#c9ccd3]", i % 2 === 0 && "border-r", i < 4 && "border-b")} />)}</span>}
          {[92, 84, 96, 70, 88].map((w) => <span key={w} className="h-[3px] rounded bg-[#d4d6dc]" style={{ width: `${w}%` }} />)}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Viewer

type Controls = { shown?: boolean; modes?: string[]; zoom?: boolean; rotate?: boolean; find?: boolean; print?: boolean; paged?: boolean; engine: string };
const CONTROLS: Record<FileKind, Controls> = {
  pdf: { shown: true, modes: ["Fit width", "Fit page"], zoom: true, rotate: true, find: true, print: true, paged: true, engine: "pdf.js, in your browser" },
  image: { shown: true, modes: ["Fit", "Actual size"], zoom: true, rotate: true, print: true, engine: "Your browser" },
  video: { shown: true, modes: SPEEDS.map((s) => `${s}×`), engine: "Your browser" },
  audio: { shown: true, modes: SPEEDS.map((s) => `${s}×`), engine: "Your browser" },
  text: { shown: true, modes: ["Wrap", "No wrap"], zoom: true, find: true, print: true, engine: "B Mail, in your browser" },
  csv: { shown: true, modes: ["Table", "Text"], zoom: true, find: true, print: true, engine: "B Mail, in your browser" },
  sheet: { shown: true, zoom: true, find: true, engine: "SheetJS, in your browser" },
  docx: { shown: true, zoom: true, print: true, engine: "mammoth, in your browser" },
  zip: { shown: true, engine: "B Mail, in your browser" },
  model: { engine: "Office PC, later" },
  slides: { engine: "Office PC, later" },
  oldword: { engine: "Office PC, later" },
  blender: { engine: "Office PC, later" },
  other: { engine: "Not shown" },
};
const TYPE_NAME: Record<FileKind, string> = {
  pdf: "PDF document", image: "Photo", video: "Video", audio: "Audio", text: "Text or code", csv: "CSV table", sheet: "Excel sheet", docx: "Word document",
  zip: "ZIP archive", model: "3D model", slides: "PowerPoint", oldword: "Word document (older)", blender: "Blender scene", other: "File",
};
const ZOOMS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

type View = { mode: number; zoom: number | null; rotation: number; page: number; pages: number; shownZoom: number };
const FRESH: View = { mode: 0, zoom: null, rotation: 0, page: 1, pages: 0, shownZoom: 100 };

function Preview(props: PreviewProps) {
  switch (props.kind) {
    case "pdf": return <PdfPreview {...props} />;
    case "image": return <ImagePreview {...props} />;
    case "video": case "audio": return <MediaPreview {...props} />;
    case "text": return <TextPreview {...props} />;
    case "csv": return <CsvPreview {...props} />;
    case "sheet": return <SheetPreview {...props} />;
    case "docx": return <DocxPreview {...props} />;
    case "zip": return <ZipPreview {...props} />;
    default: return <div className="flex h-full w-full overflow-auto p-5"><NotYet item={props.item} kind={props.kind} /></div>;
  }
}

export function AttachmentViewer({ items, start, message, onClose, onForward }: { items: FileItem[]; start: number; message: MessageInfo; onClose: () => void; onForward?: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(0, start), items.length - 1));
  const [inner, setInner] = useState<FileItem | null>(null);
  const [view, setView] = useState<View>(FRESH);
  const [details, setDetails] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1280);
  const [find, setFind] = useState<{ open: boolean; query: string; index: number; count: number }>({ open: false, query: "", index: 0, count: 0 });
  const printFn = useRef<(() => void) | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const findBox = useRef<HTMLInputElement>(null);

  const cur = inner ?? items[index];
  const kind = fileKind(cur.filename, cur.contentType);
  const c = CONTROLS[kind];

  const leaveInner = useCallback(() => {
    setInner((x) => {
      if (x) URL.revokeObjectURL(x.url);
      return null;
    });
  }, []);
  const go = useCallback((i: number) => {
    leaveInner();
    setIndex((i + items.length) % items.length);
    setView(FRESH);
    setFind((f) => ({ ...f, index: 0, count: 0 }));
  }, [items.length, leaveInner]);
  const openInner = useCallback((it: FileItem) => {
    setInner(it);
    setView(FRESH);
    setFind((f) => ({ ...f, index: 0, count: 0 }));
  }, []);
  const zoomBy = useCallback((dir: 1 | -1) => setView((v) => {
    const z = v.shownZoom;
    const next = dir > 0 ? ZOOMS.find((s) => s > z + 0.5) ?? ZOOMS.at(-1)! : [...ZOOMS].reverse().find((s) => s < z - 0.5) ?? ZOOMS[0];
    return { ...v, zoom: next };
  }), []);
  const setPage = useCallback((n: number) => setView((v) => ({ ...v, page: Math.min(Math.max(1, n), v.pages || 1) })), []);
  const stepFind = useCallback((dir: 1 | -1) => setFind((f) => (f.count ? { ...f, index: (f.index + dir + f.count) % f.count } : f)), []);

  // Keyboard: ← → files, PageUp / PageDown pages, + − zoom, Ctrl/⌘ F find, Esc closes (find first). Keys are kept from
  // the mail page underneath (its own shortcuts) while the viewer is open.
  const state = useRef({ c, find, index, inner: !!inner });
  useEffect(() => {
    state.current = { c, find, index, inner: !!inner };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest?.("input, textarea, select, [contenteditable=true]");
      const media = t?.tagName === "VIDEO" || t?.tagName === "AUDIO";
      const done = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Escape") {
        done();
        if (s.find.open) setFind((f) => ({ ...f, open: false, query: "" }));
        else if (s.inner) leaveInner();
        else onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && s.c.find) {
        done();
        setFind((f) => ({ ...f, open: true }));
        setTimeout(() => findBox.current?.select(), 0);
        return;
      }
      if (typing) return;
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && !media && items.length > 1) { done(); go(s.index - 1); }
      else if (e.key === "ArrowRight" && !media && items.length > 1) { done(); go(s.index + 1); }
      else if ((e.key === "PageDown" || e.key === "PageUp") && s.c.paged) { done(); setView((v) => ({ ...v, page: Math.min(Math.max(1, v.page + (e.key === "PageDown" ? 1 : -1)), v.pages || 1) })); }
      else if ((e.key === "+" || e.key === "=") && s.c.zoom) { done(); zoomBy(1); }
      else if ((e.key === "-" || e.key === "_") && s.c.zoom) { done(); zoomBy(-1); }
      else if (e.key === "0" && s.c.zoom) { done(); setView((v) => ({ ...v, zoom: null })); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, items.length, leaveInner, onClose, zoomBy]);

  // While open: the page behind does not scroll, focus starts on Close and goes back where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.querySelector<HTMLElement>("[data-close]")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);
  // A file opened from inside a ZIP lives as a blob: link until the viewer closes.
  const innerUrl = useRef<string | null>(null);
  useEffect(() => {
    innerUrl.current = inner?.url ?? null;
  }, [inner]);
  useEffect(() => () => {
    if (innerUrl.current) URL.revokeObjectURL(innerUrl.current);
  }, []);

  const setPrint = useCallback((fn: (() => void) | null) => {
    printFn.current = fn;
  }, []);
  const onPages = useCallback((n: number) => setView((v) => (v.pages === n ? v : { ...v, pages: n })), []);
  const onZoom = useCallback((z: number) => setView((v) => (v.shownZoom === z ? v : { ...v, shownZoom: z })), []);
  const onFind = useCallback((n: number) => setFind((f) => (f.count === n ? f : { ...f, count: n, index: Math.min(f.index, Math.max(0, n - 1)) })), []);

  const meta = `${KIND_LABEL[kind]} · ${view.pages ? `${view.pages} page${view.pages === 1 ? "" : "s"} · ` : ""}${fileSizeLabel(cur.size)}`;
  const color = badgeColor(cur.filename, kind);
  const vb = "inline-flex h-9 min-w-9 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] px-2 text-[13px] font-semibold text-[#f2f2f7] transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[#6ea0ff] disabled:cursor-default disabled:opacity-40";
  const sep = <span aria-hidden className="mx-1 h-5 w-px bg-white/[0.18]" />;
  const showGroup = c.paged || c.zoom || (c.modes?.length ?? 0) > 0;

  const viewer = (
    <div ref={root} role="dialog" aria-modal="true" aria-label={cur.filename} className="fixed inset-0 z-[60] flex flex-col bg-[rgba(52,52,58,0.97)] font-[Inter,-apple-system,'SF_Pro_Text',system-ui,sans-serif] text-[#f2f2f7] backdrop-blur-xl">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3.5">
        {inner ? (
          <button type="button" onClick={leaveInner} className={cn(vb, "pr-3")} aria-label={`Back to ${items[index].filename}`}><ChevronLeft className="size-[18px]" />Back</button>
        ) : (
          <button type="button" data-close onClick={onClose} className={vb} aria-label="Close preview (Esc)" title="Close (Esc)"><X className="size-[18px]" /></button>
        )}
        <span className="inline-flex h-7 min-w-[46px] shrink-0 items-center justify-center rounded-md px-1.5 text-[10.5px] font-extrabold tracking-[0.03em] text-white" style={{ background: color }}>{badgeOf(cur.filename)}</span>
        <span className="mr-3 flex min-w-0 max-w-[min(420px,60vw)] flex-col">
          <span className="truncate text-[15px] font-semibold" title={cur.filename}>{cur.filename}</span>
          <span className="truncate text-[12.5px] text-[#c7c7cc]">{inner ? `Inside ${items[index].filename} · ` : ""}{meta}</span>
        </span>
        <span className="flex-1" />
        {showGroup && (
          <span className="inline-flex items-center gap-0.5 rounded-xl bg-white/[0.08] p-[3px] max-lg:order-last max-lg:mx-auto">
            {c.paged && (
              <>
                <button type="button" className={vb} aria-label="Previous page" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}><ChevronLeft className="size-4" /></button>
                <span className="min-w-14 text-center text-[13px] font-semibold tabular-nums">{view.page} / {view.pages || 1}</span>
                <button type="button" className={vb} aria-label="Next page" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}><ChevronRight className="size-4" /></button>
                {(c.zoom || c.modes) && sep}
              </>
            )}
            {c.zoom && (
              <>
                <button type="button" className={vb} aria-label="Zoom out (−)" onClick={() => zoomBy(-1)}><Minus className="size-4" /></button>
                <button type="button" className="min-w-12 cursor-pointer text-center text-[13px] font-semibold tabular-nums" title="Back to fit (0)" onClick={() => setView((v) => ({ ...v, zoom: null }))}>{view.shownZoom}%</button>
                <button type="button" className={vb} aria-label="Zoom in (+)" onClick={() => zoomBy(1)}><Plus className="size-4" /></button>
                {c.modes && sep}
              </>
            )}
            {c.modes?.map((m, i) => (
              <button key={m} type="button" aria-pressed={view.mode === i && view.zoom === null} onClick={() => setView((v) => ({ ...v, mode: i, zoom: null }))} className={cn(vb, "px-2.5", view.mode === i && (view.zoom === null || !c.zoom) && "bg-white/[0.18]")}>{m}</button>
            ))}
          </span>
        )}
        <span className="flex-1" />
        {c.rotate && <button type="button" className={vb} aria-label="Rotate" title="Rotate" onClick={() => setView((v) => ({ ...v, rotation: (v.rotation + 90) % 360 }))}><RotateCw className="size-[18px]" /></button>}
        {c.find && <button type="button" className={cn(vb, find.open && "bg-white/[0.18]")} aria-label="Find in file" title="Find (Ctrl F)" aria-pressed={find.open} onClick={() => { setFind((f) => ({ ...f, open: !f.open, query: f.open ? "" : f.query })); setTimeout(() => findBox.current?.focus(), 0); }}><Search className="size-[18px]" /></button>}
        {c.print && <button type="button" className={cn(vb, "max-sm:hidden")} aria-label="Print" title="Print" onClick={() => printFn.current?.()}><Printer className="size-[18px]" /></button>}
        <button type="button" className={cn(vb, details && "bg-white/[0.18]")} aria-label="Details" title="Details" aria-pressed={details} onClick={() => setDetails((d) => !d)}><Info className="size-[18px]" /></button>
        {cur.openUrl && <a href={cur.openUrl} target="_blank" rel="noopener noreferrer" className={cn(vb, "max-sm:hidden")} aria-label="Open in a new tab" title="Open in a new tab"><ExternalLink className="size-[18px]" /></a>}
        <a href={cur.downloadUrl} download={cur.filename} className="ml-1 inline-flex h-[38px] items-center gap-2 rounded-[11px] bg-white px-4 text-[13.5px] font-bold text-[#111114]"><Download className="size-4" /><span className="max-sm:hidden">Download</span></a>
      </div>

      {find.open && c.find && (
        <div className="mx-4 mb-1 flex items-center gap-1 self-end rounded-xl bg-white/[0.1] p-1 pl-3">
          <Search className="size-4 text-[#c7c7cc]" />
          <input
            ref={findBox}
            value={find.query}
            onChange={(e) => setFind((f) => ({ ...f, query: e.target.value, index: 0 }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder={kind === "csv" || kind === "sheet" ? "Find rows" : "Find in file"}
            aria-label="Find in file"
            className="h-8 w-[200px] bg-transparent px-1 text-[14px] text-white outline-none placeholder:text-[#8e8e93]"
          />
          <span className="min-w-14 text-center text-[12.5px] tabular-nums text-[#c7c7cc]">{find.query.trim() ? (find.count ? `${find.index + 1} of ${find.count}` : "None") : ""}</span>
          <button type="button" className={vb} aria-label="Previous match" disabled={!find.count} onClick={() => stepFind(-1)}><ChevronUp className="size-4" /></button>
          <button type="button" className={vb} aria-label="Next match" disabled={!find.count} onClick={() => stepFind(1)}><ChevronDown className="size-4" /></button>
          <button type="button" className={vb} aria-label="Close find" onClick={() => setFind((f) => ({ ...f, open: false, query: "" }))}><X className="size-4" /></button>
        </div>
      )}

      {/* Stage and details */}
      <div className="relative flex min-h-0 flex-1">
        <div className="bmail-pop flex min-w-0 flex-1" key={cur.url}>
          <Preview
            item={cur}
            kind={kind}
            mode={view.mode}
            zoom={view.zoom}
            rotation={view.rotation}
            page={view.page}
            onPage={setPage}
            onPages={onPages}
            onZoom={onZoom}
            query={find.open ? find.query : ""}
            findIndex={find.index}
            onFind={onFind}
            onOpenInner={openInner}
            setPrint={setPrint}
          />
        </div>
        {details && (
          <aside aria-label="File details" className="mb-4 mr-4 mt-2.5 flex w-[280px] shrink-0 flex-col gap-3.5 overflow-y-auto rounded-[18px] bg-white/[0.08] p-5 text-[13.5px] max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:bg-[rgba(44,44,50,0.97)] max-lg:shadow-2xl max-sm:w-[calc(100%-32px)]">
            <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-[#c7c7cc]">Details</span>
            <Row k="Type" v={`${TYPE_NAME[kind]}${extOf(cur.filename) ? ` (.${extOf(cur.filename)})` : ""}`} />
            <Row k="Size" v={fileSizeLabel(cur.size)} />
            {view.pages > 0 && <Row k="Pages" v={String(view.pages)} />}
            <Row k="From" v={message.fromName || message.fromAddress} title={message.fromAddress} />
            <Row k="Received" v={message.dateLong} />
            {inner && <Row k="Inside" v={items[index].filename} />}
            <Row k="Shown by" v={c.engine} />
            {c.shown && (
              <div className="flex gap-2 rounded-xl bg-[#34c759]/[0.16] p-3 leading-[1.45] text-[#d2f7dc]">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <span>Shown inside B Mail. Links and scripts in the file are off, and the file is not sent to any other service. B Mail does not virus-scan files: only open what you expect.</span>
              </div>
            )}
            <span className="mt-1 text-[12px] font-bold uppercase tracking-[0.05em] text-[#c7c7cc]">Do more</span>
            {onForward && !inner && <SideButton onClick={onForward} icon={<Forward className="size-4" />}>Forward the email with its files</SideButton>}
            {cur.openUrl && <SideButton href={cur.openUrl} icon={<ExternalLink className="size-4" />}>Open in a new tab</SideButton>}
            <SideButton href={cur.downloadUrl} download={cur.filename} icon={<Download className="size-4" />}>Download</SideButton>
            {items.length > 1 && !inner && <SideButton href={`/api/mail/attachments/zip?message=${encodeURIComponent(message.id)}`} download="" icon={<FileArchive className="size-4" />}>Download all (ZIP)</SideButton>}
          </aside>
        )}
      </div>

      {/* File strip */}
      <div className="flex items-center gap-1.5 overflow-hidden border-t border-white/10 px-3.5 pb-3.5 pt-2.5">
        <span className="whitespace-nowrap px-1.5 text-[12px] font-semibold text-[#c7c7cc]">{items.length} file{items.length === 1 ? "" : "s"}</span>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {items.map((it, i) => {
            const k = fileKind(it.filename, it.contentType);
            const on = i === index;
            return (
              <button key={it.id} type="button" aria-current={on ? "true" : undefined} onClick={() => go(i)} className={cn("flex h-[46px] shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-xl pl-2 pr-3.5 text-[13.5px] font-medium transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#6ea0ff]", on && "bg-white/[0.16]")}>
                <span className="inline-flex h-[22px] min-w-10 items-center justify-center rounded-md px-1.5 text-[10.5px] font-extrabold text-white" style={{ background: badgeColor(it.filename, k) }}>{badgeOf(it.filename)}</span>
                <span className="max-w-[220px] truncate">{it.filename}</span>
              </button>
            );
          })}
        </div>
        <span className="whitespace-nowrap pl-2 text-[12px] text-[#aeaeb2] max-md:hidden">← → files{c.zoom ? " · + − zoom" : ""}{c.paged ? " · PgUp PgDn pages" : ""} · Esc close</span>
      </div>
    </div>
  );
  return createPortal(viewer, document.body);
}

function Row({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <span className="flex justify-between gap-3">
      <span className="shrink-0 text-[#c7c7cc]">{k}</span>
      <span className="min-w-0 truncate text-right" title={title ?? v}>{v}</span>
    </span>
  );
}

function SideButton({ children, icon, onClick, href, download }: { children: ReactNode; icon: ReactNode; onClick?: () => void; href?: string; download?: string }) {
  const cls = "inline-flex h-[42px] cursor-pointer items-center gap-2.5 rounded-[10px] bg-white/[0.07] px-3 text-[13px] font-semibold text-[#f2f2f7] hover:bg-white/[0.12]";
  if (href) return <a href={href} download={download} target={download === undefined ? "_blank" : undefined} rel="noopener noreferrer" className={cls}>{icon}{children}</a>;
  return <button type="button" onClick={onClick} className={cls}>{icon}{children}</button>;
}
