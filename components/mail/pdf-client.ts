// Browser-only helpers for the attachment viewer: one shared copy of each file's bytes (cards and the viewer use the
// same download) and pdf.js, loaded only when a PDF is shown. The pdf.js worker file is bundled with the app (served
// from our own domain, never a CDN). The legacy build also runs on older phones' browsers.
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfLib = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let lib: Promise<PdfLib> | null = null;

export function pdfjs(): Promise<PdfLib> {
  lib ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  }).catch((e) => {
    lib = null;
    throw e;
  });
  return lib;
}

// The last few files fetched, so opening a card's preview does not download the file again.
const KEEP = 6;
const bytes = new Map<string, Promise<ArrayBuffer>>();

export function fileBytes(url: string): Promise<ArrayBuffer> {
  const hit = bytes.get(url);
  if (hit) {
    bytes.delete(url);
    bytes.set(url, hit);
    return hit;
  }
  const p = fetch(url, { credentials: "same-origin" }).then((r) => {
    if (!r.ok) throw new Error(r.status === 404 ? "This file is no longer there." : "The file could not be loaded.");
    return r.arrayBuffer();
  });
  p.catch(() => bytes.delete(url));
  bytes.set(url, p);
  while (bytes.size > KEEP) bytes.delete(bytes.keys().next().value!);
  return p;
}

/** Opens a PDF from our attachment route. Scripts inside PDFs never run (pdf.js has no scripting here). */
export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const [m, buf] = await Promise.all([pdfjs(), fileBytes(url)]);
  // pdf.js hands the bytes to its worker (the buffer is moved, not copied), so it gets its own copy.
  return m.getDocument({ data: new Uint8Array(buf.slice(0)), enableXfa: false, stopAtErrors: false }).promise;
}

// Card pictures: page 1 drawn small, kept for the session.
const thumbs = new Map<string, Promise<{ src: string; pages: number }>>();

export function pdfThumb(url: string, width: number): Promise<{ src: string; pages: number }> {
  const key = `${url}#${width}`;
  let p = thumbs.get(key);
  if (!p) {
    p = (async () => {
      const doc = await openPdf(url);
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width * Math.min(2, window.devicePixelRatio || 1)) / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: "#ffffff" }).promise;
        return { src: canvas.toDataURL("image/jpeg", 0.82), pages: doc.numPages };
      } finally {
        void doc.loadingTask.destroy();
      }
    })();
    p.catch(() => thumbs.delete(key));
    thumbs.set(key, p);
  }
  return p;
}
