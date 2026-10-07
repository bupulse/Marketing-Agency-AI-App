import { describe, expect, it } from "vitest";
import { isOwnPhotoPath } from "@/lib/designs/assets";
import {
  assetIdFromPath,
  cleanPhotoName,
  fileProblem,
  folderNameProblem,
  galleryPath,
  inferMimeType,
  isOwnGalleryPath,
  MEDIA_MAX_ASSETS,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_TOTAL_BYTES,
  nameFromFile,
  quotaProblem,
  scaledSize,
  sniffMediaType,
} from "@/lib/media/rules";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("fileProblem", () => {
  it("accepts jpeg, png and webp up to 10 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(fileProblem({ name: "a", type, size: MEDIA_MAX_BYTES })).toBeNull();
  });
  it("rejects other types, empty and oversized files", () => {
    expect(fileProblem({ name: "a.gif", type: "image/gif", size: 10 })).toMatch(/JPG, PNG or WebP/);
    expect(fileProblem({ name: "a.png", type: "image/png", size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: "a.png", type: "image/png", size: MEDIA_MAX_BYTES + 1 })).toMatch(/10 MB/);
  });
  it("turns HEIC away with a friendly message, by type or extension", () => {
    expect(fileProblem({ name: "IMG_1.HEIC", type: "", size: 10 })).toMatch(/HEIC/);
    expect(fileProblem({ name: "x.jpg", type: "image/heif", size: 10 })).toMatch(/HEIC/);
  });
  it("falls back to the extension when the browser gives no type", () => {
    expect(inferMimeType("a.JPG", "")).toBe("image/jpeg");
    expect(fileProblem({ name: "a.webp", type: "", size: 10 })).toBeNull();
  });
});

describe("gallery paths", () => {
  it("builds <userId>/gallery/<id>.<ext>", () => {
    expect(galleryPath(USER, ID, "image/png")).toBe(`${USER}/gallery/${ID}.png`);
    expect(galleryPath(USER, ID, "image/jpeg")).toBe(`${USER}/gallery/${ID}.jpg`);
    expect(assetIdFromPath(`${USER}/gallery/${ID}.png`)).toBe(ID);
  });
  it("only accepts the user's own gallery files", () => {
    expect(isOwnGalleryPath(USER, `${USER}/gallery/${ID}.webp`)).toBe(true);
    expect(isOwnGalleryPath(USER, `${OTHER}/gallery/${ID}.webp`)).toBe(false);
    expect(isOwnGalleryPath(USER, `${USER}/gallery/../${OTHER}/gallery/${ID}.webp`)).toBe(false);
    expect(isOwnGalleryPath(USER, `${USER}/gallery/sub/${ID}.webp`)).toBe(false);
    expect(isOwnGalleryPath(USER, `${USER}/gallery/${ID}.gif`)).toBe(false);
    expect(isOwnGalleryPath(USER, `${USER}/projects/${ID}.png`)).toBe(false);
  });
  it("lets designs use project and gallery photos, and nothing of anyone else's", () => {
    expect(isOwnPhotoPath(USER, `${USER}/projects/x-photo.png`)).toBe(true);
    expect(isOwnPhotoPath(USER, `${USER}/gallery/${ID}.png`)).toBe(true);
    expect(isOwnPhotoPath(USER, `${OTHER}/gallery/${ID}.png`)).toBe(false);
    expect(isOwnPhotoPath(USER, `${USER}/designs/${ID}.png`)).toBe(false);
    expect(isOwnPhotoPath(USER, `${USER}/gallery/..\\x.png`)).toBe(false);
  });
});

describe("quotaProblem", () => {
  it("allows uploads that fit", () => {
    expect(quotaProblem({ count: 10, bytes: 1000 }, { count: 5, bytes: 500 })).toBeNull();
    expect(quotaProblem({ count: MEDIA_MAX_ASSETS - 1, bytes: 0 }, { count: 1, bytes: 1 })).toBeNull();
  });
  it("stops at 500 photos", () => {
    expect(quotaProblem({ count: MEDIA_MAX_ASSETS, bytes: 0 }, { count: 1, bytes: 1 })).toMatch(/500 photos/);
  });
  it("stops at 2 GB", () => {
    expect(quotaProblem({ count: 1, bytes: MEDIA_MAX_TOTAL_BYTES - 5 }, { count: 1, bytes: 6 })).toMatch(/2 GB/);
  });
});

describe("names", () => {
  it("validates folder names", () => {
    expect(folderNameProblem("  ")).toMatch(/name/);
    expect(folderNameProblem("x".repeat(61))).toMatch(/60/);
    expect(folderNameProblem("Summer party")).toBeNull();
  });
  it("cleans photo names", () => {
    expect(cleanPhotoName("  a\n  b ")).toBe("a b");
    expect(cleanPhotoName("   ", "Photo")).toBe("Photo");
    expect(cleanPhotoName("x".repeat(300))).toHaveLength(120);
    expect(nameFromFile("Summer_party-3.JPG")).toBe("Summer party 3");
  });
});

describe("sniffMediaType", () => {
  it("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMediaType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("refuses everything else", () => {
    expect(sniffMediaType(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffMediaType(new TextEncoder().encode("<svg xmlns=...>"))).toBeNull();
    expect(sniffMediaType(new Uint8Array([]))).toBeNull();
  });
});

describe("scaledSize", () => {
  it("keeps photos that already fit", () => {
    expect(scaledSize(2048, 1000)).toEqual({ width: 2048, height: 1000 });
  });
  it("scales the long side to 2048 and keeps the ratio", () => {
    expect(scaledSize(4096, 3072)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(3000, 6000)).toEqual({ width: 1024, height: 2048 });
    expect(scaledSize(10000, 1)).toEqual({ width: 2048, height: 1 });
  });
});
