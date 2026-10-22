import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "Import from a link" (docs/MEDIA.md): link parsing, the private-address guard (on every hop, through the pinned
// node:https connection), Drive's share page, photo vs video routing and the size limits.

type Route = { status?: number; headers?: Record<string, string>; body?: Uint8Array | string };

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    mediaFolder: { findFirst: vi.fn() },
    mediaAsset: { create: vi.fn(), aggregate: vi.fn(), count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    mediaUploadReservation: { aggregate: vi.fn() },
    serviceSwitch: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
  rateLimit: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(),
  createSignedUrls: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  buckets: [] as string[],
  /** host -> addresses node:dns answers with. */
  dns: {} as Record<string, string[]>,
  /** url -> what the website answers. */
  routes: {} as Record<string, Route>,
  requested: [] as string[],
  headers: [] as (Record<string, string> | undefined)[],
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/storage", () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }));
const bucketApi = (name: string) => {
  mocks.buckets.push(name);
  return { upload: mocks.upload, remove: mocks.remove, info: mocks.info, createSignedUrls: mocks.createSignedUrls };
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: bucketApi } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ storage: { from: bucketApi } }) }));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const list = mocks.dns[host];
    if (!list) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  }),
}));

// A website as node:https sees it. The connection asks the given `lookup` first, as Node does, so a refused address
// never reaches the "server".
vi.mock("node:https", () => ({
  request: (url: URL, opts: { lookup: (h: string, o: object, cb: (e: Error | null, a: unknown) => void) => void; headers?: Record<string, string> }, onResponse: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () =>
      opts.lookup(url.hostname, { all: true }, (error) => {
        if (error) return req.emit("error", error);
        mocks.requested.push(url.toString());
        mocks.headers.push(opts.headers);
        const route = mocks.routes[url.toString()] ?? { status: 404, body: "not found" };
        const body = typeof route.body === "string" ? Buffer.from(route.body) : Buffer.from(route.body ?? new Uint8Array());
        const res = Object.assign(Readable.from([body]), { statusCode: route.status ?? 200, headers: Object.fromEntries(Object.entries(route.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
        onResponse(res);
      });
    return req;
  },
}));

import { DRIVE_DOCS_MESSAGE, DRIVE_FOLDER_MESSAGE, DRIVE_SHARE_MESSAGE, DROPBOX_FOLDER_MESSAGE, linkFileName, looksLikeHtml, parseMediaLink, WEB_PAGE_MESSAGE } from "@/lib/media/links";
import { isPublicAddress, LINK_USER_AGENT, publicLookup, resolvePublic } from "@/lib/media/public-dns";
import { importLinkedFile } from "@/lib/media/importers";
import { attachPoster, MediaError } from "@/lib/media/service";
import { heifPhotoType, HEIC_MESSAGE, MEDIA_MAX_BYTES } from "@/lib/media/rules";
import { clearSwitchCache, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";

const USER = "11111111-1111-1111-1111-111111111111";
const ctx = { userId: USER, businessId: "biz1" };
const MB = 1024 * 1024;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0]);
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [...be32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];
const header = (type: string, ms: number) => box(type, [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(Math.round(ms)), ...new Array(80).fill(0)]);
/** A phone-style MP4/MOV: ftyp, an mdat, then the moov (movie header and one track). */
function phoneVideo(durationMs: number, brand = "isom", mdatBytes = 50_000): Uint8Array {
  const ftyp = box("ftyp", [...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 2, 0]);
  const mdat = new Uint8Array(mdatBytes);
  mdat.set([...be32(mdatBytes), ..."mdat".split("").map((c) => c.charCodeAt(0))]);
  const moov = box("moov", [...header("mvhd", durationMs), ...box("trak", box("mdia", header("mdhd", durationMs)))]);
  return new Uint8Array([...ftyp, ...mdat, ...moov]);
}
const PUBLIC = ["93.184.215.14"];
const DRIVE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const DRIVE_DOWNLOAD = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&confirm=t`;

beforeEach(() => {
  vi.resetAllMocks();
  clearSwitchCache();
  mocks.buckets = [];
  mocks.requested = [];
  mocks.headers = [];
  mocks.dns = { "example.com": PUBLIC, "cdn.example.com": PUBLIC, "drive.usercontent.google.com": ["142.250.1.1"], "www.dropbox.com": ["162.125.1.18"], "evil.example.net": ["10.0.0.5"], "meta.example.net": ["169.254.169.254"], "mixed.example.net": ["93.184.215.14", "127.0.0.1"], "v6.example.net": ["::ffff:192.168.1.1"] };
  mocks.routes = {};
  mocks.prisma.serviceSwitch.findMany.mockResolvedValue([]);
  mocks.prisma.mediaFolder.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "f1" ? { id: "f1", name: "Imports" } : null));
  mocks.prisma.mediaAsset.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
  mocks.prisma.mediaUploadReservation.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { bytes: 0 } });
  mocks.prisma.$queryRaw.mockRejectedValue(new Error("no storage schema"));
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: typeof mocks.prisma) => unknown) => fn(mocks.prisma));
  mocks.prisma.mediaAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, createdAt: new Date() }));
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.createSignedUrls.mockImplementation(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })) }));
  mocks.createSignedUploadUrl.mockImplementation(async (_bucket: string, path: string) => ({ path, token: "poster-token", signedUrl: "x" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("parseMediaLink", () => {
  const url = (raw: string) => {
    const r = parseMediaLink(raw);
    if (!r.ok) throw new Error(r.error);
    return r.link;
  };

  it("turns every Drive file link into Drive's direct download", () => {
    for (const raw of [
      `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
      `https://drive.google.com/file/u/1/d/${DRIVE_ID}/view`,
      `https://drive.google.com/open?id=${DRIVE_ID}`,
      `https://drive.google.com/uc?id=${DRIVE_ID}&export=download`,
      `https://docs.google.com/uc?id=${DRIVE_ID}`,
      `drive.google.com/file/d/${DRIVE_ID}/view`,
      `  https://drive.google.com/file/d/${DRIVE_ID}  `,
    ])
      expect(url(raw)).toEqual({ kind: "drive", url: DRIVE_DOWNLOAD });
  });

  it("explains Drive folders, Docs files and links without a file", () => {
    expect(parseMediaLink("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp")).toEqual({ ok: false, error: DRIVE_FOLDER_MESSAGE });
    expect(parseMediaLink("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp")).toEqual({ ok: false, error: DRIVE_FOLDER_MESSAGE });
    expect(parseMediaLink("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit")).toEqual({ ok: false, error: DRIVE_DOCS_MESSAGE });
    expect(parseMediaLink("https://drive.google.com/open?id=x")).toEqual({ ok: false, error: DRIVE_SHARE_MESSAGE });
  });

  it("asks Dropbox for the file itself (dl=1) and keeps the link key", () => {
    expect(url("https://www.dropbox.com/scl/fi/abc123/shop%20front.jpg?rlkey=k9&dl=0")).toEqual({ kind: "dropbox", url: "https://www.dropbox.com/scl/fi/abc123/shop%20front.jpg?rlkey=k9&dl=1" });
    expect(url("https://www.dropbox.com/s/abc/clip.mp4?raw=1").url).toBe("https://www.dropbox.com/s/abc/clip.mp4?dl=1");
    expect(url("https://dl.dropboxusercontent.com/s/abc/clip.mp4").url).toBe("https://dl.dropboxusercontent.com/s/abc/clip.mp4");
    expect(parseMediaLink("https://www.dropbox.com/scl/fo/abc/def?rlkey=k&dl=0")).toEqual({ ok: false, error: DROPBOX_FOLDER_MESSAGE });
    expect(parseMediaLink("https://www.dropbox.com/sh/abc/def?dl=0")).toEqual({ ok: false, error: DROPBOX_FOLDER_MESSAGE });
  });

  it("takes any other https link as it is, without its #fragment", () => {
    expect(url("https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg#top")).toEqual({ kind: "web", url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg" });
  });

  it("refuses http, IP addresses, private and local names, credentials, odd ports, junk and very long links", () => {
    const refused = (raw: string) => expect(parseMediaLink(raw).ok, raw).toBe(false);
    for (const raw of [
      "",
      "http://example.com/a.jpg",
      "ftp://example.com/a.jpg",
      "file:///etc/passwd",
      "https://127.0.0.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/a.jpg",
      "https://0x7f000001/a.jpg",
      "https://localhost/a.jpg",
      "https://printer.local/a.jpg",
      "https://db.internal/a.jpg",
      "https://metadata/a.jpg",
      "https://user:pw@example.com/a.jpg",
      "https://example.com:8443/a.jpg",
      "not a link at all",
      `https://example.com/${"a".repeat(2000)}.jpg`,
    ])
      refused(raw);
    expect(parseMediaLink("http://example.com/a.jpg")).toEqual({ ok: false, error: "Use a link that starts with https://." });
  });
});

describe("linkFileName and looksLikeHtml", () => {
  it("prefers the server's filename, then the link's last part with an extension", () => {
    expect(linkFileName('attachment; filename="Shop front.jpg"', DRIVE_DOWNLOAD)).toBe("Shop front.jpg");
    expect(linkFileName("attachment; filename*=UTF-8''Caf%C3%A9.mp4", "https://x.com/a")).toBe("Café.mp4");
    expect(linkFileName(null, "https://cdn.example.com/media/Summer%20sale.png?w=2")).toBe("Summer sale.png");
    expect(linkFileName(null, DRIVE_DOWNLOAD)).toBeNull();
  });

  it("knows a web page from a file", () => {
    expect(looksLikeHtml(new TextEncoder().encode("\n  <!DOCTYPE html><html>"))).toBe(true);
    expect(looksLikeHtml(new TextEncoder().encode("<html lang=en>"))).toBe(true);
    expect(looksLikeHtml(JPEG)).toBe(false);
  });
});

describe("the private-address guard", () => {
  it("treats only public addresses as public", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:a00:1::1", "224.0.0.1"])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses a name that points to a private address, or to any private address among public ones", async () => {
    await expect(resolvePublic("example.com")).resolves.toHaveLength(1);
    for (const host of ["evil.example.net", "meta.example.net", "mixed.example.net", "v6.example.net", "localhost", "db.internal"]) await expect(resolvePublic(host), host).rejects.toMatchObject({ code: "blocked" });
    await expect(resolvePublic("nowhere.example.org")).rejects.toMatchObject({ code: "network" });
  });

  it("gives node:https only the checked addresses", async () => {
    const answer = await new Promise<unknown[]>((resolve, reject) => publicLookup("example.com", { all: true }, (e, a) => (e ? reject(e) : resolve([a]))));
    expect(answer).toEqual([[{ address: PUBLIC[0], family: 4 }]]);
    const one = await new Promise<unknown[]>((resolve) => publicLookup("example.com", {}, (e, a, f) => resolve([e, a, f])));
    expect(one).toEqual([null, PUBLIC[0], 4]);
    const refused = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicLookup("evil.example.net", { all: true }, (e) => resolve(e)));
    expect(refused?.code).toBe("EBLOCKED");
  });
});

describe("importLinkedFile", () => {
  const run = (link: string, extra: { videos?: boolean } = {}) => importLinkedFile(ctx, { link, destination: "folder:f1", ...extra });

  it("imports a photo from a website with the link source, its name and a User-Agent", async () => {
    mocks.routes["https://example.com/photos/Shop%20front.jpg"] = { headers: { "content-type": "application/octet-stream" }, body: JPEG };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { item, poster } = await run("https://example.com/photos/Shop%20front.jpg");
    expect(poster).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // the download goes through the pinned connection, not the global fetch
    const data = mocks.prisma.mediaAsset.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ source: "link", name: "Shop front", mimeType: "image/jpeg", width: 640, height: 480 });
    expect(item.path).toMatch(new RegExp(`^${USER}/gallery/.+\\.jpg$`));
    expect(mocks.rateLimit).toHaveBeenCalledWith(`media-import:${USER}`, expect.anything());
    expect(mocks.headers[0]).toMatchObject({ "User-Agent": LINK_USER_AGENT });
  });

  it("follows a redirect to another public host and refuses one that points to a private address", async () => {
    mocks.routes["https://example.com/a.jpg"] = { status: 302, headers: { location: "https://cdn.example.com/a.jpg" } };
    mocks.routes["https://cdn.example.com/a.jpg"] = { body: JPEG };
    await expect(run("https://example.com/a.jpg")).resolves.toMatchObject({ item: { mimeType: "image/jpeg" } });

    mocks.requested = [];
    mocks.routes["https://example.com/b.jpg"] = { status: 302, headers: { location: "https://evil.example.net/latest/meta-data" } };
    await expect(run("https://example.com/b.jpg")).rejects.toThrow("private or local address");
    expect(mocks.requested).toEqual(["https://example.com/b.jpg"]);

    mocks.routes["https://example.com/c.jpg"] = { status: 301, headers: { location: "https://127.0.0.1/x" } };
    await expect(run("https://example.com/c.jpg")).rejects.toBeInstanceOf(MediaError);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("refuses a first host that resolves to a private or metadata address before connecting", async () => {
    for (const link of ["https://evil.example.net/a.jpg", "https://meta.example.net/a.jpg", "https://mixed.example.net/a.jpg"]) await expect(run(link), link).rejects.toThrow("private or local address");
    expect(mocks.requested).toEqual([]);
  });

  it("tells the person to share a Drive file that is not public", async () => {
    mocks.routes[DRIVE_DOWNLOAD] = { headers: { "content-type": "text/html; charset=utf-8" }, body: "<!doctype html><title>Sign in</title>" };
    await expect(run(`https://drive.google.com/file/d/${DRIVE_ID}/view`)).rejects.toThrow(DRIVE_SHARE_MESSAGE);
    mocks.routes[DRIVE_DOWNLOAD] = { status: 403, body: "denied" };
    await expect(run(`https://drive.google.com/file/d/${DRIVE_ID}/view`)).rejects.toThrow(DRIVE_SHARE_MESSAGE);
    // A page sent without its type is still a page.
    mocks.routes[DRIVE_DOWNLOAD] = { body: "<html><body>Google Drive</body></html>" };
    await expect(run(`https://drive.google.com/file/d/${DRIVE_ID}/view`)).rejects.toThrow(DRIVE_SHARE_MESSAGE);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("imports a public Drive photo under Drive's file name", async () => {
    mocks.routes[DRIVE_DOWNLOAD] = { headers: { "content-type": "image/jpeg", "content-disposition": 'attachment; filename="Menu board.jpg"' }, body: JPEG };
    await run(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`);
    expect(mocks.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({ name: "Menu board", source: "link" });
  });

  it("says when a website link is a page, not a file", async () => {
    mocks.routes["https://example.com/post/123"] = { headers: { "content-type": "text/html" }, body: "<html></html>" };
    await expect(run("https://example.com/post/123")).rejects.toThrow(WEB_PAGE_MESSAGE);
  });

  it("imports a video into the private video bucket with its length, and hands back a poster slot", async () => {
    mocks.routes["https://www.dropbox.com/s/abc/Launch.mov?dl=1"] = { headers: { "content-type": "text/plain" }, body: phoneVideo(12_000, "qt  ") };
    const { item, poster } = await run("https://www.dropbox.com/s/abc/Launch.mov?dl=0");
    const data = mocks.prisma.mediaAsset.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "video", mimeType: "video/mp4", durationMs: 12_000, posterPath: null, source: "link", name: "Launch" });
    expect(item.path).toMatch(new RegExp(`^${USER}/clips/.+\\.mp4$`));
    expect(mocks.buckets).toContain("gallery-videos");
    expect(mocks.upload.mock.calls[0][2]).toMatchObject({ contentType: "video/mp4" });
    expect(poster).toEqual({ path: item.path.replace(/\.mp4$/, "-poster.jpg"), token: "poster-token" });
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith("gallery-videos", poster!.path);
  });

  it("refuses a video over 60 seconds, a video where only photos go, and a video past the company's video cap", async () => {
    mocks.routes["https://example.com/long.mp4"] = { body: phoneVideo(75_000) };
    await expect(run("https://example.com/long.mp4")).rejects.toThrow("at most 60 seconds");
    mocks.routes["https://example.com/short.mp4"] = { body: phoneVideo(5_000) };
    await expect(run("https://example.com/short.mp4", { videos: false })).rejects.toThrow("Only photos can be added here");
    mocks.prisma.mediaAsset.aggregate.mockImplementation(async ({ where }: { where: { kind?: string } }) => (where.kind === "video" ? { _count: { _all: 2 }, _sum: { bytes: 100 * MB } } : { _count: { _all: 0 }, _sum: { bytes: 0 } }));
    await expect(run("https://example.com/short.mp4")).rejects.toThrow("Your videos have reached");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps photos to 10 MB and videos to 50 MB, by the declared size and by the bytes", async () => {
    mocks.routes["https://example.com/huge.mp4"] = { headers: { "content-length": String(60 * MB) }, body: JPEG };
    await expect(run("https://example.com/huge.mp4")).rejects.toThrow("over 50 MB");
    mocks.routes["https://example.com/big.jpg"] = { headers: { "content-length": String(12 * MB) }, body: JPEG };
    await expect(run("https://example.com/big.jpg", { videos: false })).rejects.toThrow("That photo is over 10 MB");
    const big = new Uint8Array(MEDIA_MAX_BYTES + 10);
    big.set(JPEG);
    mocks.routes["https://example.com/big2.jpg"] = { body: big };
    await expect(run("https://example.com/big2.jpg")).rejects.toThrow("over 10 MB");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("explains HEIC photos and refuses other files", async () => {
    const heic = new Uint8Array(box("ftyp", [..."heic".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0]));
    expect(heifPhotoType(heic)).toBe("heic");
    expect(heifPhotoType(phoneVideo(1000))).toBeNull();
    mocks.routes["https://example.com/a.heic"] = { body: heic };
    await expect(run("https://example.com/a.heic")).rejects.toThrow(HEIC_MESSAGE);
    mocks.routes["https://example.com/a.pdf"] = { body: "%PDF-1.7" };
    await expect(run("https://example.com/a.pdf")).rejects.toThrow("Use a JPG, PNG or WebP photo");
  });

  it("is refused when the admin switched link import off, before downloading", async () => {
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "link-import", enabled: false }]);
    await expect(run("https://example.com/a.jpg")).rejects.toThrow(UNAVAILABLE_MESSAGE);
    expect(mocks.requested).toEqual([]);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });
});

describe("attachPoster", () => {
  const VIDEO = `${USER}/clips/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp4`;
  const row = { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "Launch", path: VIDEO, width: null, height: null, mimeType: "video/mp4", bytes: 1000, folderId: "f1", createdAt: new Date(), kind: "video", durationMs: 12_000, posterPath: null, description: null };
  const poster = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 1280 >> 8, 1280 & 255, 720 >> 8, 720 & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("keeps a valid poster, counts its bytes and records the size the browser read", async () => {
    mocks.prisma.mediaAsset.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, posterPath: VIDEO.replace(".mp4", "-poster.jpg"), width: 720, height: 1280 });
    mocks.info.mockResolvedValue({ data: { size: poster.length } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(poster.slice(), { status: 206 })));
    const item = await attachPoster(ctx, { id: row.id, width: 720, height: 1280 });
    expect(mocks.prisma.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, businessId: "biz1", posterPath: null },
      data: { width: 720, height: 1280, posterPath: VIDEO.replace(".mp4", "-poster.jpg"), bytes: { increment: poster.length } },
    });
    expect(item.posterUrl).toContain("-poster.jpg");
  });

  it("drops a poster that is not a small JPEG but still records the size", async () => {
    mocks.prisma.mediaAsset.findFirst.mockResolvedValue(row);
    mocks.info.mockResolvedValue({ data: { size: 20 } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(20).fill(7), { status: 206 })));
    await attachPoster(ctx, { id: row.id, width: 1080, height: 1920 });
    expect(mocks.prisma.mediaAsset.updateMany.mock.calls[0][0].data).toEqual({ width: 1080, height: 1920 });
    expect(mocks.remove).toHaveBeenCalledWith([VIDEO.replace(".mp4", "-poster.jpg")]);
  });

  it("only touches the person's own video", async () => {
    mocks.prisma.mediaAsset.findFirst.mockResolvedValue({ ...row, path: `22222222-2222-2222-2222-222222222222/clips/${row.id}.mp4` });
    await expect(attachPoster(ctx, { id: row.id })).rejects.toThrow("We could not find that video.");
    mocks.prisma.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(attachPoster(ctx, { id: row.id })).rejects.toThrow("We could not find that video.");
    expect(mocks.prisma.mediaAsset.updateMany).not.toHaveBeenCalled();
  });
});
