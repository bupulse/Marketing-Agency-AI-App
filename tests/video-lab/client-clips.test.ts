import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prepareUploads: vi.fn(),
  finalizeUpload: vi.fn(),
  upload: vi.fn(async () => ({ error: null })),
  download: vi.fn(),
  assetFind: vi.fn(),
  assetMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { mediaFolder: { findUnique: vi.fn(async () => ({ id: "folder-1" })) }, mediaAsset: { findFirst: m.assetFind, findMany: m.assetMany }, videoJob: { findFirst: vi.fn() } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: m.upload, download: m.download }) } }) }));
vi.mock("@/lib/media/service", () => ({ MediaError: class MediaError extends Error {}, createFolder: vi.fn(), prepareUploads: m.prepareUploads, finalizeUpload: m.finalizeUpload, signedUrls: vi.fn() }));
vi.mock("@/video-lab/credits", () => ({ CLAUDE_VIDEO_CREDITS: 35, usageMessage: vi.fn(async () => null) }));
vi.mock("@/video-lab/data-source", () => ({ saveMedia: vi.fn(), mediaBytes: vi.fn() }));

import { checkClip, clientClipBytes, uploadClipForClient } from "@/video-lab/client-clips";
import { clipsForDesign, designInput } from "@/video-lab/client-jobs";

const me = { userId: "person-1", businessId: "biz-1", companyUserId: "owner-1", role: "MEMBER" };
const AVCC = new Uint8Array([1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x1f, 0x01, 0x00, 0x04, 0x68, 0xee, 0x3c, 0x80]);

/** An MP4 of `seconds` at 10 fps (frames are not real H.264: enough for the sample table). */
function clip(seconds: number, codec = "avc1.64001f"): Buffer {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width: 1080, height: 1920 }, fastStart: "in-memory" });
  for (let i = 0; i < seconds * 10; i++) muxer.addVideoChunkRaw(new Uint8Array(600), i % 10 === 0 ? "key" : "delta", i * 100_000, 100_000, i === 0 ? { decoderConfig: { codec, codedWidth: 1080, codedHeight: 1920, description: AVCC } } : undefined);
  muxer.finalize();
  return Buffer.from(target.buffer);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.prepareUploads.mockResolvedValue([{ ok: true, path: "owner-1/clips/asset-7.mp4", token: "t" }]);
  m.finalizeUpload.mockResolvedValue({ id: "asset-7000000" });
});

describe("a phone clip", () => {
  it("is 5 to 10 seconds of a video the studio can play", () => {
    expect(checkClip(clip(7))).toMatchObject({ seconds: 7, width: 1080, height: 1920, codec: "avc1.64001f" });
    expect(() => checkClip(clip(3))).toThrow(/3 seconds\. Use clips of 5 to 10 seconds/);
    expect(() => checkClip(clip(12))).toThrow(/12 seconds/);
    expect(() => checkClip(Buffer.from("not a video at all, just some text that is long enough to pass the size check".repeat(20)))).toThrow(/MP4 or MOV/);
  });

  it("goes into the client's Gallery (Studio clips), and comes back only to them", async () => {
    const out = await uploadClipForClient(me, clip(6), "shop.mov", "video/quicktime");
    expect(out).toEqual({ id: "asset-7000000", url: "/api/clip/asset-7000000", seconds: 6, width: 1080, height: 1920 });
    expect(m.prepareUploads).toHaveBeenCalledWith({ userId: "owner-1", businessId: "biz-1" }, [expect.objectContaining({ name: "shop.mov", type: "video/quicktime" })], "folder:folder-1");
    expect(m.finalizeUpload).toHaveBeenCalledWith({ userId: "owner-1", businessId: "biz-1" }, expect.objectContaining({ path: "owner-1/clips/asset-7.mp4", width: 1080, height: 1920 }));
    await expect(uploadClipForClient(me, clip(2), "short.mp4", "video/mp4")).rejects.toThrow(/5 to 10 seconds/);

    m.assetFind.mockResolvedValueOnce(null);
    expect(await clientClipBytes(me, "asset-of-someone-else")).toBeNull();
    expect(m.assetFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset-of-someone-else", businessId: "biz-1", kind: "video" } }));
  });

  it("a design takes the client's own clips of the right length, in the page's order, at most 4", async () => {
    m.assetMany.mockResolvedValue([
      { id: "clip-bbbbbbbb", width: 1080, height: 1920, durationMs: 8000, description: "hands with the tower" },
      { id: "clip-aaaaaaaa", width: 720, height: 1280, durationMs: 5200, description: null },
      { id: "clip-cccccccc", width: 720, height: 1280, durationMs: 30000, description: null },
    ]);
    const clips = await clipsForDesign(me, ["clip-aaaaaaaa", "clip-bbbbbbbb", "clip-cccccccc", "../../etc"]);
    expect(clips).toEqual([
      { path: "/api/clip/clip-aaaaaaaa", source: "phone", seconds: 5.2, width: 720, height: 1280 },
      { path: "/api/clip/clip-bbbbbbbb", source: "phone", seconds: 8, width: 1080, height: 1920, note: "hands with the tower" },
    ]);
    expect(m.assetMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz-1", kind: "video" }) }));
  });

  it("a new design is made from viral techniques unless the page picked a template, with the clips", async () => {
    m.assetMany.mockResolvedValue([{ id: "clip-aaaaaaaa", width: 720, height: 1280, durationMs: 6000, description: null }]);
    expect(await designInput(me, { productId: "p-1", clipIds: ["clip-aaaaaaaa"] })).toMatchObject({ templateId: "viral", clips: [{ path: "/api/clip/clip-aaaaaaaa", seconds: 6 }] });
    expect(await designInput(me, { productId: "p-1", styleId: "product-hero" })).toMatchObject({ templateId: "product-hero" });
    expect((await designInput(me, { productId: "p-1", mode: "text", clipIds: ["clip-aaaaaaaa"] })).clips).toEqual([]);
  });
});
