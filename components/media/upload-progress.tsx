"use client";

import { CheckCircle2, LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { UploadState } from "./use-gallery-upload";

/** Progress bar and problems for the current upload. Hidden until something was dropped. */
export function UploadProgress({ state, onDismiss, verb = "Uploading" }: { state: UploadState; onDismiss: () => void; verb?: string }) {
  if (state.total === 0) return null;
  const finished = state.done + state.failed;
  const percent = Math.round((finished / state.total) * 100);
  return (
    <div role="status" className="glass-strong animate-pop flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-3">
        {state.active ? (
          <LoaderCircle aria-hidden className="size-5 shrink-0 animate-spin text-pulse-blue motion-reduce:animate-none" />
        ) : state.failed > 0 && state.done === 0 ? (
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-danger" />
        ) : (
          <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
        )}
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium">
          {state.active
            ? `${verb} ${Math.min(finished + 1, state.total)} of ${state.total}${state.current ? `: ${state.current}` : ""}…`
            : state.done > 0
              ? `${state.done} photo${state.done === 1 ? "" : "s"} added${state.failed > 0 ? `, ${state.failed} could not be added` : ""}`
              : "No photos were added"}
        </p>
        {!state.active && (
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <div role="progressbar" aria-label={`${verb} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-soft">
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-500 ease-out-soft motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      {state.errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px] text-danger">
          {state.errors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {state.errors.length > 4 && <li>and {state.errors.length - 4} more problems.</li>}
        </ul>
      )}
    </div>
  );
}
