"use client";

// Browser-only helpers for the skit voice notes: record with MediaRecorder (stopped at 15 s), and turn a recording or a
// picked file (a WhatsApp .ogg/.opus, an iPhone .m4a) into 16 kHz mono WAV (lib/skits/wav.ts). A file the browser cannot
// decode (Safari and some Ogg notes) goes as it is; the server takes those types too.
import { useCallback, useEffect, useRef, useState } from "react";
import { pickVoiceType } from "@/lib/support/client/uploads";
import { VOICE_MAX_SECONDS } from "@/lib/skits/shared";
import { encodeWav, mixToMono, trimSilence, WAV_SAMPLE_RATE } from "@/lib/skits/wav";

export type VoiceFile = { blob: Blob; name: string; seconds: number | null };

/** The note as WAV, cut to VOICE_MAX_SECONDS, or the original when the browser cannot decode it. */
export async function toWav(source: Blob, name: string): Promise<VoiceFile> {
  const Ctx = typeof window !== "undefined" ? (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext) : undefined;
  if (!Ctx) return { blob: source, name, seconds: null };
  try {
    // decodeAudioData needs a context; an OfflineAudioContext of one frame is enough to decode.
    const decoded = await new Ctx(1, 1, WAV_SAMPLE_RATE).decodeAudioData(await source.arrayBuffer());
    const seconds = Math.min(decoded.duration, VOICE_MAX_SECONDS);
    const render = new Ctx(1, Math.max(1, Math.ceil(seconds * WAV_SAMPLE_RATE)), WAV_SAMPLE_RATE);
    const node = render.createBufferSource();
    node.buffer = decoded;
    node.connect(render.destination);
    node.start();
    const out = await render.startRendering();
    const samples = trimSilence(mixToMono(Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i))));
    const bytes = encodeWav(samples);
    return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" }), name: name.replace(/\.[^.]+$/, "") + ".wav", seconds: samples.length / WAV_SAMPLE_RATE };
  } catch {
    return { blob: source, name, seconds: null };
  }
}

/** A voice note with MediaRecorder: webm/opus where the browser has it (mp4 on Safari), stopped at VOICE_MAX_SECONDS. */
export function useSkitRecorder(onDone: (blob: Blob, mime: string) => void) {
  const [state, setState] = useState<"idle" | "recording" | "blocked">("idle");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; keep: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
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

  const start = useCallback(async () => {
    if (!supported || rec.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("blocked");
      return;
    }
    const type = pickVoiceType((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
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
      const mime = (mr.mimeType || type || "audio/webm").split(";")[0];
      doneRef.current(new Blob(chunks, { type: mime }), mime);
    };
    const timer = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setElapsed(s);
      if (s >= VOICE_MAX_SECONDS) finish(true);
    }, 250);
    rec.current = { mr, stream, keep: false, timer };
    mr.start(500);
    setState("recording");
  }, [supported, finish]);

  // Leaving the page mid-recording drops it and frees the microphone.
  useEffect(() => () => finish(false), [finish]);

  return { supported, state, elapsed, start, stop: () => finish(true), cancel: () => finish(false) };
}
