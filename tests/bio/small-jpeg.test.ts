import { describe, expect, it } from "vitest";
import { cropSquare, imageSize, smallJpeg, sniffImage } from "@/lib/publishing/jpeg";

async function wasm(file: string) {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  return WebAssembly.compile(await readFile(createRequire(`${process.cwd()}/package.json`).resolve(file)));
}

/** A noisy PNG of any size (noise makes a big file, like a phone photo). */
async function png(width: number, height: number): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data.set([seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255], i);
  }
  const encoder = await import("@jsquash/png/encode.js");
  await encoder.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
  return new Uint8Array(await encoder.default({ data, width, height, colorSpace: "srgb" } as ImageData));
}

describe("small copies for the link-in-bio page", () => {
  it("cuts a product photo to a 480 px square JPEG", async () => {
    const out = await smallJpeg(await png(1200, 800), { maxSide: 480, square: true });
    expect(sniffImage(out)).toBe("jpeg");
    expect(imageSize(out)).toEqual({ width: 480, height: 480 });
  });

  it("keeps a logo's shape and never makes a small one bigger", async () => {
    expect(imageSize(await smallJpeg(await png(800, 400), { maxSide: 320 }))).toEqual({ width: 320, height: 160 });
    expect(imageSize(await smallJpeg(await png(100, 60), { maxSide: 320 }))).toEqual({ width: 100, height: 60 });
  });

  it("refuses what is not a picture", async () => {
    await expect(smallJpeg(new TextEncoder().encode("<svg/>"), { maxSide: 320 })).rejects.toThrow();
  });

  it("takes the middle square", () => {
    // 3 x 1: red, green, blue. The middle square is the green pixel.
    const image = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), width: 3, height: 1 };
    expect(Array.from(cropSquare(image).data)).toEqual([0, 255, 0, 255]);
  });
});
