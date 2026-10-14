#!/usr/bin/env node
// npm run release:zip            Builds dist/release/bupulse-<version>.zip (the git-tracked source at HEAD) and its
//                                signed .sig, ready for Admin -> Settings -> Updates -> Upload a version.
// npm run release:zip -- --init  Creates the owner's signing key: the private key goes into the macOS Keychain
//                                (service "BuPulse release signing key"), the public key into
//                                scripts/release-public-key.mjs and is printed. Nothing else is printed.
//
// The zip is `git archive` of HEAD: only tracked files, so node_modules, .next, .env and other ignored files never get
// in; a tracked .env (other than .env.example) or private key stops the script. docs/UPDATES.md, "Install from a zip".
import { execFileSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { archiveArgs, canonicalManifest, manifestProblem, RELEASE_FORMAT, RELEASE_MAX_BYTES, RELEASE_NAME, toB64, verifyManifest } from "./release-core.mjs";

const KEYCHAIN_SERVICE = "BuPulse release signing key";
const KEYCHAIN_ACCOUNT = "bupulse";
const root = fileURLToPath(new URL("..", import.meta.url));
const keyFile = new URL("./release-public-key.mjs", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const die = (message) => {
  console.error(`release:zip: ${message}`);
  process.exit(1);
};

function keychainRead() {
  try {
    return execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function init() {
  if (keychainRead()) die(`a signing key already exists in the Keychain ("${KEYCHAIN_SERVICE}"). Delete it in Keychain Access first if you really want a new one (old zips then stop verifying).`);
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const priv = toB64(new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)));
  const pub = toB64(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
  // -U updates an existing item; -T "" lets no app read it without asking.
  execFileSync("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-l", KEYCHAIN_SERVICE, "-w", priv], { stdio: "ignore" });
  const file = readFileSync(keyFile, "utf8").replace(/export const RELEASE_PUBLIC_KEY = "[^"]*";/, `export const RELEASE_PUBLIC_KEY = "${pub}";`);
  writeFileSync(keyFile, file);
  console.log(`Public key (also written to scripts/release-public-key.mjs; commit that file):\n${pub}`);
}

/** Tracked files that must never ship: environment files other than the example, and private keys. */
function forbiddenTracked() {
  return git("ls-files")
    .split("\n")
    .filter((f) => (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) || /\.(pem|key|p12|pfx)$/.test(f) || /(^|\/)id_(rsa|ed25519)$/.test(f));
}

async function build() {
  const pkcs8 = keychainRead();
  if (!pkcs8) die(`no signing key in the Keychain. Run: npm run release:zip -- --init`);
  const bad = forbiddenTracked();
  if (bad.length) die(`these tracked files must not ship: ${bad.join(", ")}`);
  if (git("status", "--porcelain")) console.warn("release:zip: the working tree has uncommitted changes; the zip holds HEAD only.");
  const commit = git("rev-parse", "HEAD");
  const version = JSON.parse(git("show", "HEAD:package.json")).version;
  const outDir = new URL("../dist/release/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const zipPath = fileURLToPath(new URL(`${RELEASE_NAME}-${version}.zip`, outDir));
  const { args, links } = archiveArgs(git("ls-files", "-s"), zipPath);
  execFileSync("git", args, { cwd: root });
  if (links.length) console.log(`Left out ${links.length} symbolic links (tooling, not needed to build).`);
  const bytes = readFileSync(zipPath);
  const size = statSync(zipPath).size;
  if (size > RELEASE_MAX_BYTES) die(`the zip is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${RELEASE_MAX_BYTES / 1024 / 1024} MB.`);
  const manifest = { format: RELEASE_FORMAT, name: RELEASE_NAME, version, commit, sha256: createHash("sha256").update(bytes).digest("hex"), size, created: new Date().toISOString() };
  const problem = manifestProblem(manifest);
  if (problem) die(problem);
  const key = await webcrypto.subtle.importKey("pkcs8", Uint8Array.from(Buffer.from(pkcs8, "base64")), { name: "Ed25519" }, false, ["sign"]);
  const signature = toB64(new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(canonicalManifest(manifest)))));
  // Check against the public key in the repository, so a zip that the console would refuse is never handed out.
  const { RELEASE_PUBLIC_KEY } = await import("./release-public-key.mjs");
  if (RELEASE_PUBLIC_KEY && !(await verifyManifest(manifest, signature, RELEASE_PUBLIC_KEY))) die("the Keychain key does not match scripts/release-public-key.mjs.");
  const sigPath = `${zipPath}.sig`;
  writeFileSync(sigPath, `${JSON.stringify({ manifest, signature }, null, 2)}\n`);
  console.log(`Built ${version} (${commit.slice(0, 7)}, ${(size / 1024 / 1024).toFixed(1)} MB):\n  ${zipPath}\n  ${sigPath}\nUpload both in Admin -> Settings -> Updates -> Upload a version.`);
}

if (!existsSync(keyFile)) die("scripts/release-public-key.mjs is missing.");
await (process.argv.includes("--init") ? init() : build());
