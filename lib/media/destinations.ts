// Where a new gallery photo goes, and which photos a gallery view shows. Pure, shared by the browser and the server.
//
// Rule (Knowledge base, docs/KNOWLEDGE_BASE.md): every upload or import names its destination first: a folder, a
// product's album or a campaign's album. "All photos" and "Not in a folder" are views, not destinations, so an upload
// started there asks first. Photos already outside any folder stay where they are. Every product and campaign has an
// album (its ProductPhoto / CampaignPhoto rows); one photo can be in several albums and in one folder at the same time.

import { MAX_ALBUM_PHOTOS } from "@/lib/knowledge/products";

export type AlbumKind = "product" | "campaign";
export type Destination = { kind: "folder"; id: string } | { kind: AlbumKind; id: string };
export type GalleryFilter = { kind: "all" } | { kind: "none" } | Destination;

/** Albums a single photo can be in. */
export const MAX_ALBUMS_PER_PHOTO = 50;

export const DESTINATION_REQUIRED = "Choose where these photos go: a folder or a product album.";

const ID = /^[A-Za-z0-9_-]{1,60}$/;

/** "folder:<id>", "product:<id>" or "campaign:<id>" as a destination; null for anything else. */
export function parseDestination(raw: unknown): Destination | null {
  if (typeof raw !== "string") return null;
  const [kind, id, extra] = raw.split(":");
  if (extra !== undefined || !id || !ID.test(id)) return null;
  return kind === "folder" || kind === "product" || kind === "campaign" ? { kind, id } : null;
}

export function destinationKey(d: Destination): string {
  return `${d.kind}:${d.id}`;
}

/** Why an upload or import may not start with this destination, or null when it may. */
export function destinationProblem(raw: unknown): string | null {
  return parseDestination(raw) ? null : DESTINATION_REQUIRED;
}

/**
 * A view of the gallery from the page's ?folder= value: "all", "none", a folder id (older links), or a typed key
 * ("folder:<id>", "product:<id>", "campaign:<id>"). Anything unreadable is "all".
 */
export function parseFilter(raw: string | null | undefined): GalleryFilter {
  if (!raw || raw === "all") return { kind: "all" };
  if (raw === "none") return { kind: "none" };
  if (raw.includes(":")) return parseDestination(raw) ?? { kind: "all" };
  return ID.test(raw) ? { kind: "folder", id: raw } : { kind: "all" };
}

export function filterKey(f: GalleryFilter): string {
  return f.kind === "all" || f.kind === "none" ? f.kind : destinationKey(f);
}

/** Where an upload from this view goes without asking: the open folder or album; null means "ask first". */
export function uploadDestinationFor(f: GalleryFilter): Destination | null {
  return f.kind === "all" || f.kind === "none" ? null : f;
}

/** Why `adding` more photos would not fit in an album that has `current`, or null. */
export function albumProblem(current: number, adding: number): string | null {
  return current + adding > MAX_ALBUM_PHOTOS ? `An album holds up to ${MAX_ALBUM_PHOTOS} photos. Remove some first.` : null;
}

/** The new album positions for `added` photos after `current` ones: appended in order. */
export function appendPositions(current: number, added: number): number[] {
  return Array.from({ length: added }, (_, i) => current + i);
}

export type DestinationOption = { key: string; label: string; group: "Folders" | "Products" | "Campaigns" };

/** The places a photo can go, for "Save to" pickers: folders, then product albums, then campaign albums. */
export function destinationOptions(overview: { folders: { id: string; name: string }[]; albums: { kind: AlbumKind; id: string; name: string }[] }): DestinationOption[] {
  return [
    ...overview.folders.map((f) => ({ key: destinationKey({ kind: "folder", id: f.id }), label: f.name, group: "Folders" as const })),
    ...overview.albums.filter((a) => a.kind === "product").map((a) => ({ key: destinationKey(a), label: a.name, group: "Products" as const })),
    ...overview.albums.filter((a) => a.kind === "campaign").map((a) => ({ key: destinationKey(a), label: a.name, group: "Campaigns" as const })),
  ];
}
