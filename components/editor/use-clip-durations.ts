import { useEffect, useState } from "react";

/**
 * How long each clip is, in seconds, read from the clips' headers by a video element that loads only the metadata (no
 * picture is drawn, so the link need not allow canvas reading). Clips that cannot be read are left out: nothing is capped then.
 */
export function useClipDurations(urls: readonly string[]): ReadonlyMap<string, number> {
  const [found, setFound] = useState<ReadonlyMap<string, number>>(new Map());
  const key = [...new Set(urls)].sort().join("|");
  useEffect(() => {
    if (!key) return;
    const elements: HTMLVideoElement[] = [];
    for (const url of key.split("|")) {
      const el = document.createElement("video");
      el.preload = "metadata";
      el.muted = true;
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) setFound((prev) => new Map(prev).set(url, el.duration));
      };
      el.src = url;
      elements.push(el);
    }
    return () => {
      for (const el of elements) {
        el.onloadedmetadata = null;
        el.removeAttribute("src");
        el.load();
      }
    };
  }, [key]);
  return found;
}
