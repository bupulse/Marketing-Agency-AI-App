// The music library (docs/VOICE_AND_MUSIC.md): moods, what a track upload must carry, and how a video's track is
// chosen. Pure and client-safe.
import { z } from "zod";

export const MOODS = ["upbeat", "calm", "corporate", "inspiring", "afro", "acoustic", "warm", "energetic"] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_LABEL: Record<Mood, string> = {
  upbeat: "Upbeat",
  calm: "Calm",
  corporate: "Corporate",
  inspiring: "Inspiring",
  afro: "Afro / amapiano style",
  acoustic: "Acoustic",
  warm: "Warm",
  energetic: "Energetic",
};

export const isMood = (value: unknown): value is Mood => typeof value === "string" && (MOODS as readonly string[]).includes(value);

/** Track files: MP3 or M4A up to 6 MB (the music bucket refuses anything else). */
export const TRACK_TYPES = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a" } as const;
export const TRACK_MAX_BYTES = 6 * 1024 * 1024;

export const trackInputSchema = z.object({
  title: z.string().trim().min(1, "Give the track a title.").max(120),
  moods: z.array(z.enum(MOODS)).min(1, "Pick at least one mood.").max(4),
  bpm: z.number().int().min(30).max(300).nullable().optional(),
  licence: z.string().trim().min(2, "Name the licence.").max(120),
  sourceUrl: z.string().trim().url("Give the page the track comes from.").max(500).refine((u) => /^https:\/\//.test(u), "Use an https link."),
  attribution: z.string().trim().min(2, "Write the credit line (the licence asks for it, or write the author and source).").max(300),
});
export type TrackInput = z.infer<typeof trackInputSchema>;

/** The first bytes of an MP3 (ID3 tag or an MPEG frame) or an M4A ("ftyp" box). */
export function sniffAudio(head: Uint8Array): "audio/mpeg" | "audio/mp4" | null {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return "audio/mpeg";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (head.length >= 8 && String.fromCharCode(...head.subarray(4, 8)) === "ftyp") return "audio/mp4";
  return null;
}

/** The mood a post's video should have, from its angle (content packs) or the brand voice. */
export function moodFor(input: { angle?: string | null; tone?: string | null }): Mood {
  const byAngle: Record<string, Mood> = { price: "upbeat", "how-it-works": "corporate", features: "upbeat", news: "energetic", story: "warm", "behind-scenes": "acoustic", tips: "calm", faq: "calm", "why-us": "inspiring", seasonal: "afro", cta: "energetic" };
  if (input.angle && byAngle[input.angle]) return byAngle[input.angle];
  const byTone: Record<string, Mood> = { luxury: "calm", caring: "warm", bold: "energetic", playful: "upbeat", professional: "corporate", friendly: "warm" };
  return byTone[input.tone ?? ""] ?? "upbeat";
}

export type TrackChoice = { id: string; moods: string[] };

/**
 * A track for a video: one of the active tracks with the mood, chosen by a seed (so the posts of a pack do not all get
 * the same one), else any track; null when the library is empty (videos are made without music).
 */
export function pickTrack<T extends TrackChoice>(tracks: readonly T[], mood: string | null | undefined, seed: string): T | null {
  if (tracks.length === 0) return null;
  const fitting = tracks.filter((t) => mood && t.moods.includes(mood));
  const pool = fitting.length ? fitting : tracks;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}
