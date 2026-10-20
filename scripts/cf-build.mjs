#!/usr/bin/env node
// The Cloudflare Workers build (docs/DEPLOY.md): `opennextjs-cloudflare build` with Prisma's query compiler handed
// over by worker.ts. The generated client loads that WebAssembly by compiling it from base64 at runtime, which workerd
// forbids ("Wasm code generation disallowed by embedder"), and the base64 adds 4.4 MB to the bundle. So, for this
// build only, the client takes the module worker.ts imports as a .wasm file (wrangler compiles it at upload, as for
// the image codecs): the base64 leaves the bundle and the queries work on Workers. The usual client is generated again
// afterwards unless --keep (CI: the checkout is thrown away), also when the build is stopped with Ctrl+C or a kill.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const CLASS = "lib/generated/prisma/internal/class.ts";
/** Where worker.ts imports the query compiler from (made by this build, next to the OpenNext output). */
export const WASM_OUT = ".open-next/prisma/query_compiler_small_bg.wasm";

const LOADER = /getQueryCompilerWasmModule: async \(\) => \{\n\s*const \{ wasm \} = await import\("@prisma\/client\/runtime\/query_compiler_fast_bg\.postgresql\.wasm-base64\.mjs"\)\n\s*return await decodeBase64AsWasm\(wasm\)\n\s*\},/;
const DECODER = /async function decodeBase64AsWasm\(wasmBase64: string\): Promise<WebAssembly\.Module> \{[\s\S]*?\n\}\n/;

/** The generated client, taking the query compiler from worker.ts instead of compiling it from base64. Pure. */
export function patchClientForWorkers(source) {
  if (!LOADER.test(source) || !DECODER.test(source)) throw new Error("The generated Prisma client changed: update scripts/cf-build.mjs.");
  return source.replace(DECODER, "").replace(
    LOADER,
    `getQueryCompilerWasmModule: async () => {
    // Cloudflare build (scripts/cf-build.mjs): worker.ts imports the module; workerd cannot compile WebAssembly from bytes.
    const module = (globalThis as { __bupulseWasm?: { prismaQueryCompiler?: WebAssembly.Module } }).__bupulseWasm?.prismaQueryCompiler
    if (!module) throw new Error("Prisma's query compiler was not loaded (worker.ts)")
    return module
  },`,
  );
}

const FAST_RUNTIME = 'getRuntime: async () => await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs"),';
const FAST_IMPORT_NAME = 'importName: "./query_compiler_fast_bg.js"';

/**
 * The client on the size-optimised build of the same query compiler (Prisma's generator option `compilerBuild =
 * "small"`): 1.7 MB of WebAssembly instead of 3.4 MB (about 660 KiB gzipped instead of 1,115 KiB in the Worker). Both
 * builds compile the same queries; "small" trades some compile speed for size, and a query shape is compiled once per
 * isolate. A client generated with compilerBuild "small" differs from the usual one only in these two names, so other
 * builds keep the fast compiler. Pure.
 */
export function withSmallCompiler(source) {
  if (!source.includes(FAST_RUNTIME) || !source.includes(FAST_IMPORT_NAME)) throw new Error("The generated Prisma client changed: update scripts/cf-build.mjs (withSmallCompiler).");
  return source.replace(FAST_RUNTIME, () => FAST_RUNTIME.replace("query_compiler_fast_bg", "query_compiler_small_bg")).replace(FAST_IMPORT_NAME, () => FAST_IMPORT_NAME.replace("query_compiler_fast_bg", "query_compiler_small_bg"));
}

/**
 * The generated client's big data (the schema text, the data model, the query parameterization graph: about 650 KB) as
 * its own package. Turbopack copies the client into every chunk group that reaches it (three in the Worker); a package
 * named in next.config.ts serverExternalPackages is bundled once by OpenNext. Same values, read the same way: the data
 * module holds the generated expressions verbatim. Pure: returns the patched client and the module's source.
 */
export const DATA_PACKAGE = "@bupulse/prisma-data";
export const DATA_DIR = `node_modules/${DATA_PACKAGE}`;
const INLINE_SCHEMA = /^ {2}"inlineSchema": (".*"),$/m;
const DATA_MODEL = /^config\.runtimeDataModel = (JSON\.parse\(".*"\))$/m;
const STRINGS = /^ {2}strings: (JSON\.parse\(".*"\)),$/m;
const GRAPH = /^ {2}graph: (".*")$/m;

export function externalizeClientData(source) {
  const found = [INLINE_SCHEMA, DATA_MODEL, STRINGS, GRAPH].map((re) => re.exec(source));
  if (found.some((m) => !m)) throw new Error("The generated Prisma client changed: update scripts/cf-build.mjs (externalizeClientData).");
  const [schema, model, strings, graph] = found.map((m) => m[1]);
  const data = `// Made by scripts/cf-build.mjs for the Cloudflare build only, from the generated Prisma client. Do not edit.\n"use strict";\nexports.inlineSchema = ${schema};\nexports.runtimeDataModel = ${model};\nexports.strings = ${strings};\nexports.graph = ${graph};\n`;
  const patched = source
    .replace(INLINE_SCHEMA, () => '  "inlineSchema": __data.inlineSchema,')
    .replace(DATA_MODEL, () => "config.runtimeDataModel = __data.runtimeDataModel")
    .replace(STRINGS, () => "  strings: __data.strings,")
    .replace(GRAPH, () => "  graph: __data.graph")
    .replace('import * as runtime from "@prisma/client/runtime/client"', () => `import * as runtime from "@prisma/client/runtime/client"\n// Cloudflare build: the client's data lives in one package (scripts/cf-build.mjs, externalizeClientData).\nimport * as __dataModule from "${DATA_PACKAGE}"\nconst __data = ((__dataModule as { default?: unknown }).default ?? __dataModule) as { inlineSchema: string; runtimeDataModel: unknown; strings: string[]; graph: string }`);
  if (!patched.includes("__dataModule")) throw new Error("The generated Prisma client changed: update scripts/cf-build.mjs (externalizeClientData).");
  return { source: patched, data };
}

/**
 * The video brain's data files (lib/video-engine/brain/data, about 1.2 MB) as their own package, copied unchanged.
 * Turbopack inlines them into every chunk group that reaches the brain (four in the Worker); with BUPULSE_CF_BUILD set,
 * next.config.ts has server code require them from this package instead (scripts/cf-brain-data-loader.cjs), which
 * serverExternalPackages bundles once.
 */
export const BRAIN_PACKAGE = "@bupulse/video-brain-data";
export const BRAIN_DIR = `node_modules/${BRAIN_PACKAGE}`;
export const BRAIN_SOURCE = "lib/video-engine/brain/data";

function writeBrainData() {
  rmSync(BRAIN_DIR, { recursive: true, force: true });
  mkdirSync(BRAIN_DIR, { recursive: true });
  writeFileSync(`${BRAIN_DIR}/package.json`, JSON.stringify({ name: BRAIN_PACKAGE, version: "0.0.0", private: true }, null, 2));
  for (const name of readdirSync(BRAIN_SOURCE)) if (name.endsWith(".json")) copyFileSync(`${BRAIN_SOURCE}/${name}`, `${BRAIN_DIR}/${name}`);
}

const run = (cmd, args, env) => execFileSync(cmd, args, { stdio: "inherit", env: env && { ...process.env, ...env } });

/**
 * Runs `restore` once: from the normal end of the build, or when Ctrl+C or a kill stops it (a stopped build must not
 * leave the patched client behind; recovery by hand is `npx prisma generate`, docs/DEPLOY.md). Returns the restorer.
 */
export function restoreOnExit(restore, proc = process) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    restore();
  };
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    proc.on(signal, () => {
      try {
        once();
      } finally {
        proc.exit(code);
      }
    });
  }
  return once;
}

function main(argv) {
  const restore = restoreOnExit(() => {
    if (!argv.includes("--keep")) run("npx", ["prisma", "generate"]);
  });
  run("npx", ["prisma", "generate"]);
  const client = externalizeClientData(withSmallCompiler(patchClientForWorkers(readFileSync(CLASS, "utf8"))));
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/package.json`, JSON.stringify({ name: DATA_PACKAGE, version: "0.0.0", private: true, main: "index.js" }, null, 2));
  writeFileSync(`${DATA_DIR}/index.js`, client.data);
  writeFileSync(CLASS, client.source);
  writeBrainData();
  try {
    run("npx", ["opennextjs-cloudflare", "build"], { BUPULSE_CF_BUILD: "1" });
    // The query compiler the patched client names (withSmallCompiler), as a plain .wasm file.
    const { wasm } = createRequire(import.meta.url)("@prisma/client/runtime/query_compiler_small_bg.postgresql.wasm-base64.js");
    mkdirSync(".open-next/prisma", { recursive: true });
    writeFileSync(WASM_OUT, Buffer.from(wasm, "base64"));
  } finally {
    restore();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
