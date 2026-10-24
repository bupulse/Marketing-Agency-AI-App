"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { Panel } from "@/components/admin/ui";
import type { MotionSpec } from "@/lib/video-engine/spec";
import { exportMp4, exportProblem } from "./export";
import { mp4Name } from "./reel-spec";

/** Makes the MP4 in this browser (the same encoder as the Videos page), with a progress line and a download link. Nothing is uploaded. */
export function ExportPanel({ spec, musicUrl, title, onMade }: { spec: MotionSpec; musicUrl: string | null; title: string; onMade?: (made: { blob: Blob; spec: MotionSpec }) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ url: string; name: string; mb: number; spec: MotionSpec } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  // A download link is a Blob URL: free it when a new one replaces it and when the page closes.
  useEffect(
    () => () => {
      abort.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function make() {
    if (progress !== null) return;
    setError(null);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const blob = await exportMp4(spec, musicUrl, { signal: controller.signal, onProgress: setProgress });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setFile({ url: urlRef.current, name: mp4Name(title || spec.title), mb: Math.round((blob.size / 1_048_576) * 10) / 10, spec });
      onMade?.({ blob, spec });
    } catch (e) {
      setError(exportProblem(e));
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }

  return (
    <Panel title="Export" description="Makes the MP4 in this browser, at 720p. Keep this tab in front while it works. Export alone saves nothing.">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={make} disabled={progress !== null}>
          {progress === null ? "Export MP4" : `Making the video… ${progress}%`}
        </Button>
        {progress !== null && (
          <Button type="button" variant="outline" size="sm" onClick={() => abort.current?.abort()}>Cancel</Button>
        )}
      </div>
      {progress !== null && <progress max={100} value={progress} aria-label="Export progress" className="h-2 w-full" />}
      {file && file.spec !== spec && progress === null && <p className="text-[13px] text-muted">You changed the video after the last export. Export again to get the new one.</p>}
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      {file && file.spec === spec && progress === null && (
        <a href={file.url} download={file.name} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-pulse-blue underline">
          <Download className="size-4" aria-hidden /> Download {file.name} ({file.mb} MB)
        </a>
      )}
    </Panel>
  );
}
