import "server-only";
// Install a version from a signed zip (Admin -> Settings -> Updates, docs/UPDATES.md "Install from a zip").
//
// Only the owner (ADMIN_EMAILS, AAL2, in the console) may upload, install or restore, and only a zip signed with the
// owner's release key (scripts/release-core.mjs) can be installed: a stolen admin session alone cannot change the
// site. The browser uploads straight to the private "releases" bucket with a signed upload URL; the server then reads
// the zip once as a stream (sha256 and the zip's directory from its last bytes, never the whole file in memory),
// checks the signed manifest and every path, and records a ReleaseVersion. Install and Restore start the deploy
// workflow, which checks everything again with main's public key before running any of the zip's code.
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { GitHubClient, githubConfig, isActiveRun } from "@/lib/admin/github";
import { DEPLOY_ENVIRONMENT } from "@/lib/admin/updates";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import type { AdminIdentity } from "@/lib/admin/auth";
import { rateLimit, RateLimitError, type RateLimitRule } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectZipDirectory, missingRequired, parseSigFile, RELEASE_MAX_BYTES, resolvePublicKey, verifyManifest, ZIP_TAIL_BYTES } from "@/scripts/release-core.mjs";
import { RELEASE_PUBLIC_KEY } from "@/scripts/release-public-key.mjs";

export const RELEASES_BUCKET = "releases";
export const KEEP_DAYS = 30;
const DAY = 86_400_000;
const ZIP_PATH = /^zips\/[0-9a-f-]{36}\.zip$/;
export const UPLOAD_RULE: RateLimitRule = { limit: 10, windowSeconds: 3600 };
export const VERIFY_RULE: RateLimitRule = { limit: 20, windowSeconds: 3600 };

/** Only the owner from ADMIN_EMAILS, in the console (not a staff member, not Jarvis). */
export function assertOwner(ctx: AdminContext, identity: Pick<AdminIdentity, "isOwner" | "staffId">) {
  if (ctx.viaApi) throw new AdminError("forbidden", "Versions can only be installed by the owner in the admin console.");
  if (!identity.isOwner || identity.staffId) throw new AdminError("forbidden", "Only the owner can upload, install or restore a version.");
}

async function limit(key: string, rule: RateLimitRule, message: string) {
  try {
    await rateLimit(key, rule);
  } catch (e) {
    if (e instanceof RateLimitError) throw new AdminError("conflict", message);
    throw e;
  }
}

/** The release key in force, or an error saying how to set it up. */
export function releasePublicKey(env: string | undefined = process.env.RELEASE_PUBLIC_KEY): string {
  const key = resolvePublicKey(RELEASE_PUBLIC_KEY, env);
  if (!key) throw new AdminError("unavailable", "No release signing key is set up: run npm run release:zip -- --init and commit scripts/release-public-key.mjs (or set RELEASE_PUBLIC_KEY). If both are set they must be the same key.");
  return key;
}

/** Step 1: where the browser uploads the zip (a signed upload URL for a fresh path in the private bucket). */
export async function startReleaseUpload(ctx: AdminContext, identity: Pick<AdminIdentity, "isOwner" | "staffId">, input: { bytes: number }) {
  assertOwner(ctx, identity);
  releasePublicKey();
  if (!Number.isInteger(input.bytes) || input.bytes <= 0 || input.bytes > RELEASE_MAX_BYTES) throw new AdminError("invalid", `Choose a zip of at most ${RELEASE_MAX_BYTES / 1024 / 1024} MB.`);
  await limit("updates:upload", UPLOAD_RULE, "Ten uploads an hour at most. Try again later.");
  const path = `zips/${randomUUID()}.zip`;
  const { data, error } = await createAdminClient().storage.from(RELEASES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new AdminError("unavailable", "Storage did not give an upload address. Is the \"releases\" bucket there (docs/UPDATES.md)?");
  return { path, token: data.token };
}

export type ReadZip = { sha256: string; size: number; tail: Uint8Array; tailOffset: number };

/**
 * Reads a zip once as a stream: its sha256, its size and its last ZIP_TAIL_BYTES (where the directory is). Refuses a
 * file larger than the limit as soon as it passes it.
 */
export async function readZipStream(body: ReadableStream<Uint8Array>, max = RELEASE_MAX_BYTES): Promise<ReadZip> {
  const hash = createHash("sha256");
  const reader = body.getReader();
  let size = 0;
  let chunks: Uint8Array[] = [];
  let kept = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new AdminError("invalid", `The zip is larger than ${max / 1024 / 1024} MB.`);
    }
    hash.update(value);
    chunks.push(value);
    kept += value.byteLength;
    // Keep only what the tail needs (plus the chunk that crosses into it).
    while (chunks.length > 1 && kept - chunks[0].byteLength >= ZIP_TAIL_BYTES) {
      kept -= chunks[0].byteLength;
      chunks = chunks.slice(1);
    }
  }
  const joined = new Uint8Array(kept);
  let o = 0;
  for (const c of chunks) {
    joined.set(c, o);
    o += c.byteLength;
  }
  const tail = joined.subarray(Math.max(0, kept - ZIP_TAIL_BYTES));
  return { sha256: hash.digest("hex"), size, tail, tailOffset: size - tail.byteLength };
}

/**
 * Checks an uploaded zip against its .sig: the signature (release key), the manifest, the zip's size and sha256, and
 * every path in it. Pure apart from the key; throws AdminError with a plain message. Returns the manifest.
 */
export async function checkRelease(zip: ReadZip, sigText: string, publicKey: string) {
  let sig;
  try {
    sig = parseSigFile(sigText);
  } catch (e) {
    throw new AdminError("invalid", e instanceof Error ? e.message : "The .sig file cannot be read.");
  }
  if (!(await verifyManifest(sig.manifest, sig.signature, publicKey))) throw new AdminError("invalid", "The signature is not valid for the owner's release key. Build the zip with npm run release:zip on the owner's computer.");
  if (zip.size !== sig.manifest.size || zip.sha256 !== sig.manifest.sha256) throw new AdminError("invalid", "The zip is not the one that was signed (its size or sha256 differs). Upload the zip and the .sig made together.");
  let names: string[];
  try {
    names = inspectZipDirectory(zip.tail, zip.tailOffset, zip.size);
  } catch (e) {
    throw new AdminError("invalid", e instanceof Error ? e.message : "The zip cannot be read.");
  }
  const missing = missingRequired(names);
  if (missing.length) throw new AdminError("invalid", `This zip lacks ${missing.join(", ")}: it is not a BuPulse source release.`);
  return sig;
}

/** Step 2: after the upload, check the zip and its .sig and record the version (status "verified"). Audited. */
export async function verifyUploadedRelease(ctx: AdminContext, identity: Pick<AdminIdentity, "isOwner" | "staffId">, input: { path: string; sig: string; notes?: string }) {
  assertOwner(ctx, identity);
  if (!ZIP_PATH.test(input.path)) throw new AdminError("invalid", "Unknown upload.");
  if (input.sig.length > 4000) throw new AdminError("invalid", "That is not a .sig file.");
  const key = releasePublicKey();
  await limit("updates:verify", VERIFY_RULE, "Too many checks this hour. Try again later.");
  const storage = createAdminClient().storage.from(RELEASES_BUCKET);
  const remove = () => storage.remove([input.path]).catch(() => undefined);
  const { data: link, error } = await storage.createSignedUrl(input.path, 120);
  if (error || !link?.signedUrl) throw new AdminError("not_found", "The upload was not found. Upload the zip again.");
  const res = await fetch(link.signedUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new AdminError("unavailable", "The upload could not be read back from Storage. Try again.");
  let sig;
  let zip: ReadZip;
  try {
    zip = await readZipStream(res.body);
    sig = await checkRelease(zip, input.sig, key);
  } catch (e) {
    // A zip that failed the checks is not kept.
    await remove();
    throw e;
  }
  const notes = input.notes?.trim().slice(0, 500) || null;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.releaseVersion.create({
      data: { version: sig.manifest.version, commit: sig.manifest.commit, sha256: zip.sha256, size: zip.size, zipPath: input.path, manifest: { manifest: sig.manifest, signature: sig.signature }, notes, status: "verified", uploadedBy: ctx.actor },
    });
    await writeAudit(tx, ctx, "upload_release", `release_version:${created.id}`, null, { version: created.version, commit: created.commit, sha256: created.sha256, size: created.size, notes });
    return created;
  });
  return { id: row.id, version: row.version, commit: row.commit };
}

/** `UPDATES_DRY_RUN=1` (the test machine): everything happens and is audited, but the workflow is not started. */
export const isDryRun = (env: Record<string, string | undefined> = process.env) => env.UPDATES_DRY_RUN === "1";

async function dispatch(inputs: Parameters<GitHubClient["dispatchDeploy"]>[0]) {
  if (isDryRun()) return { dryRun: true as const };
  const cfg = githubConfig();
  if (!cfg) throw new AdminError("unavailable", "Updates are not connected: set GITHUB_REPO and GITHUB_TOKEN (docs/UPDATES.md).");
  const gh = new GitHubClient(cfg);
  const running = (await gh.listDeployRuns(10)).find(isActiveRun);
  if (running) throw new AdminError("conflict", `A deploy is already ${running.status === "in_progress" ? "running" : "queued"} (run #${running.id}). Wait for it to finish.`);
  await gh.dispatchDeploy(inputs);
  return { dryRun: false as const };
}

function confirmVersion(version: string, typed: string) {
  if (typed.trim().replace(/^v/i, "") !== version) throw new AdminError("invalid", `Type the version exactly as shown (${version}) to confirm.`);
}

/** Install: the deploy workflow with action deploy-zip (it checks the zip again, backs up the database, migrates, deploys). */
export async function installRelease(ctx: AdminContext, identity: Pick<AdminIdentity, "isOwner" | "staffId">, input: { id: string; typed: string }) {
  assertOwner(ctx, identity);
  const row = await prisma.releaseVersion.findUnique({ where: { id: input.id } });
  if (!row) throw new AdminError("not_found", "No such version.");
  confirmVersion(row.version, input.typed);
  if (row.zipPurgedAt) throw new AdminError("conflict", "This version's zip was removed after 30 days. Upload it again.");
  if (row.status === "installing") throw new AdminError("conflict", "This version is being installed already.");
  await limit("admin-updates:dispatch", { limit: 1, windowSeconds: 60 }, "A deploy was started less than a minute ago. Give GitHub a moment, then refresh.");
  const started = await dispatch({ ref: "main", action: "deploy-zip", environment: DEPLOY_ENVIRONMENT, zip_path: row.zipPath, zip_sha256: row.sha256, release_id: row.id });
  await prisma.$transaction(async (tx) => {
    await tx.releaseVersion.update({ where: { id: row.id }, data: { status: started.dryRun ? row.status : "installing", installRequestedAt: new Date(), installRequestedBy: ctx.actor, error: started.dryRun ? "Dry run: the workflow was not started (UPDATES_DRY_RUN=1)." : null } });
    await writeAudit(tx, ctx, "install_release", `release_version:${row.id}`, { status: row.status }, { version: row.version, sha256: row.sha256, action: "deploy-zip", dryRun: started.dryRun });
  });
  return { version: row.version, dryRun: started.dryRun };
}

/**
 * Restore: put an earlier installed version back. Cloudflare keeps the Worker version (wrangler versions deploy); when
 * it is gone, or on Netlify, the stored zip is installed again. Database changes are never undone.
 */
export async function restoreRelease(ctx: AdminContext, identity: Pick<AdminIdentity, "isOwner" | "staffId">, input: { id: string; typed: string }) {
  assertOwner(ctx, identity);
  const row = await prisma.releaseVersion.findUnique({ where: { id: input.id } });
  if (!row || !row.installedAt) throw new AdminError("not_found", "Only a version that was installed can be restored.");
  confirmVersion(row.version, input.typed);
  if (row.status === "installed") throw new AdminError("conflict", `${row.version} is the version running now.`);
  const useZip = !row.cloudflareVersionId;
  if (useZip && row.zipPurgedAt) throw new AdminError("conflict", "Neither the Cloudflare version nor the zip of this version is kept any more.");
  await limit("admin-updates:dispatch", { limit: 1, windowSeconds: 60 }, "A deploy was started less than a minute ago. Give GitHub a moment, then refresh.");
  const started = await dispatch(
    useZip
      ? { ref: "main", action: "deploy-zip", environment: DEPLOY_ENVIRONMENT, zip_path: row.zipPath, zip_sha256: row.sha256, release_id: row.id }
      : { ref: "main", action: "restore", environment: DEPLOY_ENVIRONMENT, release_id: row.id, cf_version_id: row.cloudflareVersionId as string, zip_path: row.zipPath, zip_sha256: row.sha256 },
  );
  await prisma.$transaction(async (tx) => {
    await tx.releaseVersion.update({ where: { id: row.id }, data: { status: started.dryRun ? row.status : "installing", installRequestedAt: new Date(), installRequestedBy: ctx.actor, error: started.dryRun ? "Dry run: the workflow was not started (UPDATES_DRY_RUN=1)." : null } });
    await writeAudit(tx, ctx, "restore_release", `release_version:${row.id}`, null, { version: row.version, via: useZip ? "zip" : "cloudflare_version", cloudflareVersionId: row.cloudflareVersionId, dryRun: started.dryRun });
  });
  return { version: row.version, via: useZip ? ("zip" as const) : ("cloudflare" as const), dryRun: started.dryRun };
}

export type ReleaseRow = Awaited<ReturnType<typeof listReleases>>[number];

/** The versions of the last 30 days, plus the current and the previous installed ones whatever their age. */
export async function listReleases(now = new Date()) {
  const since = new Date(now.getTime() - KEEP_DAYS * DAY);
  const [recent, kept] = await Promise.all([
    prisma.releaseVersion.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }),
    protectedIds(),
  ]);
  const extra = kept.filter((id) => !recent.some((r) => r.id === id));
  const older = extra.length ? await prisma.releaseVersion.findMany({ where: { id: { in: extra } } }) : [];
  return [...recent, ...older].map((r) => ({
    id: r.id,
    version: r.version,
    commit: r.commit,
    sha256: r.sha256,
    size: r.size,
    status: r.status,
    notes: r.notes,
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt.toISOString(),
    installedAt: r.installedAt?.toISOString() ?? null,
    installRequestedBy: r.installRequestedBy,
    cloudflareVersionId: r.cloudflareVersionId,
    zipPath: r.zipPurgedAt ? null : r.zipPath,
    backupPath: r.backupPurgedAt ? null : r.backupPath,
    error: r.error,
    current: kept[0] === r.id,
  }));
}

/** The current and the previous installed versions (newest install first): never purged. */
async function protectedIds(): Promise<string[]> {
  const rows = await prisma.releaseVersion.findMany({ where: { installedAt: { not: null } }, orderBy: { installedAt: "desc" }, take: 2, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Pure: which stored files to delete. Older than 30 days and not the current or previous installed version. */
export function releasesToPurge<T extends { id: string; createdAt: Date; zipPurgedAt: Date | null; backupPath: string | null; backupPurgedAt: Date | null }>(rows: T[], keep: string[], now: Date): T[] {
  const cutoff = now.getTime() - KEEP_DAYS * DAY;
  return rows.filter((r) => r.createdAt.getTime() < cutoff && !keep.includes(r.id) && (!r.zipPurgedAt || (r.backupPath && !r.backupPurgedAt)));
}

/** The daily clean-up (the media-cleanup cron): zips and database backups older than 30 days. Never throws. */
export async function cleanupReleases(now = new Date()): Promise<{ purged: number }> {
  try {
    const [rows, keep] = await Promise.all([
      prisma.releaseVersion.findMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY) } }, take: 200 }),
      protectedIds(),
    ]);
    const purge = releasesToPurge(rows, keep, now);
    if (!purge.length) return { purged: 0 };
    const storage = createAdminClient().storage.from(RELEASES_BUCKET);
    const paths = purge.flatMap((r) => [r.zipPurgedAt ? null : r.zipPath, r.backupPath && !r.backupPurgedAt ? r.backupPath : null]).filter((p): p is string => !!p);
    const { error } = await storage.remove(paths);
    if (error) return { purged: 0 };
    await prisma.releaseVersion.updateMany({ where: { id: { in: purge.map((r) => r.id) } }, data: { zipPurgedAt: now } });
    await prisma.releaseVersion.updateMany({ where: { id: { in: purge.filter((r) => r.backupPath).map((r) => r.id) } }, data: { backupPurgedAt: now } });
    return { purged: purge.length };
  } catch {
    return { purged: 0 };
  }
}
