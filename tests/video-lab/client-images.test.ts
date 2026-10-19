import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  charge: vi.fn(),
  refund: vi.fn(async () => undefined),
  generateImage: vi.fn(),
  makeShot: vi.fn(),
  prepareUploads: vi.fn(),
  finalizeUpload: vi.fn(),
  setAssetDescription: vi.fn(async () => null),
  upload: vi.fn(async () => ({ error: null })),
  ledger: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { mediaFolder: { findUnique: vi.fn(async () => ({ id: "folder-1" })) }, mediaAsset: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: m.ledger }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: m.upload }) } }) }));
vi.mock("@/lib/media/service", () => ({
  MediaError: class MediaError extends Error {},
  createFolder: vi.fn(),
  prepareUploads: m.prepareUploads,
  finalizeUpload: m.finalizeUpload,
  setAssetDescription: m.setAssetDescription,
}));
vi.mock("@/video-lab/credits", () => ({ PRESENTER_IMAGE_CREDITS: 15, charge: m.charge, refund: m.refund, usageMessage: vi.fn(async () => null) }));
vi.mock("@/video-lab/influencers", () => ({ IMAGE_RATIOS: ["1:1", "4:5", "3:4", "9:16", "16:9"], SHOT_ACTIONS: [{ id: "holding", text: "holding" }], generateImage: m.generateImage, makeShot: m.makeShot }));
vi.mock("@/video-lab/data-source", () => ({ listProducts: vi.fn(async () => [{ id: "p-1", name: "Dress", photos: [{ assetId: "ph-1" }] }]), photoJpeg: vi.fn(async () => ({ bytes: Buffer.from("jpeg"), width: 10, height: 10 })) }));

import { aiImageForClient, presenterShotForClient, uploadForClient } from "@/video-lab/client-images";

const me = { userId: "person-1", businessId: "biz-1", companyUserId: "owner-1", role: "MEMBER" };
const PAYER = { userId: "owner-1", periodStart: "2026-10-01T00:00:00.000Z" };

beforeEach(async () => {
  vi.clearAllMocks();
  m.charge.mockResolvedValue(PAYER);
  m.prepareUploads.mockResolvedValue([{ ok: true, path: "owner-1/x.jpg", token: "t" }]);
  m.finalizeUpload.mockResolvedValue({ id: "asset-9" });
  m.ledger.mockImplementation(async (_ctx: unknown, _meta: unknown, call: () => Promise<unknown>) => call());
});

const png = () => sharp({ create: { width: 40, height: 20, channels: 3, background: "#f00" } }).png().toBuffer();

describe("a client's photos", () => {
  it("saves an upload into their Gallery as a JPEG and gives back its id", async () => {
    const out = await uploadForClient(me, await png(), "my shop.png");
    expect(out).toEqual({ id: "asset-9", width: 40, height: 20 });
    expect(m.prepareUploads).toHaveBeenCalledWith({ userId: "owner-1", businessId: "biz-1" }, [expect.objectContaining({ name: "my shop.jpg", type: "image/jpeg" })], "folder:folder-1");
  });

  it("refuses a file that is not a photo", async () => {
    await expect(uploadForClient(me, Buffer.from("not a picture"), "x.jpg")).rejects.toMatchObject({ status: 400 });
    expect(m.prepareUploads).not.toHaveBeenCalled();
  });

  it("takes 15 credits for an AI image, saves it with its prompt as the note, and keeps the charge", async () => {
    m.generateImage.mockResolvedValue({ bytes: await png(), call: { model: "g", inputTokens: 1, outputTokens: 1, costUsd: 0.04 } });
    const out = await aiImageForClient(me, { prompt: "a red dress", ratio: "4:5", refs: ["up:ph-1"] });
    expect(m.charge).toHaveBeenCalledWith(15, "AI image (Nano Banana)");
    expect(m.refund).not.toHaveBeenCalled();
    expect(out).toMatchObject({ credits: 15, image: { id: "asset-9", prompt: "a red dress", ratio: "4:5", url: "/api/photo/asset-9" } });
    expect(m.setAssetDescription).toHaveBeenCalledWith("biz-1", "asset-9", "AI image (Nano Banana): a red dress");
  });

  it("gives the credits back to the plan they came from when Gemini fails, and says so", async () => {
    m.generateImage.mockRejectedValue(new Error("Gemini is busy."));
    await expect(aiImageForClient(me, { prompt: "a red dress" })).rejects.toMatchObject({ status: 502, message: "Gemini is busy. The credits are given back." });
    expect(m.refund).toHaveBeenCalledWith(15, "AI image failed", undefined, PAYER);
  });

  it("does not make an image when the plan cannot pay (nothing is called)", async () => {
    m.charge.mockRejectedValue(new Error("Not enough video credits: this needs 15 and you have 0. Buy more credits on BuPulse."));
    await expect(aiImageForClient(me, { prompt: "x" })).rejects.toMatchObject({ status: 402 });
    expect(m.generateImage).not.toHaveBeenCalled();
  });

  it("asks for a prompt first", async () => {
    await expect(aiImageForClient(me, { prompt: "  " })).rejects.toMatchObject({ status: 400 });
    expect(m.charge).not.toHaveBeenCalled();
  });

  it("makes a presenter shot with the business's own product and photo, 15 credits, refunded on failure", async () => {
    m.makeShot.mockResolvedValue({ uploadId: "asset-9", call: {} });
    expect(await presenterShotForClient(me, "amina", { productId: "p-1" })).toEqual({ uploadId: "asset-9" });
    expect(m.charge).toHaveBeenCalledWith(15, "Presenter shot");
    m.makeShot.mockRejectedValue(new Error("Make Amina's portrait first."));
    await expect(presenterShotForClient(me, "amina", { productId: "p-1" })).rejects.toMatchObject({ status: 502 });
    expect(m.refund).toHaveBeenCalledWith(15, "Presenter shot failed", undefined, PAYER);
    await expect(presenterShotForClient(me, "amina", { productId: "other-business-product" })).rejects.toMatchObject({ status: 404 });
  });
});
