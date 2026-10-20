import "server-only";
import { INSTAGRAM_MAX_SIDE } from "./validate";

// PNG and WebP to JPEG for networks that only take JPEG (Instagram). Uses the squoosh codecs from @jsquash,
// which are small WebAssembly modules (about 0.6 MB in all) that run in Workers and in Node.
// In Workers worker.ts hands us the compiled .wasm modules; in Node (next start, Netlify Functions, tests) we compile
// the files from node_modules. On Netlify they reach the function only through next.config.ts
// (outputFileTracingIncludes, which the server function is built from); they are looked up from the working directory,
// then from the function's root (LAMBDA_TASK_ROOT).

export const JPEG_QUALITY = 88;

type WasmKey = "png" | "webpDecode" | "jpegEncode" | "jpegDecode";

/** On Cloudflare, worker.ts imports the .wasm files (wrangler compiles them) and publishes them here. */
declare global {
  var __bupulseWasm: Partial<Record<WasmKey, WebAssembly.Module>> | undefined;
}

async function wasmModule(key: WasmKey, file: string): Promise<WebAssembly.Module> {
  const fromWorker = globalThis.__bupulseWasm?.[key];
  if (fromWorker) return fromWorker;
  // Node (next start, Netlify Functions, tests): compile the file from node_modules.
  const { readFile } = await import(/* webpackIgnore: true */ "node:fs/promises");
  return WebAssembly.compile(await readFile(await resolveWasm(file)));
}

/** The path of a package file, looked up from the working directory, then from the Lambda root (Netlify). */
export async function resolveWasm(file: string, roots: (string | undefined)[] = [process.cwd(), process.env.LAMBDA_TASK_ROOT]): Promise<string> {
  const { createRequire } = await import(/* webpackIgnore: true */ "node:module");
  let lastError: unknown = new Error(`Cannot find ${file}`);
  for (const root of new Set(roots.filter((r): r is string => Boolean(r)))) {
    try {
      return createRequire(`${root}/package.json`).resolve(file);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const ready: Record<string, Promise<void>> = {};
const once = (key: string, start: () => Promise<void>) => (ready[key] ??= start().catch((error) => {
  delete ready[key];
  throw error;
}));

export type ImageKind = "png" | "webp" | "jpeg" | "unknown";

export function sniffImage(bytes: Uint8Array): ImageKind {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return "unknown";
}

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

async function decodeImage(bytes: Uint8Array, kind: "png" | "webp" | "jpeg"): Promise<Pixels> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (kind === "png") {
    const png = await import("@jsquash/png/decode.js");
    await once("png", async () => {
      await png.init(await wasmModule("png", "@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
    });
    return png.decode(buffer);
  }
  if (kind === "jpeg") {
    const jpeg = await import("@jsquash/jpeg/decode.js");
    await once("jpegDecode", async () => {
      await jpeg.init(await wasmModule("jpegDecode", "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"));
    });
    return jpeg.default(buffer);
  }
  const webp = await import("@jsquash/webp/decode.js");
  await once("webp", async () => {
    await webp.init(await wasmModule("webpDecode", "@jsquash/webp/codec/dec/webp_dec.wasm"));
  });
  const image = await webp.default(buffer);
  if (!image) throw new Error("Could not read the WebP image");
  return image;
}

/** Draws transparent pixels onto white, in place. JPEG has no alpha, and black would show instead. */
export function flattenOnWhite(image: { data: Uint8ClampedArray }) {
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 255) continue;
    const f = a / 255;
    px[i] = Math.round(px[i] * f + 255 * (1 - f));
    px[i + 1] = Math.round(px[i + 1] * f + 255 * (1 - f));
    px[i + 2] = Math.round(px[i + 2] * f + 255 * (1 - f));
    px[i + 3] = 255;
  }
}

// ---- Instagram limits ----
/** Instagram accepts aspect ratios (width / height) from 4:5 to 1.91:1, JPEG only, under 8 MB. */
export const ASPECT_MIN = 0.8;
export const ASPECT_MAX = 1.91;
export const MAX_JPEG_BYTES = 8 * 1024 * 1024;
/** Above this on either side we refuse: decoding it would use too much memory and time. */
export const MAX_SIDE = INSTAGRAM_MAX_SIDE;
export const MAX_OUTPUT_WIDTH = 1440;

export class ImageTooLargeError extends Error {}

const TOO_LARGE = `This photo is too large (over ${MAX_SIDE} pixels on a side). Choose a smaller one, or make a smaller copy first.`;

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** Width and height read from the file header, without decoding. Null if they cannot be found. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const kind = sniffImage(bytes);
  if (kind === "png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (kind === "jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) i += 2;
      else i += 2 + u16be(bytes, i + 2);
    }
    return null;
  }
  if (kind === "webp" && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8 ") return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  }
  return null;
}

/** The canvas size that brings an image into Instagram's range (4:5 for tall, 1.91:1 for wide), or null if it is already inside. */
export function paddedCanvas(width: number, height: number): { width: number; height: number } | null {
  const ratio = width / height;
  if (ratio < ASPECT_MIN) return { width: Math.ceil(height * ASPECT_MIN), height };
  if (ratio > ASPECT_MAX) return { width, height: Math.ceil(width / ASPECT_MAX) };
  return null;
}

/** The image centred on a white canvas. */
export function padOnWhite(image: Pixels, canvas: { width: number; height: number }): Pixels {
  const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255);
  const left = Math.floor((canvas.width - image.width) / 2);
  const top = Math.floor((canvas.height - image.height) / 2);
  for (let y = 0; y < image.height; y++) {
    data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + top) * canvas.width + left) * 4);
  }
  return { data, width: canvas.width, height: canvas.height };
}

/** Bilinear downscale to at most `maxWidth` wide, keeping the shape. */
export function downscale(image: Pixels, maxWidth: number): Pixels {
  if (image.width <= maxWidth) return image;
  const width = maxWidth;
  const height = Math.max(1, Math.round((image.height * maxWidth) / image.width));
  const data = new Uint8ClampedArray(width * height * 4);
  const xr = image.width / width;
  const yr = image.height / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, (y + 0.5) * yr - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, (x + 0.5) * xr - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      for (let c = 0; c < 4; c++) {
        const top = image.data[(y0 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y0 * image.width + x1) * 4 + c] * fx;
        const bottom = image.data[(y1 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y1 * image.width + x1) * 4 + c] * fx;
        data[(y * width + x) * 4 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { data, width, height };
}

async function encodeJpeg(image: Pixels, quality: number): Promise<Uint8Array> {
  const jpeg = await import("@jsquash/jpeg/encode.js");
  await once("jpegEncode", async () => {
    await jpeg.init(await wasmModule("jpegEncode", "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
  });
  return new Uint8Array(await jpeg.default(image as unknown as ImageData, { quality }));
}

/** Encodes under the byte cap: lower quality first, then a smaller picture. */
async function encodeUnderCap(image: Pixels, cap: number): Promise<Uint8Array> {
  for (const quality of [JPEG_QUALITY, 80, 70]) {
    const out = await encodeJpeg(image, quality);
    if (out.length <= cap) return out;
  }
  const smaller = downscale(image, MAX_OUTPUT_WIDTH);
  for (const quality of [80, 65, 50]) {
    const out = await encodeJpeg(smaller, quality);
    if (out.length <= cap) return out;
  }
  throw new ImageTooLargeError("This photo is too detailed to fit Instagram's 8 MB limit. Choose a smaller one.");
}

/**
 * Makes an image acceptable to Instagram: a JPEG (transparency flattened on white, quality 88), padded with white
 * to 4:5 or 1.91:1 when its shape is outside that range, and under 8 MB. Null when the file is already fine.
 * Throws ImageTooLargeError above 4096 pixels on a side, before decoding anything.
 */
export async function prepareForInstagram(bytes: Uint8Array, cap = MAX_JPEG_BYTES): Promise<Uint8Array | null> {
  const kind = sniffImage(bytes);
  if (kind === "unknown") return null;
  const size = imageSize(bytes);
  if (size && (size.width > MAX_SIDE || size.height > MAX_SIDE)) throw new ImageTooLargeError(TOO_LARGE);
  if (kind === "jpeg" && size && !paddedCanvas(size.width, size.height) && bytes.length <= cap) return null;

  let image = await decodeImage(bytes, kind);
  if (image.width > MAX_SIDE || image.height > MAX_SIDE) throw new ImageTooLargeError(TOO_LARGE);
  flattenOnWhite(image);
  const canvas = paddedCanvas(image.width, image.height);
  if (canvas) image = padOnWhite(image, canvas);
  return encodeUnderCap(image, cap);
}

/** A JPEG of this PNG or WebP (kept for callers that only convert). Null when it is already a JPEG or not an image we convert. */
export async function toJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  const kind = sniffImage(bytes);
  if (kind !== "png" && kind !== "webp") return null;
  return prepareForInstagram(bytes);
}

// ---- small copies ----

/** The middle square of an image (the largest one that fits). */
export function cropSquare(image: Pixels): Pixels {
  const side = Math.min(image.width, image.height);
  if (image.width === side && image.height === side) return image;
  const left = Math.floor((image.width - side) / 2);
  const top = Math.floor((image.height - side) / 2);
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const from = ((y + top) * image.width + left) * 4;
    data.set(image.data.subarray(from, from + side * 4), y * side * 4);
  }
  return { data, width: side, height: side };
}

/** Downscale to `width` in halving steps first, so a big photo is averaged rather than sampled (no jagged edges). */
function shrinkTo(image: Pixels, width: number): Pixels {
  let out = image;
  while (out.width >= width * 2) out = downscale(out, Math.ceil(out.width / 2));
  return downscale(out, width);
}

/**
 * A small JPEG of a photo or logo for public pages (the link-in-bio page, lib/bio): at most `maxSide` pixels on a side,
 * cut to the middle square when `square`, transparency on white. Throws ImageTooLargeError above 4096 pixels on a side
 * (before decoding), and an Error when the bytes are not a PNG, WebP or JPEG.
 */
export async function smallJpeg(bytes: Uint8Array, opts: { maxSide: number; square?: boolean; quality?: number }): Promise<Uint8Array> {
  const kind = sniffImage(bytes);
  if (kind === "unknown") throw new Error("Not a PNG, WebP or JPEG image");
  const size = imageSize(bytes);
  if (size && (size.width > MAX_SIDE || size.height > MAX_SIDE)) throw new ImageTooLargeError(TOO_LARGE);
  let image = await decodeImage(bytes, kind);
  if (image.width > MAX_SIDE || image.height > MAX_SIDE) throw new ImageTooLargeError(TOO_LARGE);
  flattenOnWhite(image);
  if (opts.square) image = cropSquare(image);
  const scale = Math.min(1, opts.maxSide / Math.max(image.width, image.height));
  image = shrinkTo(image, Math.max(1, Math.round(image.width * scale)));
  return encodeJpeg(image, opts.quality ?? 78);
}
