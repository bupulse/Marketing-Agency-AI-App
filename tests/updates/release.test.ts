import { spawnSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Installing a version from a signed zip (docs/UPDATES.md, "Install from a zip"): only zips signed with the owner's
// release key, untouched, with safe paths, and only by the owner in the console with an authenticator code.

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), startReleaseUpload: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { canonicalManifest, inspectZipDirectory, manifestProblem, parseSigFile, resolvePublicKey, toB64, verifyManifest } from "@/scripts/release-core.mjs";
import { assertOwner, checkRelease, readZipStream, releasesToPurge, type ReadZip } from "@/lib/updates/releases";
import { consoleContext, apiContext } from "@/lib/admin/types";

// ---- a tiny zip writer (stored entries), so every case is built in the test ---------------------------------------

type Entry = { name: string; data?: string; mode?: number };
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function makeZip(entries: Entry[]): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = enc.encode(e.data ?? "");
    const crc = crc32(data);
    const offset = local.length;
    u32(local, 0x04034b50); u16(local, 20); u16(local, 0); u16(local, 0); u16(local, 0); u16(local, 0);
    u32(local, crc); u32(local, data.length); u32(local, data.length); u16(local, name.length); u16(local, 0);
    local.push(...name, ...data);
    u32(central, 0x02014b50); u16(central, (3 << 8) | 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0);
    u32(central, crc); u32(central, data.length); u32(central, data.length); u16(central, name.length); u16(central, 0); u16(central, 0);
    u16(central, 0); u16(central, 0); u32(central, ((e.mode ?? 0o100644) << 16) >>> 0); u32(central, offset);
    central.push(...name);
  }
  const eocd: number[] = [];
  u32(eocd, 0x06054b50); u16(eocd, 0); u16(eocd, 0); u16(eocd, entries.length); u16(eocd, entries.length);
  u32(eocd, central.length); u32(eocd, local.length); u16(eocd, 0);
  return new Uint8Array([...local, ...central, ...eocd]);
}

const RELEASE_FILES: Entry[] = [
  { name: "package.json", data: JSON.stringify({ name: "bupulse", version: "2.1.0" }) },
  { name: "package-lock.json", data: "{}" },
  { name: "next.config.ts", data: "export default {};" },
  { name: "prisma/", mode: 0o040755 },
  { name: "prisma/schema.prisma", data: "// schema" },
];

let publicKey = "";
let otherKey = "";
let privateKey: CryptoKey;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function sign(zip: Uint8Array, over: Record<string, unknown> = {}, key = privateKey) {
  const manifest = { format: 1, name: "bupulse", version: "2.1.0", commit: "a".repeat(40), sha256: sha(zip), size: zip.length, created: "2026-10-19T08:00:00.000Z", ...over };
  const signature = toB64(new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(canonicalManifest(manifest as never)))));
  return JSON.stringify({ manifest, signature });
}
const asRead = (zip: Uint8Array): ReadZip => ({ sha256: sha(zip), size: zip.length, tail: zip, tailOffset: 0 });

beforeAll(async () => {
  const pair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKey = toB64(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
  const other = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
  otherKey = toB64(new Uint8Array(await webcrypto.subtle.exportKey("raw", other.publicKey)));
});

describe("the signature", () => {
  it("accepts a zip signed with the release key", async () => {
    const zip = makeZip(RELEASE_FILES);
    const sig = await checkRelease(asRead(zip), await sign(zip), publicKey);
    expect(sig.manifest.version).toBe("2.1.0");
  });
  it("refuses a signature from another key", async () => {
    const zip = makeZip(RELEASE_FILES);
    await expect(checkRelease(asRead(zip), await sign(zip), otherKey)).rejects.toThrow(/not valid for the owner's release key/);
  });
  it("refuses a missing or malformed signature", async () => {
    const zip = makeZip(RELEASE_FILES);
    const { manifest } = JSON.parse(await sign(zip));
    await expect(checkRelease(asRead(zip), JSON.stringify({ manifest }), publicKey)).rejects.toThrow(/signature is missing/);
    await expect(checkRelease(asRead(zip), "not json", publicKey)).rejects.toThrow(/not valid JSON/);
  });
  it("refuses a manifest changed after signing", async () => {
    const zip = makeZip(RELEASE_FILES);
    const data = JSON.parse(await sign(zip));
    data.manifest.version = "9.9.9";
    expect(await verifyManifest(data.manifest, data.signature, publicKey)).toBe(false);
  });
  it("uses the repository key, else the environment's, and refuses two different keys", () => {
    expect(resolvePublicKey("", publicKey)).toBe(publicKey);
    expect(resolvePublicKey(publicKey, undefined)).toBe(publicKey);
    expect(resolvePublicKey(publicKey, otherKey)).toBeNull();
    expect(resolvePublicKey("", "")).toBeNull();
  });
  it("validates the manifest", () => {
    expect(manifestProblem({ format: 1, name: "bupulse", version: "2.1", commit: "a".repeat(40), sha256: "b".repeat(64), size: 1, created: "2026-10-19T00:00:00Z" })).toMatch(/version/);
    expect(() => parseSigFile(JSON.stringify({ manifest: { format: 1 }, signature: "x" }))).toThrow();
  });
});

describe("the zip itself", () => {
  it("refuses a tampered zip (it is not the one that was signed)", async () => {
    const zip = makeZip(RELEASE_FILES);
    const sig = await sign(zip);
    const tampered = makeZip([...RELEASE_FILES, { name: "app/evil.ts", data: "steal()" }]);
    await expect(checkRelease(asRead(tampered), sig, publicKey)).rejects.toThrow(/not the one that was signed/);
  });
  it.each([
    ["../outside.txt", /parent folder/],
    ["app/../../etc/passwd", /parent folder/],
    ["/etc/passwd", /absolute path/],
    ["C:/windows/x", /drive letter/],
    ["app\\evil.ts", /backslash/],
  ])("refuses zip-slip paths: %s", async (name, why) => {
    const zip = makeZip([...RELEASE_FILES, { name, data: "x" }]);
    await expect(checkRelease(asRead(zip), await sign(zip), publicKey)).rejects.toThrow(why);
  });
  it("refuses symbolic links and duplicates", () => {
    expect(() => inspectZipDirectory(makeZip([{ name: "link", data: "/etc/passwd", mode: 0o120777 }]), 0, makeZip([{ name: "link", data: "/etc/passwd", mode: 0o120777 }]).length)).toThrow(/Symbolic links/);
    const dup = makeZip([{ name: "a.txt" }, { name: "A.txt" }]);
    expect(() => inspectZipDirectory(dup, 0, dup.length)).toThrow(/twice/);
  });
  it("refuses a zip that is not a BuPulse source release", async () => {
    const zip = makeZip([{ name: "readme.txt", data: "hi" }]);
    await expect(checkRelease(asRead(zip), await sign(zip), publicKey)).rejects.toThrow(/lacks package.json/);
  });
  it("is read as a stream: hash and size of the whole, only the tail kept, too large refused", async () => {
    const zip = makeZip(RELEASE_FILES);
    const stream = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
    const read = await readZipStream(stream([zip.subarray(0, 50), zip.subarray(50)]));
    expect(read.sha256).toBe(sha(zip));
    expect(read.size).toBe(zip.length);
    expect(inspectZipDirectory(read.tail, read.tailOffset, read.size)).toContain("package.json");
    await expect(readZipStream(stream([new Uint8Array(100)]), 50)).rejects.toThrow(/larger than/);
  });
});

describe("who may install", () => {
  it("only the owner from ADMIN_EMAILS, in the console", () => {
    expect(() => assertOwner(consoleContext(), { isOwner: true, staffId: null })).not.toThrow();
    expect(() => assertOwner(consoleContext(), { isOwner: false, staffId: "s1" })).toThrow(/Only the owner/);
    expect(() => assertOwner(consoleContext(), { isOwner: true, staffId: "s1" })).toThrow(/Only the owner/);
    expect(() => assertOwner(apiContext("k", null, "all"), { isOwner: true, staffId: null })).toThrow(/admin console/);
  });
});

describe("keeping versions 30 days", () => {
  const now = new Date("2026-11-30T00:00:00Z");
  const row = (id: string, daysAgo: number, over: Partial<{ zipPurgedAt: Date | null; backupPath: string | null; backupPurgedAt: Date | null }> = {}) => ({ id, createdAt: new Date(now.getTime() - daysAgo * 86_400_000), zipPurgedAt: null, backupPath: `backups/${id}.dump`, backupPurgedAt: null, ...over });
  it("purges zips and backups older than 30 days, never the current or the previous installed version", () => {
    const rows = [row("old", 40), row("current", 60), row("previous", 50), row("recent", 10), row("done", 45, { zipPurgedAt: now, backupPurgedAt: now })];
    expect(releasesToPurge(rows, ["current", "previous"], now).map((r) => r.id)).toEqual(["old"]);
  });
});

describe("the workflow's check (scripts/verify-release.mjs)", () => {
  const unzip = spawnSync("unzip", ["-v"]).status === 0;
  const run = (zip: Uint8Array, sig: string, expected: string) => {
    const dir = mkdtempSync(join(tmpdir(), "bp-release-"));
    writeFileSync(join(dir, "r.zip"), zip);
    writeFileSync(join(dir, "r.sig"), sig);
    const r = spawnSync(process.execPath, ["scripts/verify-release.mjs", join(dir, "r.zip"), join(dir, "r.sig"), expected, join(dir, "out")], { env: { ...process.env, RELEASE_PUBLIC_KEY: publicKey }, encoding: "utf8" });
    return { ...r, dir };
  };
  it.skipIf(!unzip)("unpacks a signed zip and prints its version and commit", async () => {
    const zip = makeZip(RELEASE_FILES);
    const r = run(zip, await sign(zip), sha(zip));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("version=2.1.0");
    expect(readdirSync(join(r.dir, "out")).sort()).toEqual(["next.config.ts", "package-lock.json", "package.json", "prisma"]);
  });
  it.skipIf(!unzip)("stops before unpacking a zip-slip, a tampered zip or another sha256", async () => {
    const slip = makeZip([...RELEASE_FILES, { name: "../escape.txt", data: "x" }]);
    expect(run(slip, await sign(slip), sha(slip)).status).toBe(1);
    const zip = makeZip(RELEASE_FILES);
    const tampered = makeZip([...RELEASE_FILES, { name: "x.ts" }]);
    expect(run(tampered, await sign(zip), sha(tampered)).status).toBe(1);
    expect(run(zip, await sign(zip), "0".repeat(64)).status).toBe(1);
  });
});

describe("the console actions", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    h.requireAdmin.mockReset();
    h.startReleaseUpload.mockReset();
  });
  it("send someone without an authenticator code to the code page before anything runs (AAL2)", async () => {
    vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
    vi.doMock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); }, notFound: () => { throw new Error("404"); } }));
    vi.doMock("@/lib/admin/auth", () => ({ requireAdmin: h.requireAdmin, requirePermission: h.requireAdmin, can: () => true }));
    vi.doMock("@/lib/updates/releases", () => ({ startReleaseUpload: h.startReleaseUpload, verifyUploadedRelease: vi.fn(), installRelease: vi.fn(), restoreRelease: vi.fn() }));
    h.requireAdmin.mockRejectedValue(new Error("redirect:/admin/verify"));
    const { startReleaseUploadAction } = await import("@/app/admin/(console)/(system)/settings/updates/actions");
    await expect(startReleaseUploadAction({ bytes: 100 })).rejects.toThrow("redirect:/admin/verify");
    expect(h.startReleaseUpload).not.toHaveBeenCalled();
  });
  it("refuse a staff member who has System (the owner only)", async () => {
    vi.doUnmock("@/lib/updates/releases");
    vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
    vi.doMock("@/lib/admin/auth", () => ({ requireAdmin: async () => ({ id: "u", email: "it@x.co", staffId: "s-it", isOwner: false, permissions: ["system"] }), requirePermission: async () => ({ id: "u", email: "it@x.co", staffId: "s-it", isOwner: false, permissions: ["system"] }) }));
    const { startReleaseUploadAction } = await import("@/app/admin/(console)/(system)/settings/updates/actions");
    const r = await startReleaseUploadAction({ bytes: 100 });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/Only the owner/);
  });
});
