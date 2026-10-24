// The Library as a gallery (docs/TRAINING_LAB.md): what a card shows for an example, the kind chips above the grid and the
// anchor links that open an example. Pure; the page and gallery.tsx use it.
import { KIND_LABELS, type TrainingKind } from "./types";

/** The chips above the grid: "All" and one per kind, in the owner's words. */
export const KIND_CHIPS: { kind: TrainingKind | null; label: string }[] = [
  { kind: null, label: "All" },
  { kind: "reel", label: "Reels" },
  { kind: "video", label: "Videos" },
  { kind: "image", label: "Images" },
  { kind: "voice", label: "Recordings" },
  { kind: "actor", label: "Actors" },
  { kind: "schedule", label: "Habits" },
];

export type GalleryFilter = { kind?: string; sector?: string; language?: string; engine?: string };

/** The Library's address for these filters (only the ones that are set). */
export function libraryHref(base: string, filter: GalleryFilter): string {
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => !!v) as [string, string][]).toString();
  return qs ? `${base}?${qs}` : base;
}

/** The address of a kind chip: the other filters stay, the kind is set or (for "All") cleared. */
export function chipHref(base: string, filter: GalleryFilter, kind: TrainingKind | null): string {
  const { kind: _old, ...rest } = filter;
  void _old;
  return libraryHref(base, kind ? { kind, ...rest } : rest);
}

export type Thumb =
  | { type: "video" | "image"; url: string }
  | { type: "audio" | "habit" | "link" | "file" | "missing" };

/** What a card shows in place of a picture: the video's first frame, the image, or an icon for the rest. */
export function thumbOf(e: { kind: string; path: string | null; mime: string | null; sourceUrl: string | null }, link?: string): Thumb {
  if (e.kind === "schedule") return { type: "habit" };
  if (e.path) {
    if (!link) return { type: "missing" };
    const mime = e.mime ?? "";
    if (mime.startsWith("video/")) return { type: "video", url: link };
    if (mime.startsWith("image/")) return { type: "image", url: link };
    if (mime.startsWith("audio/")) return { type: "audio" };
    return { type: "file" };
  }
  return e.sourceUrl ? { type: "link" } : { type: "missing" };
}

export type GalleryItem = {
  id: string;
  title: string;
  kind: string;
  kindLabel: string;
  rating: number | null;
  /** The owner wrote a "never this" note. */
  never: boolean;
  /** How many times the team used it in the last 30 days (null: not at all). */
  used: number | null;
  /** Why the Lab health list flags it (null: it is fine). */
  warning: string | null;
  thumb: Thumb;
};

type ExampleLike = { id: string; title: string; kind: string; rating: number | null; neverThis: string | null; path: string | null; mime: string | null; sourceUrl: string | null };

export function galleryItem(e: ExampleLike, ctx: { link?: string; times?: number; warning?: string | null } = {}): GalleryItem {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind,
    kindLabel: KIND_LABELS[e.kind as TrainingKind] ?? e.kind,
    rating: e.rating,
    never: !!e.neverThis?.trim(),
    used: ctx.times && ctx.times > 0 ? ctx.times : null,
    warning: ctx.warning ?? null,
    thumb: thumbOf(e, ctx.link),
  };
}

/** The example an anchor like "#ex-cmh4abc" points at, or null. */
export function exampleIdFromHash(hash: string): string | null {
  const m = /^#?ex-([A-Za-z0-9_-]{1,64})$/.exec(hash.trim());
  return m ? m[1] : null;
}
