"use client";

// Browser-only helpers for the composer: shrinking photos, recording voice notes, and the Turnstile check.
import { useCallback, useEffect, useRef, useState } from "react";
import { UPLOAD_LIMITS } from "@/lib/support/contract";
import { bareMime, CONVERTIBLE_IMAGE, needsShrink, pickVoiceType, SHRINK_QUALITY, shrinkSize } from "@/lib/support/client/uploads";

/** A photo redrawn as JPEG at most 1600 px on its longest side, or the original when that is already small. */
export async function shrinkImage(file: File): Promise<{ blob: Blob; mime: string; fileName: string }> {
  const original = { blob: file as Blob, mime: bareMime(file.type), fileName: file.name };
  const convert = CONVERTIBLE_IMAGE.includes(original.mime);
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    if (convert) throw new Error("unreadable");
    return original;
  }
  try {
    if (!needsShrink(file, bmp.width, bmp.height)) return original;
    const { width, height } = shrinkSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    // Transparent screenshots become white, not black, as JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", SHRINK_QUALITY));
    if (!blob || (!convert && blob.size >= file.size)) return original;
    return { blob, mime: "image/jpeg", fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } finally {
    bmp.close();
  }
}

export type Recording = { blob: Blob; mime: string; durationSec: number };

/** A voice note with MediaRecorder: webm/opus where the browser has it (mp4 on Safari), stopped at 120 s. */
export function useVoiceRecorder(onDone: (r: Recording) => void) {
  const [state, setState] = useState<"idle" | "recording" | "blocked">("idle");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; started: number; keep: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  const supported = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const finish = useCallback((keep: boolean) => {
    const r = rec.current;
    if (!r) return;
    r.keep = keep;
    clearInterval(r.timer);
    if (r.mr.state !== "inactive") r.mr.stop();
  }, []);

  const start = useCallback(async (): Promise<"ok" | "blocked"> => {
    if (!supported || rec.current) return "ok";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("blocked");
      return "blocked";
    }
    const type = pickVoiceType((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined);
    const chunks: Blob[] = [];
    const started = Date.now();
    mr.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    mr.onstop = () => {
      const r = rec.current;
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      setState("idle");
      setElapsed(0);
      if (!r?.keep || !chunks.length) return;
      const mime = bareMime(mr.mimeType || type || "audio/webm");
      const durationSec = Math.min(UPLOAD_LIMITS.maxVoiceSec, Math.max(1, Math.round((Date.now() - started) / 1000)));
      doneRef.current({ blob: new Blob(chunks, { type: mime }), mime, durationSec });
    };
    const timer = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setElapsed(s);
      if (s >= UPLOAD_LIMITS.maxVoiceSec) finish(true);
    }, 250);
    rec.current = { mr, stream, started, keep: false, timer };
    mr.start(1000);
    setState("recording");
    return "ok";
  }, [supported, finish]);

  // Leaving the page or closing the panel mid-recording drops it and frees the microphone.
  useEffect(() => () => finish(false), [finish]);

  return { supported, state, elapsed, start, stop: () => finish(true), cancel: () => finish(false) };
}

type TurnstileApi = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
};

let turnstileScript: Promise<TurnstileApi | null> | null = null;
function loadTurnstile(): Promise<TurnstileApi | null> {
  turnstileScript ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve((window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return turnstileScript;
}

/**
 * Cloudflare Turnstile, loaded only when the server asks for a check (like the website chat, public/widget-chat.js).
 * Invisible unless Cloudflare wants the visitor to tap; then `visible` shows its box above the composer.
 */
export function useTurnstile() {
  const box = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const pending = useRef<((v: string | null) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);

  const done = useCallback((v: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
    const p = pending.current;
    pending.current = null;
    p?.(v);
  }, []);
  const wait = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => done(null), ms);
  }, [done]);

  const token = useCallback(
    async (siteKey: string): Promise<string | null> => {
      const t = await loadTurnstile();
      const el = box.current;
      if (!t || !el) return null;
      return new Promise((resolve) => {
        pending.current?.(null);
        pending.current = resolve;
        wait(20_000);
        if (widget.current === null) {
          widget.current = t.render(el, {
            sitekey: siteKey,
            appearance: "interaction-only",
            execution: "execute",
            // A visible challenge (VPN, strict browsers) needs the visitor: give them two minutes.
            "before-interactive-callback": () => {
              wait(120_000);
              setVisible(true);
            },
            "after-interactive-callback": () => setVisible(false),
            callback: (v: string) => done(v),
            "error-callback": () => done(null),
          });
        } else {
          t.reset(widget.current);
        }
        t.execute(widget.current);
      });
    },
    [done, wait],
  );

  return { box, visible, token };
}
