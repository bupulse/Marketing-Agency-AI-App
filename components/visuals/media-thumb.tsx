/** A stored image or video (signed URL) as a thumbnail: a muted, inline video for content videos, else a plain img. */
export function MediaThumb({ url, alt = "", className, loading }: { url: string; alt?: string; className?: string; loading?: "lazy" | "eager" }) {
  if (/\.(mp4|webm)(\?|$)/i.test(new URL(url, "https://x.invalid").pathname)) {
    return <video src={url} muted playsInline preload="metadata" aria-label={alt || "Video"} className={className} />;
  }
  // Signed storage URLs: plain <img>, they are short-lived and not worth routing through the image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading={loading} className={className} />;
}
