"use client";

import { useCallback, useRef, useState } from "react";
import { finishVideoUpload, reportVideoFailure, startVideoUpload } from "@/app/dashboard/visuals/actions";
import { createClient } from "@/lib/supabase/client";
import type { VisualView } from "@/lib/visuals/types";

export type RenderPhase = "idle" | "loading" | "rendering" | "uploading" | "done" | "error";

/**
 * Makes a content video in this browser and stores it: render (WebCodecs MP4, else WebM), ask the server for a
 * signed upload (it checks the plan, the length, the size and the quota), upload straight to Storage, confirm.
 * The renderer is loaded only when a video is made, so pages without one never download it.
 */
export function useVideoRender(visual: VisualView | null, onDone?: () => void) {
  const [phase, setPhase] = useState<RenderPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [musicSkipped, setMusicSkipped] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (music?: File | null) => {
      if (!visual?.videoPlan || phase === "rendering" || phase === "uploading" || phase === "loading") return;
      setError(null);
      setProgress(0);
      setPhase("loading");
      const controller = new AbortController();
      abort.current = controller;
      try {
        const { renderVideo, videoSupport, VideoRenderError } = await import("./video-renderer");
        const support = videoSupport();
        if (!support.mp4 && !support.webm) {
          const message = "This browser cannot make videos. Try the latest Chrome, Edge or Safari. Your picture is used instead.";
          await reportVideoFailure(visual.id, message);
          setError(message);
          setPhase("error");
          return;
        }
        setPhase("rendering");
        let result;
        try {
          result = await renderVideo(visual.videoPlan, { photoUrls: visual.photoUrls, music, onProgress: setProgress, signal: controller.signal });
        } catch (e) {
          const message = e instanceof VideoRenderError ? e.message : "We could not make the video in this browser. Please try again.";
          if (!(e instanceof VideoRenderError && e.reason === "aborted")) await reportVideoFailure(visual.id, message);
          setError(message);
          setPhase("error");
          return;
        }
        setMusicSkipped(!!music && result.musicSkipped);
        setPhase("uploading");
        const target = await startVideoUpload(visual.id, { bytes: result.blob.size, mimeType: result.mimeType, durationMs: result.durationMs });
        if (!target.ok) throw new Error(target.error);
        const { error: uploadError } = await createClient().storage.from("media").uploadToSignedUrl(target.path, target.token, result.blob, { contentType: result.mimeType });
        if (uploadError) throw new Error("The video could not be uploaded. Please try again.");
        const saved = await finishVideoUpload(visual.id, { path: target.path, durationMs: result.durationMs });
        if (!saved.ok) throw new Error(saved.error);
        setProgress(1);
        setPhase("done");
        onDone?.();
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : "The video could not be saved. Please try again.");
        setPhase("error");
      } finally {
        abort.current = null;
      }
    },
    [visual, phase, onDone],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { phase, progress, error, musicSkipped, run, cancel, busy: phase === "loading" || phase === "rendering" || phase === "uploading" };
}
