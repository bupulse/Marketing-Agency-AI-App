#!/usr/bin/env node
// The deploy workflow's own check of an uploaded release, run from main's checkout before any of the zip's code:
//   node scripts/verify-release.mjs <zip> <sig> <expected-sha256> <out-dir>
// Verifies the signature with main's public key (scripts/release-public-key.mjs, else RELEASE_PUBLIC_KEY), the
// zip's size and sha256 against the signed manifest and the console's request, checks every path in the zip (no
// absolute paths, no "..", no symlinks: ./release-core.mjs), unpacks it into <out-dir> (which must not
// exist) and checks again that nothing unsafe came out. Prints the version and commit; exits 1 on any problem.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { inspectZipDirectory, missingRequired, parseSigFile, resolvePublicKey, verifyManifest } from "./release-core.mjs";
import { RELEASE_PUBLIC_KEY } from "./release-public-key.mjs";

const [zipPath, sigPath, expected, outDir] = process.argv.slice(2);
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};
if (!zipPath || !sigPath || !/^[0-9a-f]{64}$/.test(expected ?? "") || !outDir) fail("usage: verify-release.mjs <zip> <sig> <sha256> <out-dir>");

const key = resolvePublicKey(RELEASE_PUBLIC_KEY, process.env.RELEASE_PUBLIC_KEY);
if (!key) fail("No release public key (scripts/release-public-key.mjs or RELEASE_PUBLIC_KEY), or the two differ.");
let sig;
try {
  sig = parseSigFile(readFileSync(sigPath, "utf8"));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
if (!(await verifyManifest(sig.manifest, sig.signature, key))) fail("The signature does not match the release public key.");
const bytes = readFileSync(zipPath);
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== sig.manifest.sha256) fail("The zip does not match its signed sha256.");
if (sha !== expected) fail("The zip is not the one the console verified.");
if (bytes.length !== sig.manifest.size) fail("The zip's size does not match its manifest.");

let names;
try {
  names = inspectZipDirectory(new Uint8Array(bytes), 0, bytes.length);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const missing = missingRequired(names);
if (missing.length) fail(`The release lacks ${missing.join(", ")}.`);
if (existsSync(outDir)) fail(`${outDir} already exists.`);

// unzip refuses ".." on its own too; -: is never passed, so it never writes outside the folder.
execFileSync("unzip", ["-q", zipPath, "-d", outDir], { stdio: "inherit" });

const root = resolve(outDir);
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) fail(`A symbolic link came out of the zip: ${relative(root, p)}`);
    if (!resolve(p).startsWith(`${root}/`)) fail(`A file came out outside the folder: ${p}`);
    if (st.isDirectory()) walk(p);
    else if (!st.isFile()) fail(`Not a plain file: ${relative(root, p)}`);
  }
};
walk(root);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== sig.manifest.version) fail(`package.json says ${pkg.version}, the manifest ${sig.manifest.version}.`);
console.log(`version=${sig.manifest.version}`);
console.log(`commit=${sig.manifest.commit}`);
