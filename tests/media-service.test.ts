import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    mediaFolder: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    mediaAsset: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  rateLimit: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  createSignedUrls: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from: () => ({ info: mocks.info, remove: mocks.remove, list: mocks.list, createSignedUrls: mocks.createSignedUrls }) } }),
}));

import {
  assetsByPaths,
  createFolder,
  deleteAssets,
  deleteFolder,
  discardUpload,
  finalizeUpload,
  MediaError,
  moveAssets,
  prepareUploads,
  renameFolder,
} from "@/lib/media/service";
import { MEDIA_MAX_ASSETS } from "@/lib/media/rules";

const USER = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PATH = `${USER}/gallery/${ID}.png`;
const ctx = { userId: USER, businessId: "biz1" };
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const headFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  mocks.remove.mockResolvedValue({ error: null });
  mocks.createSignedUrls.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })) }));
  headFetch.mockReset().mockResolvedValue(new Response(PNG_HEAD));
  vi.stubGlobal("fetch", headFetch);
  mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
  mocks.prisma.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: typeof mocks.prisma) => unknown)(mocks.prisma) : Promise.all(arg as unknown[])));
  mocks.createSignedUploadUrl.mockImplementation(async (_b: string, path: string) => ({ path, token: "tok", signedUrl: "u" }));
});

describe("prepareUploads", () => {
  const file = { name: "a.png", type: "image/png", size: 1000 };

  it("issues signed targets under <userId>/gallery/ for valid files and reports bad ones in order", async () => {
    const res = await prepareUploads(ctx, [file, { name: "b.gif", type: "image/gif", size: 5 }, file], null);
    expect(res[0]).toMatchObject({ ok: true, token: "tok" });
    expect(res[0].ok && res[0].path).toMatch(new RegExp(`^${USER}/gallery/[0-9a-f-]{36}\\.png$`));
    expect(res[1]).toMatchObject({ ok: false });
    expect(res[2].ok).toBe(true);
    expect(mocks.rateLimit).toHaveBeenCalledOnce();
  });

  it("refuses files past the photo quota with a clear message", async () => {
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: MEDIA_MAX_ASSETS - 1 }, _sum: { bytes: 0 } });
    const res = await prepareUploads(ctx, [file, file], null);
    expect(res[0].ok).toBe(true);
    expect(res[1]).toMatchObject({ ok: false, error: expect.stringMatching(/500 photos/) });
  });

  it("refuses a folder that is not the business's", async () => {
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue(null);
    await expect(prepareUploads(ctx, [file], "foreign")).rejects.toBeInstanceOf(MediaError);
    expect(mocks.prisma.mediaFolder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", businessId: "biz1" } }));
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("finalizeUpload", () => {
  const input = { path: PATH, name: "Shop front", folderId: null, width: 800, height: 600 };

  it("rejects paths outside the user's gallery without touching Storage", async () => {
    for (const path of [`other-user/gallery/${ID}.png`, `${USER}/projects/${ID}.png`, `${USER}/gallery/${ID}.gif`]) {
      await expect(finalizeUpload(ctx, { ...input, path })).rejects.toBeInstanceOf(MediaError);
    }
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("creates the row after checking the object's size and type", async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null);
    mocks.info.mockResolvedValue({ data: { size: 2048, contentType: "image/png" }, error: null });
    mocks.prisma.mediaAsset.create.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() }));
    const item = await finalizeUpload(ctx, input);
    expect(mocks.prisma.mediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: ID, businessId: "biz1", path: PATH, bytes: 2048, mimeType: "image/png", width: 800, height: 600 }) }));
    expect(item.path).toBe(PATH);
  });

  it("removes the object when its type, size or quota is not allowed", async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null);
    for (const data of [{ size: 10, contentType: "text/html" }, { size: 11 * 1024 * 1024, contentType: "image/png" }, { size: 10, contentType: "image/jpeg" }]) {
      mocks.remove.mockClear();
      mocks.info.mockResolvedValue({ data, error: null });
      await expect(finalizeUpload(ctx, input)).rejects.toBeInstanceOf(MediaError);
      expect(mocks.remove).toHaveBeenCalledWith([PATH]);
    }
    mocks.remove.mockClear();
    mocks.info.mockResolvedValue({ data: { size: 10, contentType: "image/png" }, error: null });
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: MEDIA_MAX_ASSETS }, _sum: { bytes: 0 } });
    await expect(finalizeUpload(ctx, input)).rejects.toThrow(/500 photos/);
    expect(mocks.remove).toHaveBeenCalledWith([PATH]);
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("rejects a file whose bytes are not the image type it claims, and removes it", async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null);
    mocks.info.mockResolvedValue({ data: { size: 10, contentType: "image/png" }, error: null });
    for (const body of [new TextEncoder().encode("<html>not an image</html>"), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])]) {
      mocks.remove.mockClear();
      headFetch.mockResolvedValue(new Response(body));
      await expect(finalizeUpload(ctx, input)).rejects.toThrow(/not a JPG, PNG or WebP/);
      expect(mocks.remove).toHaveBeenCalledWith([PATH]);
    }
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
    expect(headFetch).toHaveBeenCalledWith(expect.stringContaining("signed/"), { headers: { Range: "bytes=0-63" } });
  });

  it("fails when the object does not exist", async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null);
    mocks.info.mockResolvedValue({ data: null, error: new Error("not found") });
    await expect(finalizeUpload(ctx, input)).rejects.toBeInstanceOf(MediaError);
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("does not hand out a photo that belongs to another business", async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue({ id: ID, businessId: "other", path: PATH });
    await expect(finalizeUpload(ctx, input)).rejects.toBeInstanceOf(MediaError);
  });
});

describe("discardUpload", () => {
  it("removes only own, unrecorded gallery files", async () => {
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue(null);
    await discardUpload(USER, PATH);
    expect(mocks.remove).toHaveBeenCalledWith([PATH]);
    mocks.remove.mockClear();
    await discardUpload(USER, `other/gallery/${ID}.png`);
    mocks.prisma.mediaAsset.findUnique.mockResolvedValue({ id: ID });
    await discardUpload(USER, PATH);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("folders", () => {
  it("deleting a folder moves its photos to no folder and keeps them", async () => {
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue({ id: "f1", name: "Party" });
    mocks.prisma.mediaAsset.updateMany.mockReturnValue("move");
    mocks.prisma.mediaFolder.deleteMany.mockReturnValue("delete");
    mocks.prisma.$transaction.mockResolvedValue([{ count: 3 }, { count: 1 }]);
    const res = await deleteFolder("biz1", "f1");
    expect(res).toEqual({ moved: 3 });
    expect(mocks.prisma.mediaAsset.updateMany).toHaveBeenCalledWith({ where: { businessId: "biz1", folderId: "f1" }, data: { folderId: null } });
    expect(mocks.prisma.mediaFolder.deleteMany).toHaveBeenCalledWith({ where: { id: "f1", businessId: "biz1" } });
    expect(mocks.prisma.mediaAsset.deleteMany).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("will not delete or rename another business's folder", async () => {
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue(null);
    await expect(deleteFolder("biz1", "foreign")).rejects.toBeInstanceOf(MediaError);
    await expect(renameFolder("biz1", "foreign", "x")).rejects.toBeInstanceOf(MediaError);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.mediaFolder.updateMany).not.toHaveBeenCalled();
  });

  it("refuses duplicate and empty names", async () => {
    mocks.prisma.mediaFolder.count.mockResolvedValue(0);
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue({ id: "f2" });
    await expect(createFolder("biz1", "Party")).rejects.toThrow(/already have a folder/);
    await expect(createFolder("biz1", "  ")).rejects.toBeInstanceOf(MediaError);
    expect(mocks.prisma.mediaFolder.create).not.toHaveBeenCalled();
  });
});

describe("photos", () => {
  it("moves only the business's own photos, into its own folder", async () => {
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue({ id: "f1", name: "Party" });
    mocks.prisma.mediaAsset.updateMany.mockResolvedValue({ count: 2 });
    expect(await moveAssets("biz1", ["a", "b"], "f1")).toBe(2);
    expect(mocks.prisma.mediaAsset.updateMany).toHaveBeenCalledWith({ where: { businessId: "biz1", id: { in: ["a", "b"] } }, data: { folderId: "f1" } });
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue(null);
    await expect(moveAssets("biz1", ["a"], "foreign")).rejects.toBeInstanceOf(MediaError);
  });

  it("deleting removes the Storage files first, then the rows, scoped to the business", async () => {
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "a", path: PATH }]);
    mocks.prisma.mediaAsset.deleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteAssets("biz1", ["a", "someone-elses"])).toBe(1);
    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz1", id: { in: ["a", "someone-elses"] } } }));
    expect(mocks.remove).toHaveBeenCalledWith([PATH, `${PATH}.jpg`]);
    expect(mocks.prisma.mediaAsset.deleteMany).toHaveBeenCalledWith({ where: { businessId: "biz1", id: { in: ["a"] } } });
  });

  it("keeps the rows when Storage fails", async () => {
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "a", path: PATH }]);
    mocks.remove.mockResolvedValue({ error: new Error("boom") });
    await expect(deleteAssets("biz1", ["a"])).rejects.toThrow("boom");
    expect(mocks.prisma.mediaAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("assetsByPaths only asks for the business's own rows", async () => {
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "a", path: PATH, name: "n", width: null, height: null, mimeType: "image/png", bytes: 1, folderId: null, createdAt: new Date() }]);
    mocks.createSignedUrls.mockResolvedValue({ data: [{ path: PATH, signedUrl: "https://signed" }] });
    const res = await assetsByPaths("biz1", [PATH, PATH, "x/y.png"]);
    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz1", path: { in: [PATH, "x/y.png"] } } }));
    expect(res).toEqual([expect.objectContaining({ path: PATH, url: "https://signed" })]);
  });
});
