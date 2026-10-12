import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  prisma: {
    business: { findUnique: vi.fn() },
    mediaFolder: { findFirst: vi.fn() },
    mediaAsset: { create: vi.fn(), aggregate: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    canvaConnection: { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  rateLimit: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrls: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: vi.fn() }));
// Server-side writes use the service key (Phase 9, H2): the session's Storage policies are for the browser's uploads.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => {
    mocks.adminClient(...args);
    return { storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, createSignedUrls: mocks.createSignedUrls }) } };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, createSignedUrls: mocks.createSignedUrls }) } }),
}));

import { allowedUrl, isDropboxHost, isGoogleApiHost, safeFetchBytes, SafeFetchError } from "@/lib/media/safe-fetch";
import { importDriveFile, importDropboxFile, importCanvaDesign, listCanvaDesigns, CanvaImportError } from "@/lib/media/importers";
import { importAsset, MediaError } from "@/lib/media/service";
import { imageSize, MEDIA_MAX_BYTES } from "@/lib/media/rules";
import { exportDesignPng, listDesigns } from "@/lib/canva/client";
import { encrypt } from "@/lib/crypto";
import { RateLimitError } from "@/lib/rate-limit";

const USER = "11111111-1111-1111-1111-111111111111";
const ctx = { userId: USER, businessId: "biz1" };

function png(width = 640, height = 480, extra = 0): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0]);
const body = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(bytes as unknown as BodyInit, { headers });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.CANVA_CLIENT_ID = "OC-client";
  process.env.CANVA_CLIENT_SECRET = "secret";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.createSignedUrls.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })) }));
  mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
  mocks.prisma.mediaAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, createdAt: new Date() }));
});
afterEach(() => vi.unstubAllGlobals());

describe("allowedUrl", () => {
  it("accepts https on allowed hosts and their subdomains only", () => {
    expect(allowedUrl("https://dl.dropboxusercontent.com/apitl/1/x", isDropboxHost)).not.toBeNull();
    expect(allowedUrl("https://www.dropbox.com/scl/fi/a/b.jpg?dl=1", isDropboxHost)).not.toBeNull();
    expect(allowedUrl("https://evil-dropbox.com/x", isDropboxHost)).toBeNull();
    expect(allowedUrl("https://dropbox.com.evil.io/x", isDropboxHost)).toBeNull();
    expect(allowedUrl("https://notdropboxusercontent.com/x", isDropboxHost)).toBeNull();
  });

  it("refuses http, credentials, odd ports, IP literals and junk", () => {
    expect(allowedUrl("http://dl.dropboxusercontent.com/x", isDropboxHost)).toBeNull();
    expect(allowedUrl("https://user:pw@dl.dropboxusercontent.com/x", isDropboxHost)).toBeNull();
    expect(allowedUrl("https://dl.dropboxusercontent.com:8443/x", isDropboxHost)).toBeNull();
    expect(allowedUrl("https://127.0.0.1/x", () => true)).toBeNull();
    expect(allowedUrl("https://[::1]/x", () => true)).toBeNull();
    expect(allowedUrl("file:///etc/passwd", () => true)).toBeNull();
    expect(allowedUrl("not a url", () => true)).toBeNull();
  });
});

describe("safeFetchBytes", () => {
  const opts = { allowHost: isDropboxHost, maxBytes: 100 };

  it("refuses a blocked address without calling fetch", async () => {
    await expect(safeFetchBytes("https://169.254.169.254/latest", opts)).rejects.toMatchObject({ code: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a redirect to another allowed host and refuses one that leaves", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://uc1.dl.dropboxusercontent.com/f" } })).mockResolvedValueOnce(body(new Uint8Array([1, 2, 3])));
    expect(await safeFetchBytes("https://www.dropbox.com/s/x?dl=1", opts)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });

    fetchMock.mockReset().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    await expect(safeFetchBytes("https://www.dropbox.com/s/x?dl=1", opts)).rejects.toMatchObject({ code: "blocked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://www.dropbox.com/again" } }));
    await expect(safeFetchBytes("https://www.dropbox.com/a", opts)).rejects.toMatchObject({ code: "blocked" });
  });

  it("sends the Authorization header to the first host only", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://lh3.googleusercontent.com/x" } })).mockResolvedValueOnce(body(new Uint8Array([1])));
    await safeFetchBytes("https://www.googleapis.com/drive/v3/files/abc", { allowHost: isGoogleApiHost, maxBytes: 10, headers: { Authorization: "Bearer t" } });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer t" });
    expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
  });

  it("stops at the size limit, by header and by streamed bytes", async () => {
    fetchMock.mockResolvedValueOnce(body(new Uint8Array(10), { "content-length": "5000" }));
    await expect(safeFetchBytes("https://www.dropbox.com/a", opts)).rejects.toMatchObject({ code: "too_big" });
    fetchMock.mockResolvedValueOnce(body(new Uint8Array(500)));
    await expect(safeFetchBytes("https://www.dropbox.com/a", opts)).rejects.toMatchObject({ code: "too_big" });
  });

  it("reports HTTP errors and timeouts", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 404 }));
    await expect(safeFetchBytes("https://www.dropbox.com/a", opts)).rejects.toMatchObject({ code: "http", status: 404 });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(safeFetchBytes("https://www.dropbox.com/a", opts)).rejects.toBeInstanceOf(SafeFetchError);
  });
});

describe("imageSize", () => {
  it("reads PNG and JPEG headers and returns null for junk", () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(JPEG)).toEqual({ width: 640, height: 480 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("importAsset", () => {
  const base = { name: "Summer Party_3.png", folderId: null, source: "dropbox" as const };

  it("stores a valid photo under <userId>/gallery/ and records its source and size", async () => {
    const item = await importAsset(ctx, { ...base, bytes: png() });
    const [path, , options] = mocks.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${USER}/gallery/[0-9a-f-]+\\.png$`));
    expect(mocks.adminClient).toHaveBeenCalled();
    expect(options).toMatchObject({ contentType: "image/png", upsert: false });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ businessId: "biz1", source: "dropbox", width: 640, height: 480, name: "Summer Party 3" });
    expect(item.url).toContain("https://signed/");
  });

  it("rejects wrong bytes, empty and oversize files, before storing anything", async () => {
    await expect(importAsset(ctx, { ...base, name: "a.png", bytes: new TextEncoder().encode("<html>not an image</html>") })).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(importAsset(ctx, { ...base, bytes: new Uint8Array(0) })).rejects.toThrow(/empty/);
    await expect(importAsset(ctx, { ...base, bytes: png(1, 1, MEDIA_MAX_BYTES) })).rejects.toThrow(/over 10 MB/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("enforces the quota and the folder", async () => {
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 500 }, _sum: { bytes: 0 } });
    await expect(importAsset(ctx, { ...base, bytes: png() })).rejects.toThrow(/gallery is full/);
    mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
    mocks.prisma.mediaFolder.findFirst.mockResolvedValue(null);
    await expect(importAsset(ctx, { ...base, bytes: png(), folderId: "someone-elses" })).rejects.toBeInstanceOf(MediaError);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes the stored file when the database row cannot be written", async () => {
    mocks.prisma.mediaAsset.create.mockRejectedValueOnce(new Error("db down"));
    await expect(importAsset(ctx, { ...base, bytes: png() })).rejects.toThrow("db down");
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
  });
});

describe("quota is checked atomically", () => {
  const base = { name: "a.png", folderId: null, source: "dropbox" as const };

  it("takes the per-business lock and re-counts inside the transaction before inserting", async () => {
    await importAsset(ctx, { ...base, bytes: png() });
    const order = [mocks.prisma.$executeRaw.mock.invocationCallOrder[0], mocks.prisma.mediaAsset.aggregate.mock.invocationCallOrder.at(-1)!, mocks.prisma.mediaAsset.create.mock.invocationCallOrder[0]];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses and removes the file when parallel imports filled the quota after the first check", async () => {
    mocks.prisma.mediaAsset.aggregate.mockResolvedValueOnce({ _count: { _all: 499 }, _sum: { bytes: 0 } }).mockResolvedValueOnce({ _count: { _all: 500 }, _sum: { bytes: 0 } });
    await expect(importAsset(ctx, { ...base, bytes: png() })).rejects.toThrow(/gallery is full/);
    expect(mocks.prisma.mediaAsset.create).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
  });
});

describe("the import rate limit is counted before any download", () => {
  beforeEach(() => {
    mocks.rateLimit.mockImplementation(async () => {
      throw new RateLimitError(60);
    });
  });

  it("stops Drive, Dropbox and Canva imports before they fetch anything", async () => {
    await expect(importDriveFile(ctx, { token: "ya29.token-token", fileId: "1AbCdEfGhIjK", folderId: null })).rejects.toBeInstanceOf(RateLimitError);
    await expect(importDropboxFile(ctx, { link: "https://dl.dropboxusercontent.com/a", name: "a.jpg", folderId: null })).rejects.toBeInstanceOf(RateLimitError);
    await expect(importCanvaDesign(ctx, { designId: "DAF1abcdef", title: "x", folderId: null })).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rateLimit.mock.calls.map((c) => c[0])).toEqual([`media-import:${USER}`, `media-import:${USER}`, `media-import:${USER}`]);
  });
});

describe("importDriveFile", () => {
  const input = { token: "ya29.token-token", fileId: "1AbCdEfGhIjK", folderId: null };

  it("reads the metadata, then downloads with alt=media and the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json({ name: "shop.png", mimeType: "image/png", size: "33" })).mockResolvedValueOnce(body(png()));
    const item = await importDriveFile(ctx, input);
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjK?fields=name,mimeType,size");
    expect(fetchMock.mock.calls[1][0].toString()).toBe("https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjK?alt=media");
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: "Bearer ya29.token-token" });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data.source).toBe("google_drive");
    expect(item.name).toBe("shop");
  });

  it("refuses videos, HEIC and big files from the metadata, without downloading", async () => {
    fetchMock.mockResolvedValueOnce(json({ name: "clip.mp4", mimeType: "video/mp4", size: "10" }));
    await expect(importDriveFile(ctx, input)).rejects.toThrow(/JPG, PNG or WebP/);
    fetchMock.mockResolvedValueOnce(json({ name: "IMG.heic", mimeType: "image/heic", size: "10" }));
    await expect(importDriveFile(ctx, input)).rejects.toThrow(/HEIC/);
    fetchMock.mockResolvedValueOnce(json({ name: "huge.png", mimeType: "image/png", size: String(MEDIA_MAX_BYTES + 1) }));
    await expect(importDriveFile(ctx, input)).rejects.toThrow(/over 10 MB/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a file whose bytes are not an image even if Drive says image/png", async () => {
    fetchMock.mockResolvedValueOnce(json({ name: "x.png", mimeType: "image/png", size: "20" })).mockResolvedValueOnce(body(new TextEncoder().encode("<script>alert(1)</script>")));
    await expect(importDriveFile(ctx, input)).rejects.toThrow(/JPG, PNG or WebP/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("explains an expired token and refuses ids that are not Drive ids", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(importDriveFile(ctx, input)).rejects.toThrow(/Open the picker again/);
    await expect(importDriveFile(ctx, { ...input, fileId: "../../etc/passwd" })).rejects.toBeInstanceOf(MediaError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("importDropboxFile", () => {
  it("downloads a Dropbox direct link into the gallery", async () => {
    fetchMock.mockResolvedValueOnce(body(JPEG));
    await importDropboxFile(ctx, { link: "https://dl.dropboxusercontent.com/apitl/1/abc", name: "cake.jpg", folderId: null });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ source: "dropbox", mimeType: "image/jpeg" });
  });

  it("never fetches a link that is not on Dropbox", async () => {
    await expect(importDropboxFile(ctx, { link: "https://evil.example/x.jpg", name: "x.jpg", folderId: null })).rejects.toBeInstanceOf(MediaError);
    await expect(importDropboxFile(ctx, { link: "http://169.254.169.254/", name: "x.jpg", folderId: null })).rejects.toBeInstanceOf(MediaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Canva import", () => {
  const connection = async () => ({ accessTokenEncrypted: await encrypt("acc"), refreshTokenEncrypted: await encrypt("ref"), expiresAt: new Date(Date.now() + 3_600_000) });

  it("lists designs with thumbnails and passes the search and continuation", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [{ id: "DAF1", title: "Menu", thumbnail: { url: "https://document-export.canva.com/t.png" }, updated_at: 5 }, { id: "DAF2" }], continuation: "next" }));
    const page = await listDesigns("acc", { query: "menu", continuation: "c1" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/rest/v1/designs");
    expect(url.searchParams.get("query")).toBe("menu");
    expect(url.searchParams.get("continuation")).toBe("c1");
    expect(page.continuation).toBe("next");
    expect(page.items[0]).toMatchObject({ id: "DAF1", title: "Menu", thumbnailUrl: "https://document-export.canva.com/t.png" });
    expect(page.items[1].title).toBe("Untitled design");
  });

  it("polls the export job until it succeeds, then downloads the PNG", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/exports") && init?.method === "POST") return json({ job: { id: "J1", status: "in_progress" } });
      if (url.endsWith("/exports/J1")) {
        const polls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/exports/J1")).length;
        return json({ job: polls < 2 ? { id: "J1", status: "in_progress" } : { id: "J1", status: "success", urls: ["https://export-download.canva.com/f.png"] } });
      }
      return body(png());
    });
    const bytes = await exportDesignPng("acc", "DAF1", { width: 2048 });
    expect(bytes.length).toBe(33);
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body).format).toEqual({ type: "png", width: 2048, pages: [1] });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/exports/J1"))).toHaveLength(2);
  }, 15_000);

  it("fails with a clear error when the export job fails or points off Canva", async () => {
    fetchMock.mockResolvedValueOnce(json({ job: { id: "J1", status: "failed", error: { code: "export_failed", message: "nope" } } }));
    await expect(exportDesignPng("acc", "DAF1", { width: 2048 })).rejects.toMatchObject({ status: 422 });
    fetchMock.mockReset().mockResolvedValueOnce(json({ job: { id: "J1", status: "success", urls: ["https://evil.example/f.png"] } }));
    await expect(exportDesignPng("acc", "DAF1", { width: 2048 })).rejects.toMatchObject({ code: "bad_download_url" });
  });

  it("imports an exported design into the gallery as source canva", async () => {
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue(await connection());
    fetchMock
      .mockResolvedValueOnce(json({ job: { id: "J1", status: "success", urls: ["https://export-download.canva.com/f.png"] } }))
      .mockResolvedValueOnce(body(png(2048, 1024)));
    await importCanvaDesign(ctx, { designId: "DAF1abcdef", title: "Menu", folderId: null });
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ source: "canva", name: "Menu", width: 2048, height: 1024 });
  });

  it("asks to connect when Canva is not linked, and to reconnect when the scope is missing", async () => {
    mocks.prisma.canvaConnection.findUnique.mockResolvedValueOnce(null);
    await expect(listCanvaDesigns(USER, {})).rejects.toMatchObject({ needsConnect: true });
    mocks.prisma.canvaConnection.findUnique.mockResolvedValue(await connection());
    fetchMock.mockResolvedValueOnce(json({ code: "permission_denied", message: "Missing scope" }, 403));
    const error = await listCanvaDesigns(USER, {}).catch((e) => e);
    expect(error).toBeInstanceOf(CanvaImportError);
    expect(error.needsConnect).toBe(true);
    expect(error.message).toMatch(/Reconnect Canva/);
  });

  it("is unavailable without the Canva keys", async () => {
    delete process.env.CANVA_CLIENT_ID;
    await expect(listCanvaDesigns(USER, {})).rejects.toBeInstanceOf(CanvaImportError);
    await expect(importCanvaDesign(ctx, { designId: "DAF1abcdef", title: "x", folderId: null })).rejects.toBeInstanceOf(CanvaImportError);
  });
});
