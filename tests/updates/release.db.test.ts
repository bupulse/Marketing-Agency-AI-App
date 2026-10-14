import { execFileSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Upload -> verify -> Install against the real TEST project (Storage bucket "releases", ReleaseVersion, audit log),
// with the workflow dispatch off (UPDATES_DRY_RUN=1). Skipped unless asked for, and refuses any project but the test:
//   RUN_DB_TESTS=1 node --env-file=<v2 .env> node_modules/vitest/vitest.mjs run tests/updates/release.db.test.ts

const TEST_REF = "rzlcizxnhtfqminqkphp";
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL?.includes(TEST_REF) && process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(TEST_REF) && process.env.SUPABASE_SECRET_KEY);

describe.skipIf(!enabled)("install from a signed zip, on the test project", { timeout: 180_000 }, () => {
  let zip: Buffer;
  let sig = "";
  const created: string[] = [];
  const owner = { isOwner: true, staffId: null };
  const ctx = { actor: "admin", ip: null, viaApi: false };

  beforeAll(async () => {
    process.env.UPDATES_DRY_RUN = "1";
    const { canonicalManifest, toB64 } = await import("@/scripts/release-core.mjs");
    const pair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
    process.env.RELEASE_PUBLIC_KEY = toB64(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
    // The real thing: git archive of this checkout, signed like npm run release:zip does.
    const { archiveArgs } = await import("@/scripts/release-core.mjs");
    const out = `${process.env.TMPDIR ?? "/tmp"}/bp-release-e2e-${Date.now()}.zip`;
    execFileSync("git", archiveArgs(execFileSync("git", ["ls-files", "-s"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }), out).args);
    zip = readFileSync(out);
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const version = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8" })).version;
    const manifest = { format: 1, name: "bupulse", version, commit, sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length, created: new Date().toISOString() };
    const signature = toB64(new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(canonicalManifest(manifest)))));
    sig = JSON.stringify({ manifest, signature });
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.releaseVersion.findMany({ where: { id: { in: created } }, select: { zipPath: true } });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false } });
    if (rows.length) await admin.storage.from("releases").remove(rows.map((r) => r.zipPath));
    await prisma.releaseVersion.deleteMany({ where: { id: { in: created } } });
  });

  /** The browser's part: the signed upload address, with the public key only (like the console's upload form). */
  async function upload(bytes: Buffer) {
    const { startReleaseUpload } = await import("@/lib/updates/releases");
    const target = await startReleaseUpload(ctx, owner, { bytes: bytes.length });
    const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, { auth: { persistSession: false } });
    const { error } = await browser.storage.from("releases").uploadToSignedUrl(target.path, target.token, new Blob([new Uint8Array(bytes)], { type: "application/zip" }), { contentType: "application/zip" });
    expect(error).toBeNull();
    return target.path;
  }

  it("uploads, verifies and installs (dry run), audited", async () => {
    const { verifyUploadedRelease, installRelease, listReleases } = await import("@/lib/updates/releases");
    const { prisma } = await import("@/lib/db");
    const path = await upload(zip);
    const row = await verifyUploadedRelease(ctx, owner, { path, sig, notes: "Release e2e test" });
    created.push(row.id);
    expect(row.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await listReleases()).find((r) => r.id === row.id)).toMatchObject({ status: "verified", zipPath: path });
    await expect(installRelease(ctx, owner, { id: row.id, typed: "0.0.0" })).rejects.toThrow(/Type the version/);
    const done = await installRelease(ctx, owner, { id: row.id, typed: row.version });
    expect(done.dryRun).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { target: `release_version:${row.id}` }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(["install_release", "upload_release"]);
  });

  it("refuses a tampered zip and deletes the upload", async () => {
    const { verifyUploadedRelease } = await import("@/lib/updates/releases");
    const tampered = Buffer.concat([zip.subarray(0, 1000), Buffer.from("x"), zip.subarray(1001)]);
    const path = await upload(tampered);
    await expect(verifyUploadedRelease(ctx, owner, { path, sig })).rejects.toThrow(/not the one that was signed/);
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false } });
    const { data } = await admin.storage.from("releases").list("zips", { search: path.slice(5) });
    expect(data ?? []).toHaveLength(0);
  });
});
