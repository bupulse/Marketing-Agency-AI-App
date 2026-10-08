"use client";

import { useCallback, useRef, useState } from "react";
import type { ImportResult } from "@/app/dashboard/gallery/import-actions";
import type { MediaItem } from "@/lib/media/service";
import type { UploadState } from "./use-gallery-upload";

export type ImportTask = { name: string; run: () => Promise<ImportResult<{ item: MediaItem }>> };

const IDLE: UploadState = { active: false, total: 0, done: 0, failed: 0, errors: [] };
const PARALLEL = 2;

/**
 * Runs imports one request per file, two at a time, so the progress bar moves per file and one bad file
 * does not stop the rest. `onImported` gets the photos that made it, once everything is finished.
 */
export function useImporter(onImported?: (items: MediaItem[]) => void) {
  const [state, setState] = useState<UploadState>(IDLE);
  const running = useRef(false);

  const dismiss = useCallback(() => setState((s) => (s.active ? s : IDLE)), []);

  const run = useCallback(
    async (tasks: ImportTask[]) => {
      if (running.current || tasks.length === 0) return;
      running.current = true;
      setState({ active: true, total: tasks.length, done: 0, failed: 0, errors: [], current: tasks[0].name });
      const imported: MediaItem[] = [];
      let next = 0;
      const worker = async () => {
        while (next < tasks.length) {
          const task = tasks[next++];
          setState((s) => ({ ...s, current: task.name }));
          try {
            const res = await task.run();
            if (res.ok) {
              imported.push(res.item);
              setState((s) => ({ ...s, done: s.done + 1 }));
            } else {
              setState((s) => ({ ...s, failed: s.failed + 1, errors: s.errors.includes(res.error) ? s.errors : [...s.errors, res.error] }));
            }
          } catch {
            const message = `${task.name} could not be imported. Check your connection and try again.`;
            setState((s) => ({ ...s, failed: s.failed + 1, errors: [...s.errors, message] }));
          }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, worker));
      } finally {
        running.current = false;
        setState((s) => ({ ...s, active: false, current: undefined }));
        if (imported.length > 0) onImported?.(imported);
      }
    },
    [onImported],
  );

  return { state, run, dismiss };
}
