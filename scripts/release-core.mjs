// Signed release zips (docs/UPDATES.md, "Install from a zip"). Pure, dependency-free JavaScript shared by the
// release script (scripts/release-zip.mjs), the deploy workflow's check (scripts/verify-release.mjs), the admin console
// (lib/updates/releases.ts) and the tests. Signatures are Ed25519 through WebCrypto (Node 20+, Cloudflare Workers).
//
// A release is two files: the zip (`git archive` of the source at one commit) and a `.sig` JSON file:
//   { "manifest": { format, name, version, commit, sha256, size, created }, "signature": "<base64>" }
// The signature covers the manifest's canonical JSON (fixed key order); the manifest's sha256 and size bind the zip.

export const RELEASE_FORMAT = 1;
export const RELEASE_NAME = "bupulse";
/** Supabase Storage's per-file limit on the free plan, and the "releases" bucket's own limit. */
export const RELEASE_MAX_BYTES = 50 * 1024 * 1024;
/** The central directory must sit in the last part of the zip the server keeps while hashing. */
export const ZIP_TAIL_BYTES = 2 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 20_000;

const KEYS = ["format", "name", "version", "commit", "sha256", "size", "created"];

/**
 * @typedef {{ format: number; name: string; version: string; commit: string; sha256: string; size: number; created: string }} ReleaseManifest
 * @typedef {{ manifest: ReleaseManifest; signature: string }} ReleaseSig
 */

/** The bytes the signature covers: the manifest as JSON with its keys in a fixed order. */
export function canonicalManifest(/** @type {ReleaseManifest} */ m) {
  return JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, m[k]])));
}

/** Why a manifest is not acceptable, or null. */
export function manifestProblem(/** @type {unknown} */ value) {
  const m = /** @type {Record<string, unknown>} */ (value ?? {});
  if (typeof value !== "object" || value === null) return "The manifest is missing.";
  if (m.format !== RELEASE_FORMAT) return "Unknown release format.";
  if (m.name !== RELEASE_NAME) return "This zip is not a BuPulse release.";
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+$/.test(m.version)) return "The version must look like 2.1.0.";
  if (typeof m.commit !== "string" || !/^[0-9a-f]{40}$/.test(m.commit)) return "The commit must be a full 40-character SHA.";
  if (typeof m.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256)) return "The sha256 is malformed.";
  if (typeof m.size !== "number" || !Number.isInteger(m.size) || m.size <= 0 || m.size > RELEASE_MAX_BYTES) return `The size must be between 1 byte and ${RELEASE_MAX_BYTES / 1024 / 1024} MB.`;
  if (typeof m.created !== "string" || Number.isNaN(Date.parse(m.created))) return "The creation date is malformed.";
  const extra = Object.keys(m).filter((k) => !KEYS.includes(k));
  if (extra.length) return `Unexpected manifest fields: ${extra.join(", ")}.`;
  return null;
}

/** Reads a .sig file. Throws an Error with a plain message when it is not one. */
export function parseSigFile(/** @type {string} */ text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The .sig file is not valid JSON.");
  }
  const problem = manifestProblem(data?.manifest);
  if (problem) throw new Error(problem);
  if (typeof data.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(data.signature)) throw new Error("The signature is missing or malformed.");
  return /** @type {ReleaseSig} */ ({ manifest: data.manifest, signature: data.signature });
}

const fromB64 = (/** @type {string} */ s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toB64 = (/** @type {Uint8Array} */ b) => btoa(String.fromCharCode(...b));

/** A raw 32-byte Ed25519 public key in base64, or null. */
export function cleanPublicKey(/** @type {string | null | undefined} */ value) {
  const v = (value ?? "").trim();
  return /^[A-Za-z0-9+/]{43}=$/.test(v) ? v : null;
}

/** True when `signature` is the Ed25519 signature of the manifest by `publicKey` (raw, base64). */
export async function verifyManifest(/** @type {ReleaseManifest} */ manifest, /** @type {string} */ signature, /** @type {string} */ publicKey) {
  const key = cleanPublicKey(publicKey);
  if (!key) return false;
  try {
    const k = await crypto.subtle.importKey("raw", fromB64(key), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, k, fromB64(signature), new TextEncoder().encode(canonicalManifest(manifest)));
  } catch {
    return false;
  }
}

/**
 * The public key to check releases with: the one in the repository (scripts/release-public-key.mjs) or, when that is
 * empty, RELEASE_PUBLIC_KEY. Both set and different is refused (null): a server whose environment says otherwise than
 * the code is not trusted to install anything.
 */
export function resolvePublicKey(/** @type {string} */ repoKey, /** @type {string | undefined} */ envKey) {
  const repo = cleanPublicKey(repoKey);
  const env = cleanPublicKey(envKey);
  if (repo && env && repo !== env) return null;
  return repo ?? env;
}

/**
 * Checks a zip's central directory (given the zip's last bytes, `tailOffset` = where those bytes start in the file):
 * every entry is a plain file or directory under the root, with a relative path, no "..", no backslash, no drive
 * letter, no symlink, no duplicate, not encrypted, and the archive is not ZIP64 or split. Returns the entry names, or
 * throws an Error with a plain message.
 */
export function inspectZipDirectory(/** @type {Uint8Array} */ tail, /** @type {number} */ tailOffset, /** @type {number} */ totalSize) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  // End of central directory: signature 0x06054b50, at most 65,535 + 22 bytes from the end.
  let eocd = -1;
  for (let i = tail.length - 22; i >= Math.max(0, tail.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a zip file (no end of central directory).");
  const disk = view.getUint16(eocd + 4, true);
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const start = view.getUint32(eocd + 16, true);
  if (disk !== 0) throw new Error("Split zip files are not accepted.");
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Error("ZIP64 archives are not accepted.");
  if (count > MAX_ZIP_ENTRIES) throw new Error("The zip has too many files.");
  if (start + size > totalSize) throw new Error("The zip's directory points outside the file.");
  const rel = start - tailOffset;
  if (rel < 0) throw new Error("The zip's directory is too large to check.");
  const names = [];
  const seen = new Set();
  let p = rel;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let n = 0; n < count; n++) {
    if (p + 46 > tail.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("The zip's directory is damaged.");
    const madeBy = view.getUint16(p + 4, true) >> 8;
    const flags = view.getUint16(p + 8, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const external = view.getUint32(p + 38, true);
    let name;
    try {
      name = decoder.decode(tail.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new Error("A file name in the zip is not valid UTF-8.");
    }
    if (flags & 0x1) throw new Error(`Encrypted entries are not accepted (${name}).`);
    const problem = unsafeName(name);
    if (problem) throw new Error(`Unsafe path in the zip: ${JSON.stringify(name)} (${problem}).`);
    // Unix attributes live in the high 16 bits when "made by" is Unix (3); 0o120000 is a symlink.
    const mode = madeBy === 3 ? external >>> 16 : 0;
    if ((mode & 0o170000) === 0o120000) throw new Error(`Symbolic links are not accepted (${name}).`);
    if (mode && (mode & 0o170000) !== 0o100000 && (mode & 0o170000) !== 0o040000) throw new Error(`Only plain files and folders are accepted (${name}).`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`The zip holds ${name} twice.`);
    seen.add(key);
    names.push(name);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Why a path inside the zip is unsafe, or null. */
export function unsafeName(/** @type {string} */ name) {
  if (!name) return "empty";
  if (name.includes("\0")) return "NUL byte";
  if (name.includes("\\")) return "backslash";
  if (name.startsWith("/")) return "absolute path";
  if (/^[A-Za-z]:/.test(name)) return "drive letter";
  if (name.split("/").some((part) => part === "..")) return "parent folder";
  if (name.length > 400) return "too long";
  return null;
}

/**
 * The `git archive` arguments for a release of HEAD: every tracked file except tracked symbolic links (editor and
 * agent tooling such as .claude/skills; the build needs none, and the console refuses links in a zip).
 * `lsFilesStage` is the output of `git ls-files -s`.
 */
export function archiveArgs(/** @type {string} */ lsFilesStage, /** @type {string} */ out) {
  const links = lsFilesStage
    .split("\n")
    .filter((l) => l.startsWith("120000 "))
    .map((l) => l.split("\t")[1])
    .filter(Boolean);
  return { args: ["archive", "--format=zip", "-o", out, "HEAD", "--", ".", ...links.map((p) => `:(exclude,literal)${p}`)], links };
}

/** Every release must hold these at its root. */
export const REQUIRED_FILES = ["package.json", "package-lock.json", "next.config.ts", "prisma/schema.prisma"];

export function missingRequired(/** @type {string[]} */ names) {
  const set = new Set(names);
  return REQUIRED_FILES.filter((f) => !set.has(f));
}
