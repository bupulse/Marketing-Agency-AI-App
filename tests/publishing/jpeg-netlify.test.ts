import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { resolveWasm, toJpeg } from "@/lib/publishing/jpeg";
import nextConfig from "@/next.config";

// On Netlify the app runs in Node from a function bundle made of the traced files only, rooted at LAMBDA_TASK_ROOT.
// These tests check that the four codec files lib/publishing/jpeg.ts reads are traced and found there.

const jpegSource = readFileSync("lib/publishing/jpeg.ts", "utf8");
const WASM = [...jpegSource.matchAll(/"(@jsquash\/[a-z]+\/codec\/[^"]+\.wasm)"/g)].map((m) => m[1]);

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A directory shaped like Netlify's server function: package.json and only the @jsquash packages. */
function fakeFunctionRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bupulse-fn-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fn", private: true }));
  for (const pkg of ["png", "jpeg", "webp"]) cpSync(join("node_modules/@jsquash", pkg), join(root, "node_modules/@jsquash", pkg), { recursive: true });
  return root;
}

describe("JPEG codecs on Netlify (Node)", () => {
  it("uses all four codec files", () => {
    expect(WASM.sort()).toEqual(["@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm", "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm", "@jsquash/png/codec/pkg/squoosh_png_bg.wasm", "@jsquash/webp/codec/dec/webp_dec.wasm"]);
  });

  it("next.config.ts traces every codec file into the server bundle", () => {
    const globs = Object.values(nextConfig.outputFileTracingIncludes ?? {}).flat();
    for (const file of WASM) expect(globs.some((g) => matchesGlob(`./node_modules/${file}`, g)), file).toBe(true);
  });

  it("finds the files from the function root when the working directory does not have them", async () => {
    const root = fakeFunctionRoot();
    for (const file of WASM) {
      const path = await resolveWasm(file, [join(tmpdir(), "no-such-dir"), undefined, root]);
      expect(path.startsWith(root) || path.startsWith(join("/private", root))).toBe(true);
      expect(readFileSync(path).subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d])); // "\0asm"
    }
  });

  it("says which file is missing when no root has it", async () => {
    await expect(resolveWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm", [join(tmpdir(), "no-such-dir")])).rejects.toThrow();
  });

  it("converts without the Worker's precompiled modules (the Node path Netlify uses)", async () => {
    expect(globalThis.__bupulseWasm).toBeUndefined();
    const png = await import("@jsquash/png/encode.js");
    await png.init(await WebAssembly.compile(readFileSync(await resolveWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"))));
    const bytes = new Uint8Array(await png.default({ data: new Uint8ClampedArray(4 * 4 * 4).fill(180), width: 4, height: 4, colorSpace: "srgb" } as ImageData));
    const jpeg = await toJpeg(bytes);
    expect(jpeg && [jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
  });
});
