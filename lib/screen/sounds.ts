// Celebration sounds for the sales room TV (Admin -> Organisation -> Sales screen). MP3s of at most 1 MB in the private
// "sounds" bucket (no policy names it: only the service key reads and writes; the screen gets short-lived signed URLs).
// At most 10 active; the screen plays them in turn, one per new payment. A sound is uploaded by the owner, who confirms
// holding its rights, or generated with ElevenLabs Sound Effects (paid through the AI cost ledger).
import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { withLedger } from "@/lib/ai/ledger";
import { AIProviderError } from "@/lib/ai/types";
import { prisma } from "@/lib/db";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMp3, MAX_ACTIVE_SOUNDS, SOUND_MAX_BYTES, SOUND_MAX_SECONDS, soundUploadProblem } from "./shared";

export const SOUNDS_BUCKET = "sounds";
/** The ledger's model name for ElevenLabs Sound Effects (priced in lib/ai/pricing.ts). */
export const ELEVENLABS_SFX_MODEL = "sound_effects";
const SFX_URL = "https://api.elevenlabs.io/v1/sound-generation";
const PATH = /^[0-9a-f-]{36}\.mp3$/;

export type SoundEffect = { audio: Uint8Array; seconds: number; provider: "elevenlabs"; model: string };

/**
 * One sound effect from ElevenLabs (POST /v1/sound-generation; the answer is audio/mpeg). ELEVENLABS_API_KEY is read
 * here, sent only in the xi-api-key header and never logged; errors keep only the HTTP status.
 */
export async function generateSoundEffect(prompt: string, seconds: number, fetchImpl: typeof fetch = fetch): Promise<SoundEffect> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new AIProviderError("ElevenLabs is not set up", "elevenlabs", false, undefined, ELEVENLABS_SFX_MODEL);
  const text = prompt.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 450);
  if (!text) throw new AIProviderError("Describe the sound", "elevenlabs", false, undefined, ELEVENLABS_SFX_MODEL);
  const duration = Math.min(SOUND_MAX_SECONDS, Math.max(0.5, Math.round(seconds * 10) / 10));
  let response: Response;
  try {
    response = await fetchImpl(SFX_URL, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, duration_seconds: duration, prompt_influence: 0.5 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AIProviderError("The sound service did not answer", "elevenlabs", true, timedOut ? { inputTokens: duration, outputTokens: 0 } : undefined, ELEVENLABS_SFX_MODEL, undefined, timedOut);
  }
  if (!response.ok) throw new AIProviderError(`The sound service refused the request (${response.status})`, "elevenlabs", response.status === 429 || response.status >= 500, { inputTokens: 0, outputTokens: 0 }, ELEVENLABS_SFX_MODEL);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.length === 0) throw new AIProviderError("The sound service answered without audio", "elevenlabs", true, undefined, ELEVENLABS_SFX_MODEL);
  return { audio, seconds: duration, provider: "elevenlabs", model: ELEVENLABS_SFX_MODEL };
}

const bucket = () => createAdminClient().storage.from(SOUNDS_BUCKET);

export async function listSounds() {
  return prisma.soundClip.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }], take: 200 });
}

/** Rotation order: oldest first. */
async function activeSoundRows() {
  return prisma.soundClip.findMany({ where: { active: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_ACTIVE_SOUNDS, select: { id: true, path: true } });
}

const SIGNED_SECONDS = 60 * 60;
let signedCache: { at: number; key: string; sounds: { id: string; url: string }[] } | null = null;

/**
 * The active sounds with signed URLs (an hour), for the screen. Signed again every 30 minutes or when the list
 * changes, so ten screens polling every 10 s do not sign ten files each time. Best effort: no sounds on failure.
 */
export async function activeSoundUrls(now = Date.now()): Promise<{ id: string; url: string }[]> {
  try {
    const rows = await activeSoundRows();
    const key = rows.map((r) => r.id).join(",");
    if (signedCache && signedCache.key === key && now - signedCache.at < 30 * 60 * 1000) return signedCache.sounds;
    if (rows.length === 0) return [];
    const { data, error } = await bucket().createSignedUrls(rows.map((r) => r.path), SIGNED_SECONDS);
    if (error || !data) return [];
    const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
    const sounds = rows.flatMap((r) => (byPath.get(r.path) ? [{ id: r.id, url: byPath.get(r.path) as string }] : []));
    signedCache = { at: now, key, sounds };
    return sounds;
  } catch {
    return [];
  }
}

/** A signed URL to play one sound on the admin page. */
export async function soundPlayUrl(path: string): Promise<string | null> {
  const { data } = await bucket().createSignedUrl(path, 30 * 60).catch(() => ({ data: null }));
  return data?.signedUrl ?? null;
}

type Tx = Pick<typeof prisma, "soundClip" | "$executeRaw">;

/** Under a transaction-wide lock: how many sounds are active, so two saves at once cannot pass the limit of 10. */
async function lockedActiveCount(tx: Tx): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('screen-sounds'))`;
  return tx.soundClip.count({ where: { active: true } });
}

function fail(message: string): never {
  throw new AdminError("invalid", message);
}

/** Step 1 of an upload: rights, size and room are checked, then a signed upload URL for a new file name. */
export async function startSoundUpload(file: { bytes: number; rights: boolean }) {
  const problem = soundUploadProblem({ bytes: file.bytes, rights: file.rights, activeCount: await prisma.soundClip.count({ where: { active: true } }) });
  if (problem) fail(problem);
  const path = `${globalThis.crypto.randomUUID()}.mp3`;
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new AdminError("unavailable", "Storage did not accept the upload. Try again.");
  return { path: data.path, token: data.token };
}

export const soundNameSchema = z.string().trim().min(1, "Give the sound a name.").max(60, "Keep the name under 60 characters.");

/**
 * Step 2: the file is in the bucket. Its size and first bytes are checked (an MP3 of at most 1 MB), the limit of 10
 * active sounds is checked again under a lock, then the sound is saved and audited. A file that fails is deleted.
 */
export async function finishSoundUpload(ctx: AdminContext, path: string, input: { name: string; rights: boolean }) {
  if (!PATH.test(path)) fail("That upload could not be used.");
  const reject = async (message: string): Promise<never> => {
    await bucket().remove([path]).catch(() => {});
    throw new AdminError("invalid", message);
  };
  const name = soundNameSchema.safeParse(input?.name);
  if (!name.success) return reject(name.error.issues[0]?.message ?? "Give the sound a name.");
  const { data: blob, error } = await bucket().download(path);
  if (error || !blob) throw new AdminError("not_found", "The file did not arrive. Upload it again.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const problem = soundUploadProblem({ bytes: bytes.length, rights: input.rights === true, activeCount: 0, head: bytes.subarray(0, 4) });
  if (problem) return reject(problem);
  const row = await prisma.$transaction(async (tx) => {
    if ((await lockedActiveCount(tx)) >= MAX_ACTIVE_SOUNDS) return null;
    const row = await tx.soundClip.create({ data: { name: name.data, path, source: "upload", bytes: bytes.length, createdBy: ctx.actor } });
    await writeAudit(tx, ctx, "create_sound", `sound:${row.id}`, null, { name: row.name, source: "upload", bytes: row.bytes, rights: true });
    return row;
  });
  return row ?? reject(`There are already ${MAX_ACTIVE_SOUNDS} active sounds. Deactivate or delete one first.`);
}

/** Sounds the admin may generate a day (each one is paid). */
export const SOUNDS_PER_DAY = { limit: 20, windowSeconds: 24 * 60 * 60 } as const;

export const generateSoundSchema = z.object({
  name: soundNameSchema,
  prompt: z.string().trim().min(8, "Describe the sound in a few words.").max(300),
  seconds: z.number().min(1, "At least 1 second.").max(SOUND_MAX_SECONDS, `At most ${SOUND_MAX_SECONDS} seconds.`),
});

/**
 * "Generate a sound": ElevenLabs Sound Effects makes an original clip, paid through the AI ledger (provider
 * elevenlabs, seconds recorded as input tokens), checked like an upload, stored and audited with its prompt. 20 a day.
 */
export async function generateSound(ctx: AdminContext, raw: z.input<typeof generateSoundSchema>) {
  const parsed = generateSoundSchema.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Check the sound details.");
  const input = parsed.data;
  if ((await prisma.soundClip.count({ where: { active: true } })) >= MAX_ACTIVE_SOUNDS) fail(`There are already ${MAX_ACTIVE_SOUNDS} active sounds. Deactivate or delete one first.`);
  try {
    await rateLimit("screen-sound-generate", SOUNDS_PER_DAY);
  } catch (error) {
    if (error instanceof RateLimitError) throw new AdminError("conflict", "20 sounds were generated today. Try again tomorrow.");
    throw error;
  }
  const result = await withLedger(
    { feature: "screen_sound" },
    { provider: "elevenlabs", model: ELEVENLABS_SFX_MODEL },
    () => generateSoundEffect(input.prompt, input.seconds),
    (r) => ({ provider: r.provider, model: r.model, usage: { inputTokens: r.seconds, outputTokens: 0 } }),
  );
  if (result.audio.length > SOUND_MAX_BYTES || !isMp3(result.audio.subarray(0, 4))) throw new AdminError("unavailable", "The sound service answered with something that is not an MP3. Try again.");
  const path = `${globalThis.crypto.randomUUID()}.mp3`;
  const { error } = await bucket().upload(path, result.audio, { contentType: "audio/mpeg", upsert: false });
  if (error) throw new AdminError("unavailable", "Storage did not accept the sound. Try again.");
  const row = await prisma.$transaction(async (tx) => {
    if ((await lockedActiveCount(tx)) >= MAX_ACTIVE_SOUNDS) return null;
    const row = await tx.soundClip.create({ data: { name: input.name, path, source: "generated", prompt: input.prompt, bytes: result.audio.length, durationMs: Math.round(result.seconds * 1000), createdBy: ctx.actor } });
    await writeAudit(tx, ctx, "generate_sound", `sound:${row.id}`, null, { name: row.name, prompt: input.prompt, seconds: result.seconds });
    return row;
  });
  if (!row) {
    await bucket().remove([path]).catch(() => {});
    fail(`There are already ${MAX_ACTIVE_SOUNDS} active sounds. Deactivate or delete one first.`);
  }
  return row;
}

/** Turns a sound on or off. Turning one on checks the limit of 10 under the lock. */
export async function setSoundActive(ctx: AdminContext, id: string, active: boolean) {
  await prisma.$transaction(async (tx) => {
    if (active && (await lockedActiveCount(tx)) >= MAX_ACTIVE_SOUNDS) fail(`There are already ${MAX_ACTIVE_SOUNDS} active sounds. Deactivate one first.`);
    const { count } = await tx.soundClip.updateMany({ where: { id }, data: { active } });
    if (count === 0) throw new AdminError("not_found", "That sound is gone.");
    await writeAudit(tx, ctx, "update_sound", `sound:${id}`, null, { active });
  });
}

/** Removes a sound and its file. */
export async function deleteSound(ctx: AdminContext, id: string) {
  const row = await prisma.soundClip.findUnique({ where: { id } });
  if (!row) throw new AdminError("not_found", "That sound is gone.");
  await prisma.$transaction(async (tx) => {
    await tx.soundClip.delete({ where: { id } });
    await writeAudit(tx, ctx, "delete_sound", `sound:${id}`, { name: row.name, source: row.source }, null);
  });
  await bucket().remove([row.path]).catch(() => {});
}

/** Files no sound refers to (an upload never finished), older than an hour: deleted when the page opens. Best effort. */
export async function cleanupSoundOrphans(now = new Date()): Promise<number> {
  try {
    const { data: files } = await bucket().list("", { limit: 1000 });
    const old = (files ?? []).filter((f) => f.id && f.created_at && now.getTime() - new Date(f.created_at).getTime() > 60 * 60 * 1000).map((f) => f.name);
    if (old.length === 0) return 0;
    const known = new Set((await prisma.soundClip.findMany({ where: { path: { in: old } }, select: { path: true } })).map((s) => s.path));
    const orphans = old.filter((p) => !known.has(p));
    if (orphans.length) await bucket().remove(orphans);
    return orphans.length;
  } catch {
    return 0;
  }
}
