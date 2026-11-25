"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ImageUp, X } from "lucide-react";
import { removeMailPhoto, saveBackgroundPhoto, saveMailPhoto } from "@/app/mail/(app)/actions";
import { MENU_DARK_BELOW } from "@/lib/mail/backgrounds";
import { avatarColor } from "./thread-list";

// Photos in B Mail (design "Welcome" step 1 and "Settings"): take one with the camera or upload, zoom and drag inside
// the circle, then the browser makes a 256 px JPEG (about 20-60 KB) before anything is sent.

const OUT = 256;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/jpeg", quality));
}

export function PhotoPicker({ name, photo, onChange }: { name: string; photo: string | null; onChange?: (url: string | null) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(120);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [saved, setSaved] = useState<string | null>(photo);
  const router = useRouter();
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const BOX = 168;

  useEffect(() => {
    if (!src) return;
    let alive = true;
    loadImage(src).then((i) => { if (alive) { setImg(i); setZoom(120); setOff({ x: 0, y: 0 }); } }, () => setError("That file is not a photo we can open."));
    return () => { alive = false; };
  }, [src]);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/^image\//.test(f.type)) return setError("Choose a photo (JPG, PNG or WebP).");
    if (f.size > 15 * 1024 * 1024) return setError("That photo is too big (15 MB at most).");
    setSrc(URL.createObjectURL(f));
  };

  // The image covers the circle; zoom grows it, drag moves it.
  const base = img ? Math.max(BOX / img.width, BOX / img.height) : 1;
  const scale = base * (zoom / 100);
  const w = img ? img.width * scale : BOX;
  const h = img ? img.height * scale : BOX;
  const clamp = (o: { x: number; y: number }) => ({ x: Math.max(-(w - BOX) / 2, Math.min((w - BOX) / 2, o.x)), y: Math.max(-(h - BOX) / 2, Math.min((h - BOX) / 2, o.y)) });
  const pos = clamp(off);

  const save = () => start(async () => {
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = OUT;
    c.height = OUT;
    const k = OUT / BOX;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, ((BOX - w) / 2 + pos.x) * k, ((BOX - h) / 2 + pos.y) * k, w * k, h * k);
    let blob = await toJpeg(c, 0.86);
    if (blob.size > 150 * 1024) blob = await toJpeg(c, 0.7);
    const fd = new FormData();
    fd.set("photo", blob, "photo.jpg");
    const r = await saveMailPhoto(fd);
    if (r.error) return setError(r.error);
    setSaved(r.url ?? null);
    setSrc(null);
    setImg(null);
    onChange?.(r.url ?? null);
    // The top bar, the account menu and the signature pick up the new photo straight away.
    router.refresh();
  });
  const remove = () => start(async () => { await removeMailPhoto(); setSaved(null); setSrc(null); setImg(null); onChange?.(null); router.refresh(); });

  const btn = "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-black/15 px-4 text-[14px] font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10";
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div
        className="relative shrink-0 touch-none select-none overflow-hidden rounded-full ring-4 ring-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.6)] dark:ring-white/15"
        style={{ width: BOX, height: BOX, background: img || saved ? "#eef0f4" : avatarColor(name), cursor: img ? "grab" : "default" }}
        onPointerDown={(e) => { if (!img) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })); }}
        onPointerUp={() => { drag.current = null; }}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
          <img src={src!} alt="" draggable={false} className="absolute max-w-none" style={{ width: w, height: h, left: (BOX - w) / 2 + pos.x, top: (BOX - h) / 2 + pos.y }} />
        ) : saved ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own photo route
          <img src={saved} alt="Your photo" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-[64px] font-semibold text-white">{name[0]?.toUpperCase() ?? "?"}</span>
        )}
      </div>
      <div className="flex min-w-[240px] flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCamera(true)} className={btn}><Camera className="size-[18px]" />Take a photo</button>
          <button type="button" onClick={() => file.current?.click()} className={btn}><ImageUp className="size-[18px]" />Upload</button>
          {(saved || img) && !pending && <button type="button" onClick={img ? () => { setSrc(null); setImg(null); } : remove} className="h-10 cursor-pointer rounded-full px-3 text-[14px] font-semibold text-[#b42318] hover:bg-[#fdecec]">{img ? "Cancel" : "Remove"}</button>}
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {img && (
          <>
            <label className="flex items-center gap-3 text-[13.5px] font-semibold">Zoom<input type="range" min={100} max={180} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[#1f5ae6]" /></label>
            <button type="button" disabled={pending} onClick={save} className="h-11 w-fit cursor-pointer rounded-full bg-[#1f5ae6] px-6 text-[14.5px] font-semibold text-white hover:bg-[#1a4fd0] disabled:opacity-60">{pending ? "Saving…" : "Use this photo"}</button>
          </>
        )}
        <p className="text-[13px] text-muted">{img ? "Drag to move it. " : ""}We make it small (about 60 KB), so it barely uses your storage.</p>
        {error && <p role="alert" className="rounded-xl bg-[#fdecec] px-3 py-2 text-[13px] font-medium text-[#b42318]">{error}</p>}
      </div>
      {camera && <CameraSheet onClose={() => setCamera(false)} onShot={(url) => { setCamera(false); setSrc(url); }} onFallback={() => { setCamera(false); file.current?.click(); }} />}
    </div>
  );
}

/** The camera (computer or phone): a live view and a shutter. No camera or no permission: the file picker instead. */
function CameraSheet({ onClose, onShot, onFallback }: { onClose: () => void; onShot: (url: string) => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const fallback = useRef(onFallback);
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      fallback.current();
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false }).then((s) => {
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
    }, () => setError("The camera is not available. Allow it in the browser, or upload a photo instead."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const shoot = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    onShot(c.toDataURL("image/jpeg", 0.92));
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Take a photo" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="bmail-pop flex w-full max-w-[520px] flex-col gap-4 rounded-[26px] bg-[#111114] p-4 text-white">
        <div className="flex items-center"><h2 className="flex-1 text-[16px] font-semibold">Take a photo</h2><button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-white/10"><X className="size-5" /></button></div>
        {error ? <p className="rounded-xl bg-white/10 p-4 text-[14px]">{error}</p> : <video ref={video} playsInline muted className="aspect-[4/3] w-full -scale-x-100 rounded-2xl bg-black object-cover" />}
        <div className="flex justify-center gap-3">
          {error ? <button type="button" onClick={onFallback} className="h-11 cursor-pointer rounded-full bg-white px-6 font-semibold text-[#111114]">Upload instead</button>
            : <button type="button" aria-label="Take the photo" onClick={shoot} className="size-16 cursor-pointer rounded-full border-4 border-white bg-white/90 transition active:scale-95" />}
        </div>
      </div>
    </div>
  );
}

/** Own background photo: up to 1920 px wide, about 300 KB, then it becomes the background. */
export function BackgroundUpload({ onDone }: { onDone?: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upload = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/^image\//.test(f.type)) return setError("Choose a photo (JPG, PNG or WebP).");
    start(async () => {
      try {
        const img = await loadImage(URL.createObjectURL(f));
        const k = Math.min(1, 1920 / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        let blob = await toJpeg(c, 0.8);
        for (const q of [0.7, 0.6, 0.5]) if (blob.size > 380 * 1024) blob = await toJpeg(c, q);
        const fd = new FormData();
        fd.set("photo", blob, "background.jpg");
        fd.set("dark", menuSideIsDark(ctx, c.width, c.height) ? "1" : "0");
        const r = await saveBackgroundPhoto(fd);
        if (r.error) setError(r.error);
        else onDone?.();
      } catch {
        setError("That file is not a photo we can open.");
      }
    });
  };
  return (
    <>
      <button type="button" aria-label="Upload your own photo" disabled={pending} onClick={() => file.current?.click()} className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-black/20 text-[13px] font-semibold text-muted transition hover:-translate-y-0.5 hover:border-[#1f5ae6] hover:text-[#1f5ae6] disabled:opacity-60 dark:border-white/20">
        <ImageUp className="size-5" />{pending ? "Uploading…" : "Your photo"}
      </button>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p role="alert" className="col-span-full rounded-xl bg-[#fdecec] px-3 py-2 text-[13px] font-medium text-[#b42318]">{error}</p>}
    </>
  );
}

/** How bright the left fifth of the photo is (where the menu sits): dark → white menu text, light → black. */
function menuSideIsDark(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const top = Math.round(h * 0.08);
  const sw = Math.max(1, Math.round(w * 0.2));
  const sh = Math.max(1, h - top);
  const { data } = ctx.getImageData(0, top, sw, sh);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) { sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++; }
  return n === 0 || sum / n < MENU_DARK_BELOW;
}
