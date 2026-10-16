// The music library on the server (docs/VOICE_AND_MUSIC.md). Tracks live in the public-read "music" bucket: they are
// royalty-free files meant to be heard by anyone, the browser renderer and the video robot fetch them without signing,
// and only the admin writes them (signed upload URLs made with the service key; the bucket has no write policy).
// /public was not an option: the console uploads at run time and the deployed app's files are read-only.
import "server-only";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { prisma } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VideoMusic } from "@/lib/visuals/types";
import { z } from "zod";
import { withLedger } from "@/lib/ai/ledger";
import { composeMusic, ELEVENLABS_MUSIC_MODEL } from "@/lib/ai/tts";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { ELEVENLABS_MUSIC_LICENCE, ELEVENLABS_MUSIC_SOURCE, isOwnedLicence, MOOD_LABEL, MOODS, pickTrack, sniffAudio, TRACK_MAX_BYTES, TRACK_TYPES, trackInputSchema, type TrackInput } from "./tracks";

export const MUSIC_BUCKET = "music";
/** The whole library stays small: it shares the free Storage project with everything else. */
export const MUSIC_LIBRARY_MAX_BYTES = 80 * 1024 * 1024;

/** The public URL of a track file (the music bucket is public-read). */
export function musicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${MUSIC_BUCKET}/${encodeURIComponent(path)}`;
}

export type LibraryTrack = { id: string; title: string; moods: string[]; attribution: string; licence: string; path: string; url: string };

/** Active tracks for the pickers and the art director, newest first. Empty library: videos have no music. */
export async function activeTracks(): Promise<LibraryTrack[]> {
  const rows = await prisma.musicTrack.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, title: true, moods: true, attribution: true, licence: true, path: true } });
  return rows.map((r) => ({ ...r, url: musicUrl(r.path) }));
}

let cache: { at: number; tracks: LibraryTrack[] } | null = null;

/**
 * The library track for a new video: one with the mood (the art director's, else the angle's or the brand voice's),
 * varied by `seed`; null when the library is empty or cannot be read (the video has no music).
 */
export async function trackForVideo(mood: string | null | undefined, seed: string): Promise<VideoMusic | null> {
  try {
    if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), tracks: await activeTracks() };
    const track = pickTrack(cache.tracks, mood, seed);
    return track ? { trackId: track.id, title: track.title, path: track.path, attribution: track.attribution, owned: isOwnedLicence(track.licence) } : null;
  } catch {
    return null;
  }
}

export async function listTracks() {
  return prisma.musicTrack.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
}

/** Step 1 of an upload: checks type, size and library room, gives a signed upload URL for a new file name. */
export async function startTrackUpload(file: { mimeType: string; bytes: number }) {
  const ext = TRACK_TYPES[file.mimeType as keyof typeof TRACK_TYPES];
  if (!ext) throw new AdminError("invalid", "Upload an MP3 or M4A file.");
  if (!(file.bytes > 0) || file.bytes > TRACK_MAX_BYTES) throw new AdminError("invalid", "Tracks can be at most 6 MB.");
  const used = (await prisma.musicTrack.aggregate({ _sum: { bytes: true } }))._sum.bytes ?? 0;
  if (used + file.bytes > MUSIC_LIBRARY_MAX_BYTES) throw new AdminError("invalid", "The music library is full (80 MB). Remove a track first.");
  const path = `${globalThis.crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(MUSIC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new AdminError("unavailable", "Storage did not accept the upload. Try again.");
  return { path: data.path, token: data.token };
}

/**
 * Step 2: the file is in the bucket. Its size and first bytes are checked, then the track is saved with its licence,
 * source and credit line (all required), and the upload is audited. A file that fails the checks is deleted.
 */
export async function finishTrackUpload(ctx: AdminContext, path: string, raw: TrackInput) {
  if (!/^[0-9a-f-]{36}\.(mp3|m4a)$/.test(path)) throw new AdminError("invalid", "That upload could not be used.");
  const bucket = createAdminClient().storage.from(MUSIC_BUCKET);
  const reject = async (message: string): Promise<never> => {
    await bucket.remove([path]).catch(() => {});
    throw new AdminError("invalid", message);
  };
  const parsed = trackInputSchema.safeParse(raw);
  if (!parsed.success) return reject(parsed.error.issues[0]?.message ?? "Check the track details.");
  const info = await bucket.info(path);
  const size = info.data?.size;
  if (info.error || !size) throw new AdminError("not_found", "The file did not arrive. Upload it again.");
  if (size > TRACK_MAX_BYTES) return reject("Tracks can be at most 6 MB.");
  const head = await fetch(musicUrl(path), { headers: { Range: "bytes=0-31" } }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  const type = head ? sniffAudio(new Uint8Array(head)) : null;
  if (!type || TRACK_TYPES[type] !== path.split(".").pop()) return reject("That file is not an MP3 or M4A track.");
  const data = { ...parsed.data, bpm: parsed.data.bpm ?? null, path, mimeType: type, bytes: size, createdBy: ctx.actor };
  const row = await prisma.$transaction(async (tx) => {
    // The 80 MB cap is checked again under a lock, so two uploads at once cannot both pass it.
    if (!(await libraryHasRoom(tx, size))) return null;
    const row = await tx.musicTrack.create({ data });
    await writeAudit(tx, ctx, "create_music_track", `music:${row.id}`, null, { title: row.title, licence: row.licence, sourceUrl: row.sourceUrl, bytes: row.bytes });
    return row;
  });
  return row ?? reject("The music library is full (80 MB). Remove a track first.");
}

/** Under a transaction-wide lock on the library: whether `adding` bytes still fit the 80 MB cap. */
async function libraryHasRoom(tx: Pick<typeof prisma, "musicTrack" | "$executeRaw">, adding: number): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('music-library'))`;
  const used = (await tx.musicTrack.aggregate({ _sum: { bytes: true } }))._sum.bytes ?? 0;
  return used + adding <= MUSIC_LIBRARY_MAX_BYTES;
}

/**
 * Files in the music bucket that no track refers to (an upload started and never finished), older than an hour: deleted.
 * Run when the admin opens the music page and by the daily media clean-up. Best effort.
 */
export async function cleanupMusicOrphans(now = new Date()): Promise<number> {
  try {
    const bucket = createAdminClient().storage.from(MUSIC_BUCKET);
    const { data: files } = await bucket.list("", { limit: 1000 });
    const old = (files ?? []).filter((f) => f.id && f.created_at && now.getTime() - new Date(f.created_at).getTime() > 60 * 60 * 1000).map((f) => f.name);
    if (old.length === 0) return 0;
    const known = new Set((await prisma.musicTrack.findMany({ where: { path: { in: old } }, select: { path: true } })).map((t) => t.path));
    const orphans = old.filter((p) => !known.has(p));
    if (orphans.length) await bucket.remove(orphans);
    return orphans.length;
  } catch {
    return 0;
  }
}

export async function setTrackActive(ctx: AdminContext, id: string, active: boolean) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.musicTrack.updateMany({ where: { id }, data: { active } });
    if (count === 0) throw new AdminError("not_found", "That track is gone.");
    await writeAudit(tx, ctx, "update_music_track", `music:${id}`, null, { active });
  });
}

/** Removes a track and its file. Videos that chose it are made without music from then on. */
export async function deleteTrack(ctx: AdminContext, id: string) {
  const row = await prisma.musicTrack.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "That track is gone.");
  await prisma.$transaction(async (tx) => {
    await tx.musicTrack.delete({ where: { id } });
    await writeAudit(tx, ctx, "delete_music_track", `music:${id}`, { title: row.title, licence: row.licence }, null);
  });
  await createAdminClient().storage.from(MUSIC_BUCKET).remove([row.path]).catch(() => {});
}

/** Tracks the admin may generate a day (each one is paid). */
export const GENERATE_PER_DAY = { limit: 20, windowSeconds: 24 * 60 * 60 } as const;

export const generateSchema = z.object({
  title: z.string().trim().min(1, "Give the track a title.").max(120),
  prompt: z.string().trim().min(10, "Describe the music in a sentence or two.").max(400),
  mood: z.enum(MOODS),
  seconds: z.number().int().min(10, "At least 10 seconds.").max(60, "At most 60 seconds."),
});

/**
 * "Generate a track": ElevenLabs Music composes an original instrumental (owned by BuPulse on the paid plan, so no
 * credit line), paid through the AI ledger (feature "music", platform cap applies), checked like an upload, stored in
 * the music bucket and audited with its prompt. At most 20 a day.
 */
export async function generateTrack(ctx: AdminContext, raw: z.input<typeof generateSchema>) {
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) throw new AdminError("invalid", parsed.error.issues[0]?.message ?? "Check the track details.");
  const input = { ...parsed.data, prompt: parsed.data.prompt.replace(/[\u0000-\u001f\u007f]/g, " ") };
  try {
    await rateLimit("music-generate", GENERATE_PER_DAY);
  } catch (error) {
    if (error instanceof RateLimitError) throw new AdminError("conflict", "20 tracks were generated today. Try again tomorrow.");
    throw error;
  }
  const used = (await prisma.musicTrack.aggregate({ _sum: { bytes: true } }))._sum.bytes ?? 0;
  if (used + 2 * 1024 * 1024 > MUSIC_LIBRARY_MAX_BYTES) throw new AdminError("invalid", "The music library is full (80 MB). Remove a track first.");

  const result = await withLedger(
    { feature: "music" },
    { provider: "elevenlabs", model: ELEVENLABS_MUSIC_MODEL },
    () => composeMusic({ prompt: `${input.prompt} Instrumental, no vocals, ${MOOD_LABEL[input.mood].toLowerCase()} mood, for a short social media advert.`, seconds: input.seconds }),
    (r) => ({ provider: r.provider, model: r.model, usage: { inputTokens: r.seconds, outputTokens: 0 } }),
  );
  if (result.audio.length > TRACK_MAX_BYTES || sniffAudio(result.audio.subarray(0, 32)) !== "audio/mpeg") throw new AdminError("unavailable", "The music service answered with something that is not an MP3. Try again.");
  const path = `${globalThis.crypto.randomUUID()}.mp3`;
  const { error } = await createAdminClient().storage.from(MUSIC_BUCKET).upload(path, result.audio, { contentType: "audio/mpeg", upsert: false });
  if (error) throw new AdminError("unavailable", "Storage did not accept the track. Try again.");
  const row = await prisma.$transaction(async (tx) => {
    if (!(await libraryHasRoom(tx, result.audio.length))) return null;
    const row = await tx.musicTrack.create({
      data: { title: input.title, moods: [input.mood], bpm: null, licence: ELEVENLABS_MUSIC_LICENCE, sourceUrl: ELEVENLABS_MUSIC_SOURCE, attribution: "", path, mimeType: "audio/mpeg", bytes: result.audio.length, durationMs: input.seconds * 1000, createdBy: ctx.actor },
    });
    await writeAudit(tx, ctx, "generate_music_track", `music:${row.id}`, null, { title: row.title, mood: input.mood, seconds: input.seconds, prompt: input.prompt });
    return row;
  });
  if (!row) {
    await createAdminClient().storage.from(MUSIC_BUCKET).remove([path]).catch(() => {});
    throw new AdminError("invalid", "The music library is full (80 MB). Remove a track first.");
  }
  return row;
}
