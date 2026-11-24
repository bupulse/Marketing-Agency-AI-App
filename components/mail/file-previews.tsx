"use client";

// One preview per kind of file, shown inside the attachment viewer (attachment-viewer.tsx). Everything is drawn in the
// browser from our own attachment route: PDFs with pdf.js, Excel with SheetJS, Word with mammoth (each loaded only
// when such a file is opened), the rest with the browser itself. Nothing is sent to another service. Links and scripts
// inside files never run: PDFs are drawn as pictures, Word files are cleaned and shown in a locked frame, code and
// HTML are shown as text.
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { Box, Download, FileArchive, Loader2, Music } from "lucide-react";
import { cn } from "@/lib/cn";
import { badgeColor, badgeOf, columnName, decodeText, fileKind, fileSizeLabel, inlineContentType, parseDelimited, tokenizeCode, type FileKind, type Token } from "@/lib/mail/attachment-kinds";
import { readZipDirectory, zipEntryData, type ZipEntry } from "@/lib/mail/zip";
import { fileBytes, openPdf } from "./pdf-client";

export type FileItem = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** Where the bytes are read from (our route, or a blob: link for a file inside a ZIP). */
  url: string;
  downloadUrl: string;
  /** Opens in a new tab only when the browser can show it safely (lib/mail/attachment-kinds.ts inlineContentType). */
  openUrl: string | null;
};

export type PreviewProps = {
  item: FileItem;
  kind: FileKind;
  mode: number;
  /** Chosen zoom in percent, or null for the mode's fit. */
  zoom: number | null;
  rotation: number;
  page: number;
  onPage: (n: number) => void;
  onPages: (n: number) => void;
  /** The zoom actually shown, for the "87%" in the top bar. */
  onZoom: (pct: number) => void;
  query: string;
  findIndex: number;
  onFind: (count: number) => void;
  onOpenInner: (item: FileItem) => void;
  setPrint: (fn: (() => void) | null) => void;
};

const MAX_ROWS = 500;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 5000;
const CSS_UNITS = 96 / 72;

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "The file could not be shown.");

/** Loads something once per key; a new key starts again (components are keyed by file, so this is the first run). */
function useLoaded<T>(key: string, load: () => Promise<T>): { value?: T; error?: string } {
  const [s, setS] = useState<{ key: string; value?: T; error?: string }>({ key });
  const run = useEffectEvent(load);
  useEffect(() => {
    let live = true;
    run().then((value) => live && setS({ key, value }), (e) => live && setS({ key, error: message(e) }));
    return () => {
      live = false;
    };
  }, [key]);
  return s.key === key ? s : {};
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

/** Tells the viewer about something after each change (page counts, zoom, matches) without re-running on every render. */
function useReport<T>(value: T | undefined, report: (v: T) => void) {
  const send = useEffectEvent(report);
  useEffect(() => {
    if (value !== undefined) send(value);
  }, [value]);
}

export function Loading({ label = "Opening…" }: { label?: string }) {
  return (
    <div className="m-auto flex items-center gap-3 text-[14px] text-white/80" role="status">
      <Loader2 className="size-5 animate-spin" />
      {label}
    </div>
  );
}

function Problem({ item, text }: { item: FileItem; text: string }) {
  return (
    <InfoCard item={item} title="This file could not be shown" icon={<Box className="size-7" />}>
      {text} You can still download it.
    </InfoCard>
  );
}

function InfoCard({ item, title, icon, children }: { item: FileItem; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="m-auto flex w-full max-w-[460px] flex-col items-center gap-4 rounded-[22px] bg-white/[0.08] px-8 py-9 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl text-white" style={{ background: badgeColor(item.filename, fileKind(item.filename, item.contentType)) }}>{icon}</span>
      <h2 className="text-[19px] font-semibold">{title}</h2>
      <p className="text-[14px] leading-[1.6] text-white/75">{children}</p>
      <a href={item.downloadUrl} download={item.filename} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-[14px] font-bold text-[#111114]"><Download className="size-4" />Download {fileSizeLabel(item.size)}</a>
    </div>
  );
}

/** Office slides, old Word files, Blender scenes, 3D models and anything else the browser cannot show yet. */
export function NotYet({ item, kind }: { item: FileItem; kind: FileKind }) {
  if (kind === "model") {
    return (
      <InfoCard item={item} title="3D preview needs the office PC" icon={<Box className="size-7" />}>
        3D models will be shown once the office PC can turn them into previews. Until then, download it and open it in a 3D app.
      </InfoCard>
    );
  }
  const what = kind === "slides" ? "PowerPoint slides" : kind === "oldword" ? "This older Word file" : kind === "blender" ? "This Blender file" : "This kind of file";
  return (
    <InfoCard item={item} title="Preview not available yet" icon={<Box className="size-7" />}>
      {what} cannot be shown inside B Mail yet. Office slides, old Word files and Blender files will be converted on the office PC later. Until then, download it to open it on your computer.
    </InfoCard>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Prints a document we made (cleaned) from a hidden frame that runs no scripts. */
function printDocument(body: string, title: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>body{margin:16px;font:13px/1.5 -apple-system,Inter,system-ui,sans-serif;color:#111}img{max-width:100%;max-height:96vh}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,monospace}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left}</style></head><body>${body}</body></html>`;
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-same-origin allow-modals");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
  f.onload = () => {
    try {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    } finally {
      setTimeout(() => f.remove(), 60_000);
    }
  };
  f.srcdoc = html;
  document.body.appendChild(f);
}

async function printPdf(url: string) {
  const blob = new Blob([await fileBytes(url)], { type: "application/pdf" });
  const link = URL.createObjectURL(blob);
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
  f.onload = () => {
    try {
      f.contentWindow?.focus();
      f.contentWindow?.print();
    } catch {
      window.open(link, "_blank", "noopener");
    }
    setTimeout(() => {
      f.remove();
      URL.revokeObjectURL(link);
    }, 60_000);
  };
  f.src = link;
  document.body.appendChild(f);
}

// ---------------------------------------------------------------------------------------------------------------
// PDF

type Box4 = [number, number, number, number];
type PdfMatch = { page: number; boxes: Box4[] };

/** The text of one page with where each piece sits (for Find). */
async function pageText(doc: PDFDocumentProxy, n: number) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let text = "";
  const parts: { start: number; end: number; t: number[]; width: number; height: number }[] = [];
  for (const it of content.items) {
    if (!("str" in it)) continue;
    const start = text.length;
    text += it.str;
    parts.push({ start, end: text.length, t: it.transform as number[], width: it.width, height: it.height || Math.hypot(it.transform[2], it.transform[3]) });
    if (it.hasEOL) text += " ";
  }
  return { lower: text.toLowerCase(), parts };
}

function matchBoxes(parts: Awaited<ReturnType<typeof pageText>>["parts"], s: number, e: number): Box4[] {
  const out: Box4[] = [];
  for (const p of parts) {
    if (p.end <= s || p.start >= e || p.end === p.start) continue;
    const len = p.end - p.start;
    const a = (Math.max(s, p.start) - p.start) / len;
    const b = (Math.min(e, p.end) - p.start) / len;
    const x = p.t[4], y = p.t[5];
    out.push([x + p.width * a, y - p.height * 0.22, x + p.width * b, y + p.height * 0.9]);
  }
  return out;
}

export function PdfPreview(p: PreviewProps) {
  const loaded = useLoaded(p.item.url, () => openPdf(p.item.url));
  const doc = loaded.value;
  useEffect(() => () => void doc?.loadingTask.destroy(), [doc]);
  useReport(doc?.numPages, p.onPages);
  const [stage, box] = useBox<HTMLDivElement>();
  const holder = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ page: number; vp: PageViewport } | null>(null);
  const [zoomShown, setZoomShown] = useState<number>();
  useReport(zoomShown, p.onZoom);

  // Draw the page into a new canvas and swap it in when done (no flash, no two drawings on one canvas).
  const page = Math.min(Math.max(1, p.page), doc?.numPages ?? 1);
  useEffect(() => {
    if (!doc || !box.w) return;
    let live = true;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const pg = await doc.getPage(page);
      if (!live) return;
      const rotation = (pg.rotate + p.rotation) % 360;
      const base = pg.getViewport({ scale: 1, rotation });
      const fitW = (box.w - 40) / base.width;
      const fitP = Math.min(fitW, (box.h - 40) / base.height);
      const scale = p.zoom != null ? (p.zoom / 100) * CSS_UNITS : Math.max(0.1, p.mode === 1 ? fitP : Math.min(fitW, 2.5 * CSS_UNITS));
      setZoomShown(Math.round((scale / CSS_UNITS) * 100));
      const vp = pg.getViewport({ scale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(16_000_000 / (vp.width * vp.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.cssText = `display:block;width:${Math.floor(vp.width)}px;height:${Math.floor(vp.height)}px`;
      const t = pg.render({ canvas, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0], background: "#ffffff" });
      task = t;
      try {
        await t.promise;
      } catch {
        return; // cancelled by a newer drawing
      }
      if (!live || !holder.current) return;
      holder.current.replaceChildren(canvas);
      setShown({ page, vp });
    })();
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, page, p.zoom, p.mode, p.rotation, box.w, box.h]);

  // Find: every page's text, matches with their place on the page.
  const [matches, setMatches] = useState<PdfMatch[]>([]);
  useReport(matches.length, p.onFind);
  useEffect(() => {
    if (!doc) return;
    const q = p.query.trim().toLowerCase();
    let live = true;
    const t = setTimeout(async () => {
      const found: PdfMatch[] = [];
      if (q) {
        for (let n = 1; n <= doc.numPages && found.length < 2000; n++) {
          const { lower, parts } = await pageText(doc, n).catch(() => ({ lower: "", parts: [] }));
          if (!live) return;
          for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) found.push({ page: n, boxes: matchBoxes(parts, i, i + q.length) });
        }
      }
      if (live) setMatches(found);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [doc, p.query]);
  const goPage = useEffectEvent((n: number) => p.onPage(n));
  useEffect(() => {
    const m = matches[p.findIndex];
    if (m) goPage(m.page);
  }, [matches, p.findIndex]);

  const setPrint = useEffectEvent(p.setPrint);
  useEffect(() => {
    setPrint(() => void printPdf(p.item.url));
    return () => setPrint(null);
  }, [p.item.url]);

  if (loaded.error) return <Problem item={p.item} text={/password/i.test(loaded.error) ? "This PDF is locked with a password." : loaded.error} />;
  const marks = shown ? matches.flatMap((m, i) => (m.page === shown.page ? m.boxes.map((b) => ({ r: [...shown.vp.convertToViewportPoint(b[0], b[1]), ...shown.vp.convertToViewportPoint(b[2], b[3])] as number[], on: i === p.findIndex })) : [])) : [];
  return (
    <div className="flex h-full min-h-0 w-full">
      {doc && doc.numPages > 1 && <PdfThumbs doc={doc} page={page} rotation={p.rotation} onPage={p.onPage} />}
      <div ref={stage} className="flex min-w-0 flex-1 overflow-auto px-5 pb-5 pt-3 [scrollbar-gutter:stable]">
        {!doc && <Loading />}
        <div className={cn("relative m-auto shrink-0 overflow-hidden rounded-md bg-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]", !shown && "invisible")}>
          <div ref={holder} />
          {marks.map(({ r, on }, i) => (
            <span key={i} aria-hidden className={cn("pointer-events-none absolute rounded-[2px] mix-blend-multiply", on ? "bg-[#ff9500]/70" : "bg-[#ffd60a]/60")} style={{ left: Math.min(r[0], r[2]), top: Math.min(r[1], r[3]), width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Thumbnails draw one at a time, only when scrolled into view.
let thumbQueue: Promise<unknown> = Promise.resolve();

function PdfThumbs({ doc, page, rotation, onPage }: { doc: PDFDocumentProxy; page: number; rotation: number; onPage: (n: number) => void }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.scrollIntoView({ block: "nearest" });
  }, [page]);
  return (
    <nav ref={nav} aria-label="Pages" className="flex w-[150px] shrink-0 flex-col items-center gap-3.5 overflow-y-auto py-3 max-md:hidden">
      {Array.from({ length: Math.min(doc.numPages, 500) }, (_, i) => (
        <button key={i} type="button" data-page={i + 1} onClick={() => onPage(i + 1)} aria-label={`Page ${i + 1}`} aria-current={page === i + 1 ? "page" : undefined} className="flex cursor-pointer flex-col items-center gap-1.5 text-[12px] text-[#c7c7cc] focus-visible:outline-2 focus-visible:outline-[#6ea0ff]">
          <PdfThumb doc={doc} n={i + 1} rotation={rotation} on={page === i + 1} />
          {i + 1}
        </button>
      ))}
    </nav>
  );
}

function PdfThumb({ doc, n, rotation, on }: { doc: PDFDocumentProxy; n: number; rotation: number; on: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<{ key: string; url: string } | null>(null);
  const key = `${n}:${rotation}`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      thumbQueue = thumbQueue.then(async () => {
        if (!live) return;
        const pg = await doc.getPage(n);
        const r = (pg.rotate + rotation) % 360;
        const base = pg.getViewport({ scale: 1, rotation: r });
        const vp = pg.getViewport({ scale: 172 / Math.max(base.width, base.height * 0.77), rotation: r });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await pg.render({ canvas, viewport: vp, background: "#ffffff" }).promise;
        if (live) setSrc({ key, url: canvas.toDataURL("image/jpeg", 0.8) });
      }).catch(() => undefined);
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [doc, n, rotation, key]);
  return (
    <span ref={ref} className={cn("flex min-h-[86px] w-[86px] items-center justify-center overflow-hidden rounded-md bg-white transition-shadow", on ? "shadow-[0_0_0_3px_#6ea0ff]" : "shadow-[0_2px_8px_rgba(0,0,0,0.35)]")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- drawn here from the PDF */}
      {src?.key === key ? <img src={src.url} alt="" className="block w-full" /> : <span className="h-[112px] w-full" />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Photos

export function ImagePreview(p: PreviewProps) {
  const [stage, box] = useBox<HTMLDivElement>();
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const turned = p.rotation % 180 !== 0;
  const W = nat ? (turned ? nat.h : nat.w) : 0;
  const H = nat ? (turned ? nat.w : nat.h) : 0;
  const fit = nat && box.w ? Math.min(1, (box.w - 40) / W, (box.h - 40) / H) : 1;
  const scale = p.zoom != null ? p.zoom / 100 : p.mode === 1 ? 1 : Math.max(0.02, fit);
  useReport(nat ? Math.round(scale * 100) : undefined, p.onZoom);
  const setPrint = useEffectEvent(p.setPrint);
  useEffect(() => {
    const src = new URL(p.item.url, window.location.href).toString();
    setPrint(() => printDocument(`<img src="${escapeHtml(src)}" alt="">`, p.item.filename));
    return () => setPrint(null);
  }, [p.item.url, p.item.filename]);
  if (failed) return <Problem item={p.item} text="This browser cannot show this picture." />;
  return (
    <div ref={stage} className="flex h-full w-full overflow-auto p-5">
      {!nat && <Loading />}
      <div className="relative m-auto shrink-0" style={nat ? { width: W * scale, height: H * scale } : { width: 0, height: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- our own attachment route */}
        <img
          src={p.item.url}
          alt={p.item.filename}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          onError={() => setFailed(true)}
          className={cn("absolute left-1/2 top-1/2 max-w-none rounded-md shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)] transition-transform", !nat && "invisible")}
          style={nat ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(-50%, -50%) rotate(${p.rotation}deg)` } : undefined}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Video and audio

export const SPEEDS = [1, 1.5, 2];

export function MediaPreview(p: PreviewProps) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = SPEEDS[p.mode] ?? 1;
  }, [p.mode]);
  if (failed) return <Problem item={p.item} text="This browser cannot play this file." />;
  if (p.kind === "video") {
    return (
      <div className="flex h-full w-full overflow-auto p-5">
        <video ref={ref} src={p.item.url} controls playsInline preload="metadata" onError={() => setFailed(true)} className="m-auto max-h-full max-w-full rounded-xl bg-black shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]" />
      </div>
    );
  }
  return (
    <div className="flex h-full w-full overflow-auto p-5">
      <div className="m-auto flex w-full max-w-[640px] flex-col gap-5 rounded-[20px] bg-white/[0.08] p-7">
        <div className="flex items-center gap-4">
          <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl text-white" style={{ background: badgeColor(p.item.filename, "audio") }}><Music className="size-7" /></span>
          <span className="flex min-w-0 flex-col"><span className="truncate text-[16px] font-semibold">{p.item.filename}</span><span className="text-[12.5px] text-[#c7c7cc]">{fileSizeLabel(p.item.size)}</span></span>
        </div>
        <audio ref={ref} src={p.item.url} controls preload="metadata" onError={() => setFailed(true)} className="w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Text and code

const TOKEN_COLOR: Record<Token["t"], string> = { "": "", c: "text-[#8e8e93]", s: "text-[#b6f5c6]", n: "text-[#ffd28a]", k: "text-[#d4b8ff]", p: "text-[#9dbbff]", g: "text-[#9dbbff]" };

async function loadText(url: string) {
  const all = new Uint8Array(await fileBytes(url));
  const text = decodeText(all.subarray(0, MAX_TEXT_BYTES));
  return { text, cut: all.length > MAX_TEXT_BYTES };
}

function TextLines({ text, filename, wrap, zoom, query, findIndex, onFind, note }: { text: string; filename: string; wrap: boolean; zoom: number; query: string; findIndex: number; onFind: (n: number) => void; note?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { lines, more } = useMemo(() => {
    const all = text.split(/\r?\n/);
    if (all.length > 1 && all.at(-1) === "") all.pop();
    return { lines: all.slice(0, MAX_LINES), more: Math.max(0, all.length - MAX_LINES) };
  }, [text]);
  const q = query.trim().toLowerCase();
  const tokens = useMemo(() => (q || text.length > 400_000 ? null : tokenizeCode(lines.join("\n"), filename)), [q, text.length, lines, filename]);
  const hits = useMemo(() => {
    if (!q) return [];
    const out: { line: number; at: number }[] = [];
    lines.forEach((l, line) => {
      const low = l.toLowerCase();
      for (let at = low.indexOf(q); at >= 0 && out.length < 5000; at = low.indexOf(q, at + q.length)) out.push({ line, at });
    });
    return out;
  }, [q, lines]);
  useReport(hits.length, onFind);
  useEffect(() => {
    box.current?.querySelector(`[data-hit="${findIndex}"]`)?.scrollIntoView({ block: "center" });
  }, [findIndex, hits]);
  const byLine = useMemo(() => {
    const m = new Map<number, { at: number; i: number }[]>();
    hits.forEach((h, i) => m.set(h.line, [...(m.get(h.line) ?? []), { at: h.at, i }]));
    return m;
  }, [hits]);
  const digits = String(lines.length).length;
  return (
    <div ref={box} className="m-auto w-full max-w-[1100px] overflow-hidden rounded-2xl border border-white/10 bg-[#16171d]">
      <pre className={cn("overflow-x-auto py-4 font-mono leading-[1.7] text-[#e5e5ea]", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")} style={{ fontSize: `${(13.5 * zoom) / 100}px` }}>
        {lines.map((l, n) => (
          <div key={n} className="flex">
            <span aria-hidden className="sticky left-0 shrink-0 select-none bg-[#16171d] pl-4 pr-4 text-right text-[#5c5c66]" style={{ width: `calc(${digits}ch + 2rem)` }}>{n + 1}</span>
            <span className="min-w-0 flex-1 pr-5">
              {byLine.has(n)
                ? highlight(l, q.length, byLine.get(n)!, findIndex)
                : tokens
                  ? tokens[n]?.map((t, i) => (t.t ? <span key={i} className={TOKEN_COLOR[t.t]}>{t.v}</span> : t.v))
                  : l}
            </span>
          </div>
        ))}
      </pre>
      {(more > 0 || note) && <p className="border-t border-white/10 px-4 py-2.5 text-[12.5px] text-[#c7c7cc]">{more > 0 ? `Showing the first ${MAX_LINES.toLocaleString("en")} lines. ` : ""}{note}</p>}
    </div>
  );
}

function highlight(line: string, len: number, hits: { at: number; i: number }[], current: number): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.at > last) out.push(line.slice(last, h.at));
    out.push(<mark key={h.i} data-hit={h.i} className={cn("rounded-[2px] text-[#111]", h.i === current ? "bg-[#ff9500]" : "bg-[#ffd60a]")}>{line.slice(h.at, h.at + len)}</mark>);
    last = h.at + len;
  }
  out.push(line.slice(last));
  return out;
}

function useTextPrint(p: PreviewProps, text: string | null | undefined) {
  const setPrint = useEffectEvent(p.setPrint);
  useEffect(() => {
    if (text == null) return;
    setPrint(() => printDocument(`<pre>${escapeHtml(text.slice(0, MAX_TEXT_BYTES))}</pre>`, p.item.filename));
    return () => setPrint(null);
  }, [text, p.item.filename]);
}

export function TextPreview(p: PreviewProps) {
  const loaded = useLoaded(p.item.url, () => loadText(p.item.url));
  useReport(p.zoom ?? 100, p.onZoom);
  useTextPrint(p, loaded.value?.text);
  if (loaded.error) return <Problem item={p.item} text={loaded.error} />;
  if (!loaded.value) return <Loading />;
  if (loaded.value.text === null) return <Problem item={p.item} text="This file is not plain text." />;
  return (
    <div className="flex h-full w-full overflow-auto p-5">
      <TextLines text={loaded.value.text} filename={p.item.filename} wrap={p.mode === 0} zoom={p.zoom ?? 100} query={p.query} findIndex={p.findIndex} onFind={p.onFind} note={loaded.value.cut ? "The file is larger than 2 MB: download it to see all of it." : undefined} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tables: CSV and Excel

function DataTable({ rows, header, letters, total, zoom, query, findIndex, onFind, paper }: { rows: string[][]; header: string[] | null; letters: boolean; total: number; zoom: number; query: string; findIndex: number; onFind: (n: number) => void; paper?: boolean }) {
  const q = query.trim().toLowerCase();
  const width = Math.min(60, Math.max(header?.length ?? 0, ...rows.map((r) => r.length)));
  const shown = useMemo(() => {
    const all = rows.map((r, i) => ({ r, n: i }));
    return q ? all.filter(({ r }) => r.some((c) => c.toLowerCase().includes(q))) : all;
  }, [rows, q]);
  useReport(q ? shown.length : 0, onFind);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector(`[data-hit="${findIndex}"]`)?.scrollIntoView({ block: "center" });
  }, [findIndex, shown]);
  const cols = Array.from({ length: width }, (_, i) => i);
  const cell = paper ? "border-b border-r border-[#e5e7eb] px-3 py-1.5" : "border-b border-white/[0.07] px-3 py-2";
  const head = paper ? "bg-[#f3f4f6] font-semibold text-[#6b7280]" : "bg-[#24252c] font-bold text-[#c7c7cc]";
  const num = paper ? "bg-[#f9fafb] text-[#9ca3af]" : "text-[#8e8e93]";
  return (
    <div ref={box} className={cn("m-auto max-h-full w-fit min-w-[min(100%,560px)] max-w-full overflow-auto rounded-[14px]", paper ? "bg-white text-[#111827] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]" : "border border-white/10 bg-black/[0.18] text-[#e5e5ea]")}>
      <table className="border-separate border-spacing-0 whitespace-nowrap" style={{ fontSize: `${(13 * zoom) / 100}px` }}>
        <thead className="sticky top-0 z-10">
          {letters && (
            <tr>
              <th className={cn(cell, head, "sticky left-0 z-10 w-10")} />
              {cols.map((c) => <th key={c} className={cn(cell, head, "text-center")}>{columnName(c)}</th>)}
            </tr>
          )}
          {header && (
            <tr>
              <th className={cn(cell, head, "sticky left-0 z-10 w-10")} />
              {cols.map((c) => <th key={c} className={cn(cell, head, "max-w-[360px] truncate text-left")}>{header[c] ?? ""}</th>)}
            </tr>
          )}
        </thead>
        <tbody>
          {shown.map(({ r, n }, i) => (
            <tr key={n} data-hit={q ? i : undefined} className={cn(q && i === findIndex && (paper ? "bg-[#fff4d6]" : "bg-white/10"))}>
              <td className={cn(cell, num, "sticky left-0 text-right tabular-nums", !paper && "bg-[#1c1d23]")}>{n + (header ? 2 : 1)}</td>
              {cols.map((c) => <td key={c} className={cn(cell, "max-w-[360px] truncate", /^-?[\d.,\s]+%?$/.test(r[c] ?? "") && "text-right tabular-nums")} title={(r[c] ?? "").length > 40 ? r[c] : undefined}>{r[c] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={cn("sticky left-0 px-3 py-2.5 text-[12.5px]", paper ? "text-[#6b7280]" : "text-[#c7c7cc]")}>
        {q ? `${shown.length} matching row${shown.length === 1 ? "" : "s"} · ` : ""}
        {rows.length < total ? `Rows 1–${rows.length.toLocaleString("en")} of ${total.toLocaleString("en")}: download the file for the rest.` : `${total.toLocaleString("en")} row${total === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

export function CsvPreview(p: PreviewProps) {
  const loaded = useLoaded(p.item.url, () => loadText(p.item.url));
  const text = loaded.value?.text;
  const parsed = useMemo(() => (text ? parseDelimited(text, { maxRows: MAX_ROWS + 1, filename: p.item.filename }) : null), [text, p.item.filename]);
  useReport(p.zoom ?? 100, p.onZoom);
  useTextPrint(p, text);
  if (loaded.error) return <Problem item={p.item} text={loaded.error} />;
  if (!loaded.value) return <Loading />;
  if (text == null) return <Problem item={p.item} text="This file is not a text table." />;
  if (p.mode === 1 || !parsed) {
    return (
      <div className="flex h-full w-full overflow-auto p-5">
        <TextLines text={text} filename={p.item.filename} wrap={false} zoom={p.zoom ?? 100} query={p.query} findIndex={p.findIndex} onFind={p.onFind} />
      </div>
    );
  }
  return (
    <div className="flex h-full w-full overflow-hidden p-5">
      <DataTable rows={parsed.rows.slice(1)} header={parsed.rows[0] ?? []} letters={false} total={Math.max(0, parsed.total - 1)} zoom={p.zoom ?? 100} query={p.query} findIndex={p.findIndex} onFind={p.onFind} />
    </div>
  );
}

export function SheetPreview(p: PreviewProps) {
  const loaded = useLoaded(p.item.url, async () => {
    const [X, buf] = await Promise.all([import("xlsx"), fileBytes(p.item.url)]);
    const wb = X.read(new Uint8Array(buf), { type: "array", sheetRows: MAX_ROWS, dense: true, cellFormula: false, cellHTML: false, cellStyles: false });
    return wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const rows = X.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: true }).map((r) => r.map((c) => String(c ?? "")));
      const ref = (ws["!fullref"] as string | undefined) ?? ws["!ref"];
      return { name, rows, total: ref ? X.utils.decode_range(ref).e.r + 1 : rows.length };
    });
  });
  const [sheet, setSheet] = useState(0);
  useReport(p.zoom ?? 100, p.onZoom);
  if (loaded.error) return <Problem item={p.item} text={/password|encrypt/i.test(loaded.error) ? "This workbook is locked with a password." : loaded.error} />;
  if (!loaded.value) return <Loading />;
  const s = loaded.value[sheet] ?? loaded.value[0];
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-5">
      <div className="flex min-h-0 flex-1">
        {s && s.rows.length > 0 ? (
          <DataTable key={s.name} paper rows={s.rows} header={null} letters total={s.total} zoom={p.zoom ?? 100} query={p.query} findIndex={p.findIndex} onFind={p.onFind} />
        ) : (
          <p className="m-auto text-[14px] text-white/75">This sheet is empty.</p>
        )}
      </div>
      {loaded.value.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="mx-auto flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-white/[0.08] p-1 text-[12.5px]">
          {loaded.value.map((x, i) => (
            <button key={x.name} type="button" role="tab" aria-selected={i === sheet} onClick={() => setSheet(i)} className={cn("cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold", i === sheet ? "bg-white text-[#1f9d55]" : "text-white/75 hover:bg-white/10")}>{x.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Word (.docx)

const DOC_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "SUB", "SUP", "BR", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "IMG", "BLOCKQUOTE", "PRE", "CODE", "SPAN", "DIV", "HR", "CAPTION"]);
const DOC_DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "FRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "NOSCRIPT", "AUDIO", "VIDEO", "SOURCE"]);

/** Keeps only plain document tags; links become text, pictures must be embedded (data:) images. */
function cleanDocHtml(html: string): string {
  const d = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toUpperCase();
      if (DOC_DROP.has(tag)) {
        child.remove();
        continue;
      }
      walk(child);
      if (!DOC_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const a of Array.from(child.attributes)) {
        const keep =
          (tag === "IMG" && a.name === "src" && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(a.value)) ||
          (tag === "IMG" && a.name === "alt") ||
          ((tag === "TD" || tag === "TH") && (a.name === "colspan" || a.name === "rowspan") && /^\d{1,3}$/.test(a.value));
        if (!keep) child.removeAttribute(a.name);
      }
      if (tag === "IMG" && !child.hasAttribute("src")) child.remove();
    }
  };
  walk(d.body);
  return d.body.innerHTML;
}

function docxDocument(body: string, zoom: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
html{zoom:${zoom}}body{margin:0;padding:56px 64px;font:15px/1.7 Georgia,'Source Serif 4',serif;color:#1d1d1f;background:#fff;word-wrap:break-word}
h1,h2,h3{font-family:-apple-system,Inter,system-ui,sans-serif;line-height:1.3}img{max-width:100%;height:auto}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #d1d5db;padding:4px 8px;vertical-align:top}p{margin:0 0 .8em}
</style></head><body>${body}</body></html>`;
}

export function DocxPreview(p: PreviewProps) {
  const loaded = useLoaded(p.item.url, async () => {
    const [m, buf] = await Promise.all([import("mammoth/mammoth.browser.js"), fileBytes(p.item.url)]);
    const mammoth = (m as unknown as { default?: typeof m }).default ?? m;
    const r = await mammoth.convertToHtml({ arrayBuffer: buf.slice(0) });
    return cleanDocHtml(r.value);
  });
  const z = (p.zoom ?? 100) / 100;
  useReport(p.zoom ?? 100, p.onZoom);
  const html = loaded.value;
  const doc = useMemo(() => (html == null ? "" : docxDocument(html || "<p><em>This document is empty.</em></p>", z)), [html, z]);
  const setPrint = useEffectEvent(p.setPrint);
  useEffect(() => {
    if (html == null) return;
    setPrint(() => printDocument(html, p.item.filename));
    return () => setPrint(null);
  }, [html, p.item.filename]);
  if (loaded.error) return <Problem item={p.item} text="This Word file could not be read." />;
  if (html == null) return <Loading />;
  return (
    <div className="flex h-full w-full overflow-auto px-5 pb-5 pt-3">
      {/* A locked frame: no scripts, no links, no forms, nothing loaded from outside. */}
      <iframe title={p.item.filename} sandbox="" srcDoc={doc} className="mx-auto h-full min-h-[480px] shrink-0 rounded-md bg-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]" style={{ width: `min(100%, ${Math.round(816 * z)}px)` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// ZIP archives

async function entryBytes(all: Uint8Array, e: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  const raw = zipEntryData(all, e);
  if (e.method === 0) return raw.slice();
  const out = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function ZipPreview(p: PreviewProps) {
  const loaded = useLoaded(p.item.url, async () => {
    const all = new Uint8Array(await fileBytes(p.item.url));
    return { all, entries: readZipDirectory(all).filter((e) => !e.dir && !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(e.name)) };
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (loaded.error) return <Problem item={p.item} text={/not a ZIP/.test(loaded.error) ? "This file is not a ZIP archive, or it is damaged." : loaded.error} />;
  if (!loaded.value) return <Loading />;
  const { all, entries } = loaded.value;
  const total = entries.reduce((n, e) => n + e.size, 0);
  const open = async (e: ZipEntry) => {
    setBusy(e.name);
    setProblem(null);
    try {
      const filename = e.name.split("/").pop() || e.name;
      const inline = inlineContentType(filename, "");
      const bytes = await entryBytes(all, e);
      const url = URL.createObjectURL(new Blob([bytes], { type: inline ?? "application/octet-stream" }));
      p.onOpenInner({ id: `zip:${e.name}`, filename, contentType: inline ?? "application/octet-stream", size: e.size, url, downloadUrl: url, openUrl: inline ? url : null });
    } catch {
      setProblem(`${e.name} could not be opened.`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex h-full w-full overflow-auto p-5">
      <div className="m-auto w-full max-w-[720px] rounded-2xl border border-white/10 bg-black/[0.18] p-1.5">
        <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-[#c7c7cc]"><FileArchive className="size-4" />{entries.length} file{entries.length === 1 ? "" : "s"} inside · {fileSizeLabel(total)} unpacked</p>
        {problem && <p className="mx-3 mb-2 rounded-lg bg-[#ff453a]/15 px-3 py-2 text-[13px] text-[#ffb4ae]">{problem}</p>}
        {entries.slice(0, 2000).map((e) => {
          const filename = e.name.split("/").pop() || e.name;
          const kind = fileKind(filename, "");
          const can = !e.encrypted && (e.method === 0 || e.method === 8) && e.size <= 50 * 1024 * 1024 && typeof DecompressionStream !== "undefined";
          return (
            <div key={e.name} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.05]">
              <span className="inline-flex h-[22px] min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 text-[10.5px] font-extrabold text-white" style={{ background: badgeColor(filename, kind) }}>{badgeOf(filename)}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]" title={e.name}>{e.name}</span>
              <span className="shrink-0 text-[12.5px] text-[#c7c7cc]">{e.encrypted ? "Locked" : fileSizeLabel(e.size)}</span>
              {can && (
                <button type="button" disabled={busy !== null} onClick={() => void open(e)} className="inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] bg-white/[0.08] px-3 text-[13px] font-semibold hover:bg-white/[0.14] disabled:opacity-50">
                  {busy === e.name && <Loader2 className="size-3.5 animate-spin" />}Preview
                </button>
              )}
            </div>
          );
        })}
        {entries.length > 2000 && <p className="px-3 py-2 text-[12.5px] text-[#c7c7cc]">And {entries.length - 2000} more.</p>}
      </div>
    </div>
  );
}
