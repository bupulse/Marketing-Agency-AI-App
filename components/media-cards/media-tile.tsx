"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { aspectRatio, durationLabel } from "./helpers";
import { useInView, usePointerFx } from "./hooks";
import { Picture } from "./media-stage";
import { VideoStill } from "./video-card";
import s from "./media-cards.module.css";

export type MediaTileProps = {
  /** The picture, or a video (`kind: "video"`) with its poster. */
  item: { url: string; kind?: string | null; poster?: string | null; durationMs?: number | null; alt?: string };
  /** The tile's shape; the media keeps it whatever its own size ("1:1", "4:5", "9:16"). */
  ratio?: string;
  /** "contain" shows a design whole (never cut); "cover" fills the tile. */
  fit?: "cover" | "contain";
  /** The light glass label that rises on hover (its name, its shape). */
  label?: ReactNode;
  /** A tap: open it, or pick it in select mode. */
  onClick?: () => void;
  /** The button's name ("Open IMG_2041.jpg"). */
  ariaLabel?: string;
  selected?: boolean;
  /** On top of the tile (a select box). */
  children?: ReactNode;
  index?: number;
  className?: string;
};

/**
 * A photo, design or video tile like the feed posts of samples.bupulse.com/team/images.html: a rounded frame of a fixed
 * shape that lifts and tilts a little under the pointer with the gradient border, the picture settling in, a video's
 * muted preview on hover with its length, and a light glass label rising on hover.
 */
export function MediaTile({ item, ratio = "1:1", fit = "cover", label, onClick, ariaLabel, selected, children, index = 0, className }: MediaTileProps) {
  const tile = useRef<HTMLDivElement>(null);
  const { seen } = useInView(tile);
  usePointerFx(tile, undefined, { tilt: 4, lift: 4 });
  const video = item.kind === "video";
  const length = durationLabel(item.durationMs);
  const style = { aspectRatio: aspectRatio(ratio, "1:1"), "--i": Math.min(index, 12) } as CSSProperties;
  const media = video ? (
    <VideoStill video={{ src: item.url, poster: item.poster, durationMs: item.durationMs }} fit={fit} host={tile} />
  ) : (
    <Picture item={{ kind: "image", url: item.url, alt: item.alt }} fit={fit} />
  );
  const inner = (
    <>
      {media}
      {video && (
        <span aria-hidden className="pointer-events-none absolute inset-0 z-[2] grid place-items-center">
          <span className={cn(s.play, s.playIdle, "!size-12")}>
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </span>
      )}
      {video && length && <span className={cn(s.chip, "pointer-events-none absolute right-2 bottom-2 z-[2]")}>{length}</span>}
      {label && <span className={cn(s.label, "pointer-events-none absolute inset-x-2 bottom-2 z-[3] truncate rounded-xl px-3 py-2 text-left text-[12.5px] font-semibold")}>{label}</span>}
    </>
  );
  return (
    <div
      ref={tile}
      style={style}
      className={cn(
        s.lift,
        s.post,
        s.zoomHost,
        "relative w-full overflow-hidden rounded-[18px] border border-line bg-soft",
        seen ? s.rise : "opacity-0",
        selected && "outline-[3px] outline-offset-2 outline-pulse-blue outline-solid",
        className,
      )}
    >
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={ariaLabel} className={cn(s.video, "absolute inset-0 block size-full cursor-pointer !rounded-[18px] !bg-transparent !shadow-none outline-none focus-visible:ring-[3px] focus-visible:ring-pulse-blue focus-visible:ring-inset")}>
          {inner}
        </button>
      ) : (
        <div className={cn(s.video, "absolute inset-0 !rounded-[18px] !bg-transparent !shadow-none")}>{inner}</div>
      )}
      {children}
    </div>
  );
}
