// What a dropped file is, from its type (Drop, read, check). Pure and client-safe.
import { KINDS, type TrainingKind } from "@/lib/training-lab/types";

export const isKind = (v: unknown): v is TrainingKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

export type FileFamily = "video" | "image" | "audio" | "other";

/** Some phones give no type for .m4a, .mov or .heic files: guess it from the name. */
const EXT_TYPES: Record<string, string> = { m4a: "audio/x-m4a", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", mov: "video/quicktime", mp4: "video/mp4", webm: "video/webm", m4v: "video/x-m4v", heic: "image/heic", heif: "image/heif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const typeOf = (file: { name: string; type: string }) => file.type || EXT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";

export function familyOf(mime: string): FileFamily {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

/** The kind a file starts as: a video is a reel, an image an image or post, a sound a Kinyarwanda recording. */
export function kindFromMime(mime: string): TrainingKind | null {
  return { video: "reel", image: "image", audio: "voice", other: null }[familyOf(mime)] as TrainingKind | null;
}

/** The kinds the owner may switch to for this file (the chips): the ones that take its type of file. A link: any but a posting habit. */
export function kindsFor(mime: string | null): TrainingKind[] {
  if (mime === null) return ["reel", "video", "image", "voice", "actor"];
  return { video: ["reel", "video", "actor", "voice"], image: ["image", "actor", "schedule"], audio: ["voice"], other: [] }[familyOf(mime)] as TrainingKind[];
}

/** Whether the AI's notes say people are seen (then the check step asks for their consent). */
export function peopleSeen(notes: { people?: string } | null | undefined): boolean {
  const p = (notes?.people ?? "").trim().toLowerCase();
  return !!p && !/^(none|no one|nobody|no people|n\/a|-)\.?$/.test(p);
}
