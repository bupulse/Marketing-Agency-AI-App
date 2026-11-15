// The Ad Brain's files: the private "ad-brain" bucket (no Storage policies, only the server's key) and the AdAsset
// cache keyed by the SHA-256 of what was asked, so a frame, clip or track asked for again is reused, never paid twice.
import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const AD_BUCKET = "ad-brain";

/** The cache key of an asset: what was asked (kind, model, prompt, the hashes of its inputs). */
export function assetHash(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

export async function uploadFile(objectPath: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const { error } = await createAdminClient().storage.from(AD_BUCKET).upload(objectPath, new Blob([new Uint8Array(bytes)], { type: mimeType }), { contentType: mimeType, upsert: true });
  if (error) throw new Error(`The file could not be saved (${error.message}).`);
}

export async function downloadFile(objectPath: string): Promise<Buffer> {
  const { data, error } = await createAdminClient().storage.from(AD_BUCKET).download(objectPath);
  if (error || !data) throw new Error(`A saved file could not be read (${objectPath}).`);
  return Buffer.from(await data.arrayBuffer());
}

export type CachedAsset = { id: string; hash: string; path: string; mimeType: string; seconds: number | null; meta: Record<string, unknown> };

export async function findAsset(hash: string): Promise<CachedAsset | null> {
  const row = await prisma.adAsset.findUnique({ where: { hash }, select: { id: true, hash: true, path: true, mimeType: true, seconds: true, meta: true } });
  return row ? { ...row, meta: (row.meta ?? {}) as Record<string, unknown> } : null;
}

/** Saves a made file and its cache row (one per hash: a parallel save of the same thing keeps the first). */
export async function saveAsset(input: { hash: string; jobId?: string | null; kind: string; provider: string; model?: string | null; bytes: Uint8Array; mimeType: string; seconds?: number | null; costUsd?: number; meta?: Record<string, unknown> }): Promise<CachedAsset> {
  const objectPath = `assets/${input.hash}.${EXT[input.mimeType] ?? "bin"}`;
  await uploadFile(objectPath, input.bytes, input.mimeType);
  try {
    const row = await prisma.adAsset.create({
      data: { hash: input.hash, jobId: input.jobId ?? null, kind: input.kind, provider: input.provider, model: input.model ?? null, path: objectPath, mimeType: input.mimeType, bytes: input.bytes.byteLength, seconds: input.seconds ?? null, costUsd: input.costUsd ?? 0, meta: (input.meta ?? {}) as Prisma.InputJsonValue },
      select: { id: true, hash: true, path: true, mimeType: true, seconds: true, meta: true },
    });
    return { ...row, meta: (row.meta ?? {}) as Record<string, unknown> };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const found = await findAsset(input.hash);
      if (found) return found;
    }
    throw error;
  }
}

/** Adds what was learned about a file later (its word timings, its tempo) to its cache row. */
export async function updateAssetMeta(id: string, meta: Record<string, unknown>, seconds?: number | null): Promise<void> {
  const row = await prisma.adAsset.findUnique({ where: { id }, select: { meta: true } });
  await prisma.adAsset.update({ where: { id }, data: { meta: { ...((row?.meta ?? {}) as Record<string, unknown>), ...meta } as Prisma.InputJsonValue, ...(seconds !== undefined ? { seconds } : {}) } });
}

/** The fixture folder (the 10 Nov 2026 prototype's cached files), for "fixture:" refs. */
export const fixtureDir = () => process.env.AD_BRAIN_FIXTURE_DIR?.trim() || path.join(/*turbopackIgnore: true*/ os.homedir(), "bupulse-ugc-ads");

/**
 * A local copy of an EDL asset for the renderer: "ad:<id>" and "store:<path>" are downloaded once into the job's
 * folder; "fixture:" and "repo:" are files on this computer.
 */
export async function localFile(ref: string, dir: string): Promise<string> {
  if (ref.startsWith("fixture:")) return safeJoin(fixtureDir(), ref.slice(8));
  if (ref.startsWith("repo:")) return safeJoin(process.cwd(), ref.slice(5));
  let objectPath: string;
  if (ref.startsWith("ad:")) {
    const row = await prisma.adAsset.findUnique({ where: { id: ref.slice(3) }, select: { path: true } });
    if (!row) throw new Error("A planned file is missing from the cache.");
    objectPath = row.path;
  } else if (ref.startsWith("store:")) objectPath = ref.slice(6);
  else throw new Error(`Unknown file reference "${ref.slice(0, 40)}".`);
  const file = path.join(/*turbopackIgnore: true*/ dir, "assets", objectPath.replace(/[^A-Za-z0-9._-]/g, "_"));
  try {
    await fs.access(file);
    return file;
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, await downloadFile(objectPath));
    return file;
  }
}

function safeJoin(root: string, rel: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("A file reference points outside its folder.");
  return full;
}
