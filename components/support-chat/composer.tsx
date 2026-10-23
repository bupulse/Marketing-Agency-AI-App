"use client";

import { useRef, useState } from "react";
import { COPY } from "@/lib/support/client/copy";
import { checkFinal, checkUpload, formatDuration } from "@/lib/support/client/uploads";
import type { LocalAttachment } from "@/lib/support/client/outbox";
import { MESSAGE_MAX, UPLOAD_LIMITS } from "@/lib/support/contract";
import { cn } from "@/lib/cn";
import { AttachIcon, CloseIcon, MicIcon, SendIcon, StopIcon } from "./icons";
import { shrinkImage, useVoiceRecorder } from "./media";

const ACCEPT = [...UPLOAD_LIMITS.imageMime, "image/heic", "image/heif", ...UPLOAD_LIMITS.fileMime].join(",");
const ROUND = "inline-flex size-10 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted transition-colors hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40";

/** The message box, the paperclip (photos and PDFs) and the voice-note button. */
export function Composer({
  canAttach,
  inputRef,
  onSend,
  onDraft,
  onAttach,
  onError,
}: {
  /** Files need a conversation first (uploads belong to one). */
  canAttach: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onDraft: (text: string) => void;
  onAttach: (a: LocalAttachment) => void;
  onError: (message: string | null) => void;
}) {
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement | null>(null);
  const voice = useVoiceRecorder((r) => {
    const ok = checkFinal({ type: r.mime, size: r.blob.size });
    if (!ok.ok) return onError(ok.error);
    onAttach({ kind: "voice", blob: r.blob, mime: r.mime, fileName: null, bytes: r.blob.size, durationSec: r.durationSec, previewUrl: URL.createObjectURL(r.blob) });
  });

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (t.length > MESSAGE_MAX) return onError(COPY.tooLong);
    onError(null);
    onSend(t);
    setText("");
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const first = checkUpload({ type: f.type, size: f.size });
    if (!first.ok) return onError(first.error);
    try {
      const out = first.kind === "image" ? await shrinkImage(f) : { blob: f as Blob, mime: f.type, fileName: f.name };
      const ok = checkFinal({ type: out.mime, size: out.blob.size });
      if (!ok.ok) return onError(ok.error);
      onError(null);
      onAttach({ kind: ok.kind, blob: out.blob, mime: out.mime, fileName: out.fileName.slice(0, 200), bytes: out.blob.size, durationSec: null, previewUrl: ok.kind === "image" ? URL.createObjectURL(out.blob) : null });
    } catch {
      onError(COPY.badType);
    }
  };

  if (voice.state === "recording")
    return (
      <div className="flex items-center gap-1.5 border-t border-line px-3 pt-2.5 pb-3">
        <button type="button" onClick={voice.cancel} aria-label={COPY.cancelRecording} className={ROUND}>
          <CloseIcon />
        </button>
        <p className="m-0 flex flex-1 items-center gap-2 text-sm font-medium" role="status">
          <span className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" aria-hidden />
          {COPY.recording} {formatDuration(voice.elapsed)} / {formatDuration(UPLOAD_LIMITS.maxVoiceSec)}
        </p>
        <button type="button" onClick={voice.stop} aria-label={COPY.stopAndSend} className={cn(ROUND, "bg-brand-gradient text-white hover:bg-brand-gradient")}>
          <StopIcon />
        </button>
      </div>
    );

  return (
    <form
      className="flex items-end gap-1.5 border-t border-line px-3 pt-2.5 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <button type="button" onClick={() => file.current?.click()} disabled={!canAttach} aria-label={COPY.attach} title={canAttach ? COPY.attach : COPY.attachFirst} className={ROUND}>
        <AttachIcon />
      </button>
      <input
        ref={file}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <label className="flex min-w-0 flex-1">
        <span className="sr-only">{COPY.message}</span>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX + 50}
          placeholder={COPY.placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-32 min-h-[44px] w-full resize-none rounded-[22px] border border-line bg-transparent px-3.5 py-[11px] text-[15px] leading-5 text-text outline-none [field-sizing:content] placeholder:text-muted/80 focus:border-pulse-blue focus:shadow-ring"
        />
      </label>
      {voice.supported && (
        <button type="button" onClick={() => void voice.start().then((r) => r === "blocked" && onError(COPY.micBlocked))} disabled={!canAttach} aria-label={COPY.record} title={canAttach ? COPY.record : COPY.attachFirst} className={ROUND}>
          <MicIcon />
        </button>
      )}
      <button type="submit" aria-label={COPY.send} className={cn(ROUND, "bg-brand-gradient text-white hover:bg-brand-gradient")}>
        <SendIcon />
      </button>
    </form>
  );
}
