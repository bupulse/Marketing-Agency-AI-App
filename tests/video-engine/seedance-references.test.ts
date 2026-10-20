import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { seedanceBody, type SeedanceRequest } from "@/lib/video-engine/seedance";
import { checkSeedanceRequest } from "@/lib/video-engine/seedance-brain";
import { audioFormat, fitImage, prepareSeedanceReferences, publicLink, summariseBody, wavSeconds, type ReferenceSource } from "@/video-lab/seedance-references";

function noisy(width: number, height: number): Buffer {
  const b = Buffer.alloc(width * height * 3);
  for (let i = 0; i < b.length; i++) b[i] = (i * 7919) % 251;
  return b;
}
const jpeg = (width: number, height: number, noise = false) =>
  noise ? sharp(noisy(width, height), { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer() : sharp({ create: { width, height, channels: 3, background: "#3366ff" } }).jpeg().toBuffer();
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
const size = async (dataUrl: string) => sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")).metadata();

/** A WAV of `seconds` of silence (8 kHz, mono, 16 bit). */
function wav(seconds: number): Buffer {
  const data = Buffer.alloc(8000 * 2 * seconds);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** An MP4 (frames are not real H.264; the sample table is what is checked). */
function mp4(width: number, height: number, seconds: number, fps = 30): Buffer {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width, height }, fastStart: "in-memory" });
  const avcc = new Uint8Array([1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x1f, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);
  for (let i = 0; i < seconds * fps; i++) muxer.addVideoChunkRaw(new Uint8Array([1, 2, 3, 4]), i % fps === 0 ? "key" : "delta", Math.round((i * 1e6) / fps), Math.round(1e6 / fps), i === 0 ? { decoderConfig: { codec: "avc1.64001f", codedWidth: width, codedHeight: height, description: avcc } } : undefined);
  muxer.finalize();
  return Buffer.from(target.buffer);
}

const tunnel = { STUDIO_PUBLIC_URL: "https://video.bupulse.com" };
const up = vi.fn(async () => new Response(null, { status: 200 }));

describe("images sized for BytePlus", () => {
  it("pads a too-wide photo into 0.4 to 2.5 and scales the long side to 2048 px, as JPEG", async () => {
    const fit = await fitImage(await jpeg(3000, 900), "photo");
    expect(fit.format).toBe("jpeg");
    expect(Math.max(fit.width, fit.height)).toBe(2048);
    expect(fit.width / fit.height).toBeLessThan(2.5);
    expect(fit.width / fit.height).toBeGreaterThan(0.4);
    expect(fit.changes.join(" ")).toMatch(/padded from 3000×900/);
    const meta = await sharp(fit.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", fit.width, fit.height]);
  }, 20_000);

  it("pads a too-tall image, scales a tiny one up to 300 px, keeps a cut-out's transparency as PNG", async () => {
    const tall = await fitImage(await jpeg(300, 2000), "photo");
    expect(tall.width / tall.height).toBeGreaterThan(0.4);
    const tiny = await fitImage(await jpeg(100, 150), "portrait");
    expect(Math.min(tiny.width, tiny.height)).toBe(300);
    expect(tiny.changes.join(" ")).toMatch(/scaled up/);
    const cut = await fitImage(await png(500, 1600), "cutout");
    const meta = await sharp(cut.data).metadata();
    expect(cut.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    // The padding of a cut-out is transparent too.
    const { data, info } = await sharp(cut.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(info.width / info.height).toBeGreaterThan(0.4);
  });
});

describe("references in the prompt's order and labels", () => {
  it("numbers each kind from 1 in order, inline images and audio, the video by its public link", async () => {
    const sources: ReferenceSource[] = [
      { kind: "image", type: "photo", bytes: await jpeg(1200, 1600), label: "Galaxy A56 photo" },
      { kind: "video", bytes: mp4(720, 1280, 3), label: "Video: last week's clip", publicPath: "/videos/seedance/sd-0123456789ab.mp4" },
      { kind: "audio", bytes: wav(3), mimeType: "audio/wav", label: "shop jingle" },
      { kind: "image", type: "cutout", bytes: await png(800, 800), label: "Galaxy A56 cut out" },
      { kind: "image", type: "asset", asset: "asset-123", label: "Aline (digital character)" },
    ];
    const out = await prepareSeedanceReferences(sources, { env: tunnel, fetchImpl: up as unknown as typeof fetch });
    expect(out.problems).toEqual([]);
    expect(out.notes).toEqual(["Image 1: Galaxy A56 photo", "Video 1: Video: last week's clip", "Audio 1: shop jingle", "Image 2: Galaxy A56 cut out", "Image 3: Aline (digital character)"]);
    expect(out.references.map((r) => r.url.slice(0, 22))).toEqual(["data:image/jpeg;base64", "https://video.bupulse.", "data:audio/wav;base64,", "data:image/png;base64,", "asset://asset-123"]);
    expect(out.references[1].url).toBe("https://video.bupulse.com/videos/seedance/sd-0123456789ab.mp4");
    expect(out.summary[1]).toMatchObject({ how: "public link", width: 720, height: 1280, seconds: 3 });
    expect(out.summary[2]).toMatchObject({ how: "inline", format: "wav", seconds: 3 });
    expect(out.summary[4]).toMatchObject({ how: "asset id", type: "digital character" });
    expect((await size(out.references[0].url)).height).toBe(1600);
    // The body keeps that order, and checkSeedanceRequest finds nothing BytePlus would refuse.
    const req: SeedanceRequest = { tier: "fast", prompt: "0-4s: the phone from Image 1 turns, cut out in Image 2, Aline from Image 3, the motion of Video 1, music from Audio 1.", references: out.references, ratio: "9:16", seconds: 4, resolution: "720p", audio: true, fixedLens: false };
    const content = (seedanceBody(req) as { content: { type: string }[] }).content.map((c) => c.type);
    expect(content).toEqual(["text", "image_url", "video_url", "audio_url", "image_url", "image_url"]);
    expect(checkSeedanceRequest(req, { referenceNotes: out.notes }).issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("a video without a working tunnel is left out, in plain words; never a localhost link", async () => {
    const video: ReferenceSource = { kind: "video", bytes: mp4(720, 1280, 3), label: "clip", publicPath: "/videos/x.mp4" };
    const none = await prepareSeedanceReferences([video], { env: {} });
    expect(none.references).toEqual([]);
    expect(none.problems.join(" ")).toMatch(/only as a public link.*STUDIO_PUBLIC_URL/);
    expect((await publicLink("/v.mp4", { STUDIO_PUBLIC_URL: "http://video.bupulse.com" })).toString()).toBeTruthy();
    expect(await publicLink("/v.mp4", { STUDIO_PUBLIC_URL: "http://video.bupulse.com" })).toMatchObject({ problem: expect.stringMatching(/https/) });
    expect(await publicLink("/v.mp4", { STUDIO_PUBLIC_URL: "https://localhost:3100" })).toMatchObject({ problem: expect.stringMatching(/this computer/) });
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await publicLink("/v.mp4", tunnel, down as unknown as typeof fetch)).toMatchObject({ problem: expect.stringMatching(/does not answer/) });
    const missing = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await publicLink("/v.mp4", tunnel, missing as unknown as typeof fetch)).toMatchObject({ problem: expect.stringMatching(/404/) });
    expect(await publicLink("v.mp4", tunnel, up as unknown as typeof fetch)).toEqual({ url: "https://video.bupulse.com/v.mp4" });
  });

  it("leaves out what BytePlus would refuse: too short, too small, too many, wrong audio", async () => {
    const out = await prepareSeedanceReferences(
      [
        { kind: "video", bytes: mp4(720, 1280, 1), label: "too short", publicPath: "/a.mp4" },
        { kind: "video", bytes: mp4(320, 568, 3), label: "too small", publicPath: "/b.mp4" },
        { kind: "video", bytes: mp4(720, 1280, 3, 15), label: "15 fps", publicPath: "/c.mp4" },
        { kind: "audio", bytes: Buffer.from("OggS not supported"), mimeType: "audio/ogg", label: "ogg" },
        { kind: "audio", bytes: wav(20), mimeType: "audio/wav", label: "long" },
        ...Array.from({ length: 10 }, (_, i): ReferenceSource => ({ kind: "image", type: "asset", asset: `a${i}`, label: `character ${i}` })),
      ],
      { env: tunnel, fetchImpl: up as unknown as typeof fetch },
    );
    const said = out.problems.join("\n");
    expect(said).toMatch(/too short.*1\.0 s; each reference video must be 2 to 15 s/);
    expect(said).toMatch(/too small.*181760 pixels/);
    expect(said).toMatch(/15 fps.*24 to 60/);
    expect(said).toMatch(/ogg.*mp3 or \.wav/);
    expect(said).toMatch(/long.*20\.0 s/);
    expect(said).toMatch(/character 9.*at most 9 images/);
    expect(out.references).toHaveLength(9);
  });

  it("shrinks the images when the request would be too big for BytePlus", async () => {
    const photos: ReferenceSource[] = await Promise.all([0, 1].map(async (i) => ({ kind: "image" as const, type: "photo" as const, bytes: await jpeg(1700, 1700, true), label: `photo ${i}` })));
    const full = await prepareSeedanceReferences(photos);
    const tight = await prepareSeedanceReferences(photos, { inlineBudget: full.references.reduce((a, r) => a + r.url.length, 0) * 0.9 });
    expect(full.summary[0].width).toBe(1700);
    expect(tight.summary[0].width).toBe(1536);
    expect(tight.summary[0].changes.join(" ")).toMatch(/so the request stays under 64 MB/);
    expect(tight.problems).toEqual([]);
  }, 60_000);
});

describe("audio and the printed body", () => {
  it("reads audio formats and wav lengths from the bytes", () => {
    expect(audioFormat(wav(1), "")).toBe("wav");
    expect(audioFormat(Buffer.from("ID3\x04\x00rest", "latin1"), "")).toBe("mp3");
    expect(audioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x00]), "")).toBe("mp3");
    expect(audioFormat(Buffer.from("????"), "audio/mpeg")).toBe("mp3");
    expect(audioFormat(Buffer.from("????"), "audio/ogg")).toBeNull();
    expect(wavSeconds(wav(4))).toBeCloseTo(4, 3);
  });

  it("summarises inline data by type and size, never the bytes", async () => {
    const out = await prepareSeedanceReferences([{ kind: "image", type: "photo", bytes: await jpeg(1080, 1920), label: "photo" }]);
    const body = seedanceBody({ tier: "mini", prompt: "0-4s: Image 1.", references: out.references, ratio: "9:16", seconds: 4, resolution: "480p", audio: true, fixedLens: false });
    const text = JSON.stringify(summariseBody(body, out.summary));
    expect(text).not.toMatch(/base64,/);
    expect(text).toMatch(/<image\/jpeg inline, \d+ KB, 1080×1920>/);
    expect(text).toContain("Image 1: photo");
  });
});

describe("request checks from the API reference", () => {
  const base: SeedanceRequest = { tier: "fast", prompt: "0-4s: the phone from Image 1 turns slowly on the counter in the light of the shop.", references: [{ kind: "image", url: "data:image/jpeg;base64,AA" }], ratio: "9:16", seconds: 4, resolution: "720p", audio: true, fixedLens: false };
  const codes = (r: Partial<SeedanceRequest>) => checkSeedanceRequest({ ...base, ...r }).issues.map((i) => `${i.level}:${i.code}`);

  it("refuses inline videos, odd audio and image formats, frames mixed with videos, over 64 MB", () => {
    expect(codes({ references: [...base.references, { kind: "video", url: "data:video/mp4;base64,AA" }], prompt: `${base.prompt} Video 1.` })).toContain("error:video-inline");
    expect(codes({ references: [...base.references, { kind: "audio", url: "data:audio/mpeg;base64,AA" }], prompt: `${base.prompt} Audio 1.` })).toContain("error:audio-format");
    expect(codes({ references: [{ kind: "image", url: "data:image/JPEG;base64,AA" }] })).toContain("error:image-format");
    expect(codes({ references: [{ kind: "image", url: "data:image/jpeg;base64,AA", role: "first_frame" }, { kind: "video", url: "https://video.bupulse.com/v.mp4" }], prompt: `${base.prompt} Video 1.` })).toContain("error:mixed-modes");
    expect(codes({ references: [{ kind: "image", url: `data:image/jpeg;base64,${"A".repeat(90 * 1024 * 1024)}` }] })).toContain("error:request-size");
  });

  it("explains what Seedance 2.0 does not have: draft mode, offline tier, a fixed-camera switch", () => {
    expect(codes({ draft: true })).toContain("warning:draft-resolution");
    expect(checkSeedanceRequest({ ...base, draft: true }).issues.find((i) => i.code === "draft-resolution")?.message).toMatch(/no draft mode.*480p/);
    expect(codes({ flex: true })).toContain("warning:flex");
    expect(codes({ fixedLens: true })).toContain("info:fixed-lens");
  });
});
