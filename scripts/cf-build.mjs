#!/usr/bin/env node
// The Cloudflare Workers build (docs/DEPLOY.md): `opennextjs-cloudflare build` with Prisma's query compiler handed
// over by worker.ts. The generated client loads that WebAssembly by compiling it from base64 at runtime, which workerd
// forbids ("Wasm code generation disallowed by embedder"), and the base64 adds 4.4 MB to the bundle. So, for this
// build only, the client takes the module worker.ts imports as a .wasm file (wrangler compiles it at upload, as for
// the image codecs): the base64 leaves the bundle and the queries work on Workers. The usual client is generated again
// afterwards unless --keep (CI: the checkout is thrown away).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const CLASS = "lib/generated/prisma/internal/class.ts";
/** Where worker.ts imports the query compiler from (made by this build, next to the OpenNext output). */
export const WASM_OUT = ".open-next/prisma/query_compiler_fast_bg.wasm";

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

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

function main(argv) {
  run("npx", ["prisma", "generate"]);
  writeFileSync(CLASS, patchClientForWorkers(readFileSync(CLASS, "utf8")));
  try {
    run("npx", ["opennextjs-cloudflare", "build"]);
    // The same query compiler the client's JavaScript glue was built with, as a plain .wasm file.
    const { wasm } = createRequire(import.meta.url)("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js");
    mkdirSync(".open-next/prisma", { recursive: true });
    writeFileSync(WASM_OUT, Buffer.from(wasm, "base64"));
  } finally {
    if (!argv.includes("--keep")) run("npx", ["prisma", "generate"]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
