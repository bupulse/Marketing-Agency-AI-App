// A gallery tile's picture: the photo, or a video's poster (its first frame) with a play mark and its length.
import { Clapperboard, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/media/rules";

export type ThumbItem = { url: string; kind?: string; posterUrl?: string | null; durationMs?: number | null };

export function GalleryThumb({ item, alt, className }: { item: ThumbItem; alt: string; className?: string }) {
  if (item.kind !== "video") {
    // eslint-disable-next-line @next/next/no-img-element -- private signed URL
    return <img src={item.url} alt={alt} loading="lazy" decoding="async" className={cn("size-full object-cover", className)} />;
  }
  return (
    <span className="relative block size-full bg-black/80">
      {item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL
        <img src={item.posterUrl} alt={alt} loading="lazy" decoding="async" className={cn("size-full object-cover", className)} />
      ) : (
        <span role="img" aria-label={alt} className="flex size-full items-center justify-center text-white/70">
          <Clapperboard aria-hidden className="size-7" />
        </span>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-black/55 text-white">
          <Play className="size-5 translate-x-px" />
        </span>
      </span>
      {item.durationMs ? (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[12px] font-semibold text-white tabular-nums">{formatDuration(item.durationMs)}</span>
      ) : null}
    </span>
  );
}
