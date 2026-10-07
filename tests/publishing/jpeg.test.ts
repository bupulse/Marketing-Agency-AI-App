import { describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errors", () => ({ logError }));

import { downscale, flattenOnWhite, ImageTooLargeError, imageSize, MAX_SIDE, paddedCanvas, padOnWhite, prepareForInstagram, sniffImage, toJpeg } from "@/lib/publishing/jpeg";
import { jpegCopyPath, requiresJpeg, signPathsForNetwork } from "@/lib/publishing/media";
import { SocialError } from "@/lib/social/types";

// A 2x2 PNG with a fully transparent pixel, made with the same codec family so the test needs no fixtures.
async function makePng(): Promise<Uint8Array> {
  const png = await import("@jsquash/png/encode.js");
  const { init } = await import("@jsquash/png/encode.js");
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  await init(await WebAssembly.compile(await readFile(createRequire(`${process.cwd()}/package.json`).resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"))));
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128, 0, 255, 0, 255]);
  return new Uint8Array(await png.default({ data, width: 2, height: 2, colorSpace: "srgb" } as ImageData));
}

async function makeWebp(): Promise<Uint8Array> {
  const webp = await import("@jsquash/webp/encode.js");
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  await webp.init(await WebAssembly.compile(await readFile(createRequire(`${process.cwd()}/package.json`).resolve("@jsquash/webp/codec/enc/webp_enc.wasm"))));
  const data = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? 255 : 200));
  return new Uint8Array(await webp.default({ data, width: 4, height: 4, colorSpace: "srgb" } as ImageData, { quality: 80 }));
}

describe("toJpeg", () => {
  it("turns a PNG with transparency into a JPEG", async () => {
    const png = await makePng();
    expect(sniffImage(png)).toBe("png");
    const jpeg = await toJpeg(png);
    expect(jpeg && sniffImage(jpeg)).toBe("jpeg");
  });

  it("turns a WebP into a JPEG", async () => {
    const webp = await makeWebp();
    expect(sniffImage(webp)).toBe("webp");
    const jpeg = await toJpeg(webp);
    expect(jpeg && sniffImage(jpeg)).toBe("jpeg");
  });

  it("leaves JPEGs and other files alone", async () => {
    expect(await toJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBeNull();
    expect(await toJpeg(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("flattens transparency onto white", () => {
    const image = { data: new Uint8ClampedArray([10, 20, 30, 0, 0, 0, 0, 128, 5, 5, 5, 255]) };
    flattenOnWhite(image);
    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(image.data.slice(4, 8))).toEqual([127, 127, 127, 255]);
    expect(Array.from(image.data.slice(8, 12))).toEqual([5, 5, 5, 255]);
  });
});

describe("signPathsForNetwork", () => {
  function fakeClient(opts: { cached: boolean; original?: Uint8Array; jpegOriginal?: Uint8Array }) {
    const calls = { download: 0, upload: [] as string[], signed: [] as string[] };
    const bucket = {
      exists: async () => ({ data: opts.cached, error: null }),
      download: async (path?: string) => {
        calls.download++;
        const bytes = (path?.endsWith(".jpg") ? opts.jpegOriginal : opts.original) as Uint8Array;
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
      },
      upload: async (path: string) => {
        calls.upload.push(path);
        return { error: null };
      },
      createSignedUrls: async (paths: string[]) => {
        calls.signed.push(...paths);
        return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })), error: null };
      },
    };
    return { calls, client: { storage: { from: () => bucket } } as never };
  }

  it("knows which networks need JPEG", () => {
    expect(requiresJpeg("instagram")).toBe(true);
    expect(requiresJpeg("facebook")).toBe(false);
    expect(jpegCopyPath("u1/designs/a.png")).toBe("u1/designs/a.png.jpg");
  });

  it("converts a PNG once, stores the copy next to it and signs the copy", async () => {
    const { calls, client } = fakeClient({ cached: false, original: await makePng(), jpegOriginal: await picture(200, 200, "jpeg") });
    const result = await signPathsForNetwork(client, ["u1/designs/a.png", "u1/gallery/b.jpg"], "instagram", 3600);
    // The JPEG is looked at too (shape and size) but is fine as it is: no copy.
    expect(calls.download).toBe(2);
    expect(calls.upload).toEqual(["u1/designs/a.png.jpg"]);
    expect(result.urls.get("u1/designs/a.png")).toBe("https://signed/u1/designs/a.png.jpg");
    expect(result.urls.get("u1/gallery/b.jpg")).toBe("https://signed/u1/gallery/b.jpg");
    expect([...result.jpeg]).toEqual(["u1/designs/a.png"]);
  });

  it("reuses the cached copy without downloading or converting again", async () => {
    const { calls, client } = fakeClient({ cached: true });
    const result = await signPathsForNetwork(client, ["u1/gallery/a.webp"], "instagram", 3600);
    expect(calls.download).toBe(0);
    expect(calls.upload).toEqual([]);
    expect(result.urls.get("u1/gallery/a.webp")).toBe("https://signed/u1/gallery/a.webp.jpg");
  });

  it("does not convert for networks that take PNG", async () => {
    const { calls, client } = fakeClient({ cached: false });
    const result = await signPathsForNetwork(client, ["u1/designs/a.png"], "facebook", 3600);
    expect(calls.download).toBe(0);
    expect(result.urls.get("u1/designs/a.png")).toBe("https://signed/u1/designs/a.png");
    expect(result.jpeg.size).toBe(0);
  });

  it("falls back to the original (the network then rejects it clearly) if conversion fails", async () => {
    const { client } = fakeClient({ cached: false, original: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) });
    const result = await signPathsForNetwork(client, ["u1/designs/a.png"], "instagram", 3600);
    expect(result.jpeg.size).toBe(0);
    expect(result.urls.get("u1/designs/a.png")).toBe("https://signed/u1/designs/a.png");
  });
});

// ---- Instagram shape, size and limits ----
async function wasm(file: string) {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  return WebAssembly.compile(await readFile(createRequire(`${process.cwd()}/package.json`).resolve(file)));
}

/** A solid or noisy picture of any size, as PNG or JPEG bytes. */
async function picture(width: number, height: number, kind: "png" | "jpeg", noise = false): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = noise ? seed & 255 : 40;
    data[i + 1] = noise ? (seed >> 8) & 255 : 120;
    data[i + 2] = noise ? (seed >> 16) & 255 : 200;
    data[i + 3] = 255;
  }
  const image = { data, width, height, colorSpace: "srgb" } as ImageData;
  if (kind === "png") {
    const png = await import("@jsquash/png/encode.js");
    await png.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
    return new Uint8Array(await png.default(image));
  }
  const jpeg = await import("@jsquash/jpeg/encode.js");
  await jpeg.init(await wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
  return new Uint8Array(await jpeg.default(image, { quality: 90 }));
}

describe("Instagram aspect ratio", () => {
  it("pads a 3:4 portrait to 4:5 and a 9:16 story to 4:5, keeping the height", () => {
    expect(paddedCanvas(600, 800)).toEqual({ width: 640, height: 800 });
    expect(paddedCanvas(1080, 1920)).toEqual({ width: 1536, height: 1920 });
    const ratio = (c: { width: number; height: number } | null) => (c ? c.width / c.height : 0);
    expect(ratio(paddedCanvas(1080, 1920))).toBeGreaterThanOrEqual(0.8);
  });

  it("pads a very wide picture to 1.91:1, keeping the width", () => {
    const canvas = paddedCanvas(3000, 1000) as { width: number; height: number };
    expect(canvas.width).toBe(3000);
    expect(canvas.width / canvas.height).toBeLessThanOrEqual(1.91);
    expect(canvas.width / canvas.height).toBeGreaterThan(1.9);
  });

  it("leaves pictures inside 4:5 to 1.91:1 alone", () => {
    for (const [w, h] of [[1080, 1350], [1000, 1000], [1910, 1000], [1600, 900]]) expect(paddedCanvas(w, h)).toBeNull();
  });

  it("centres the picture on white", () => {
    const image = { data: new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255]), width: 1, height: 2 };
    const out = padOnWhite(image, { width: 3, height: 2 });
    expect(Array.from(out.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(out.data.slice(4, 8))).toEqual([1, 2, 3, 255]);
    expect(Array.from(out.data.slice(8, 12))).toEqual([255, 255, 255, 255]);
  });

  it("produces a JPEG whose shape is inside the range, from a tall PNG and a wide JPEG, and even from a JPEG", async () => {
    const tall = await prepareForInstagram(await picture(90, 160, "png"));
    expect(tall && sniffImage(tall)).toBe("jpeg");
    const tallSize = imageSize(tall as Uint8Array) as { width: number; height: number };
    expect(tallSize.width / tallSize.height).toBeGreaterThanOrEqual(0.79);
    expect(tallSize.height).toBe(160);
    const wide = await prepareForInstagram(await picture(300, 80, "jpeg"));
    const wideSize = imageSize(wide as Uint8Array) as { width: number; height: number };
    expect(wideSize.width / wideSize.height).toBeLessThanOrEqual(1.92);
    expect(wideSize.width).toBe(300);
  });

  it("leaves an acceptable JPEG untouched", async () => {
    expect(await prepareForInstagram(await picture(200, 200, "jpeg"))).toBeNull();
  });
});

describe("limits", () => {
  it("reads sizes from the file headers", async () => {
    expect(imageSize(await picture(37, 21, "png"))).toEqual({ width: 37, height: 21 });
    expect(imageSize(await picture(37, 21, "jpeg"))).toEqual({ width: 37, height: 21 });
    expect(imageSize(await makeWebp())).toEqual({ width: 4, height: 4 });
  });

  it("refuses pictures above 4096 pixels before decoding them", async () => {
    // A PNG header that claims 5000 x 100: no decoding happens, so the (tiny) body does not matter.
    const header = await picture(2, 2, "png");
    new DataView(header.buffer, header.byteOffset).setUint32(16, MAX_SIDE + 904);
    await expect(prepareForInstagram(header)).rejects.toBeInstanceOf(ImageTooLargeError);
    await expect(prepareForInstagram(header)).rejects.toThrow(/too large/);
  });

  it("keeps the result under the size cap by lowering quality", async () => {
    const noisy = await picture(400, 400, "png", true);
    const first = (await prepareForInstagram(noisy)) as Uint8Array;
    const cap = Math.floor(first.length * 0.6);
    const out = (await prepareForInstagram(noisy, cap)) as Uint8Array;
    expect(out.length).toBeLessThanOrEqual(cap);
    expect(out.length).toBeLessThan(first.length);
  });

  it("gives up with a friendly message when nothing fits", async () => {
    await expect(prepareForInstagram(await picture(300, 300, "png", true), 500)).rejects.toThrow(/8 MB/);
  });

  it("downscales to a maximum width, keeping the shape", () => {
    const image = { data: new Uint8ClampedArray(2000 * 1000 * 4).fill(100), width: 2000, height: 1000 };
    const out = downscale(image, 1440);
    expect(out.width).toBe(1440);
    expect(out.height).toBe(720);
    expect(out.data[0]).toBe(100);
    expect(downscale(out, 1440)).toBe(out);
  });

  it("fails the post with a clear error for an oversized image", async () => {
    const header = await picture(2, 2, "png");
    new DataView(header.buffer, header.byteOffset).setUint32(20, 9000);
    const { client } = (() => {
      const bucket = {
        exists: async () => ({ data: false, error: null }),
        download: async () => ({ data: { arrayBuffer: async () => header.buffer.slice(header.byteOffset, header.byteOffset + header.byteLength) }, error: null }),
        upload: async () => ({ error: null }),
        createSignedUrls: async () => ({ data: [], error: null }),
      };
      return { client: { storage: { from: () => bucket } } as never };
    })();
    const error = await signPathsForNetwork(client, ["u1/gallery/huge.png"], "instagram", 3600).catch((e) => e);
    expect(error).toBeInstanceOf(SocialError);
    expect(error.kind).toBe("invalid");
    expect(error.message).toMatch(/too large/);
  });

  it("handles images one at a time", async () => {
    let active = 0;
    let peak = 0;
    const png = await picture(20, 20, "png");
    const bucket = {
      exists: async () => ({ data: false, error: null }),
      download: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { data: { arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }, error: null };
      },
      upload: async () => ({ error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://s/${path}`, error: null })), error: null }),
    };
    await signPathsForNetwork({ storage: { from: () => bucket } } as never, ["u1/a.png", "u1/b.png", "u1/c.png"], "instagram", 60);
    expect(peak).toBe(1);
  });
});
