import { beforeEach, describe, expect, it, vi } from "vitest";

// The "Upload a video" server actions (app/dashboard/video/actions.ts): the `content` permission (asked on the server),
// the signed-in person's own company for every call, the inputs checked, and plain messages back.

const prisma = vi.hoisted(() => ({ business: { findUnique: vi.fn() } }));
const auth = vi.hoisted(() => ({ requireActiveUser: vi.fn() }));
const upload = vi.hoisted(() => ({ startVideoUploads: vi.fn(), finishVideoUpload: vi.fn() }));
const media = vi.hoisted(() => {
  class MediaError extends Error {}
  return { MediaError, discardUpload: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ featureBlocked: vi.fn(async () => null) }));
vi.mock("@/lib/media/service", () => media);
vi.mock("@/lib/video-library/upload", () => upload);
vi.mock("@/lib/video-library/service", () => {
  class LibraryError extends Error {}
  return { LibraryError, listLibraryVideos: vi.fn(), deleteStudioVideo: vi.fn() };
});
vi.mock("@/lib/video-studio/schedule", () => ({ scheduleJob: vi.fn(), scheduleOptions: vi.fn(), STUDIO_NETWORKS: ["instagram", "facebook", "tiktok", "youtube"] }));
vi.mock("@/lib/video-studio/jobs", () => ({ VideoStudioError: class VideoStudioError extends Error {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), RateLimitError: class RateLimitError extends Error {}, rateLimitMessage: () => "Slow down." }));

import { discardVideoUploadAction, finishVideoUploadAction, startVideoUploadsAction } from "@/app/dashboard/video/actions";
import { ForbiddenError } from "@/lib/team/roles";

beforeEach(() => {
  vi.resetAllMocks();
  auth.requireActiveUser.mockResolvedValue({ id: "owner1", actorId: "person1" });
  prisma.business.findUnique.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === "owner1" ? { id: "biz1" } : null));
});

describe("Upload a video actions", () => {
  it("need the content permission, asked on the server", async () => {
    auth.requireActiveUser.mockRejectedValue(new ForbiddenError("content"));
    const res = await startVideoUploadsAction([{ name: "a.mp4", type: "video/mp4", size: 10 }]);
    expect(res.ok).toBe(false);
    expect(auth.requireActiveUser).toHaveBeenCalledWith("content", "throw");
    expect(upload.startVideoUploads).not.toHaveBeenCalled();
    const fin = await finishVideoUploadAction({ path: "owner1/clips/clip-0000.mp4", title: "" });
    expect(fin.ok).toBe(false);
    expect(upload.finishVideoUpload).not.toHaveBeenCalled();
  });

  it("work inside the signed-in person's own company", async () => {
    upload.startVideoUploads.mockResolvedValue([{ ok: true, path: "owner1/clips/clip-0000.mp4", token: "t", poster: null }]);
    const res = await startVideoUploadsAction([{ name: "a.mp4", type: "video/mp4", size: 10 }]);
    expect(res).toEqual({ ok: true, slots: [{ ok: true, path: "owner1/clips/clip-0000.mp4", token: "t", poster: null }] });
    expect(upload.startVideoUploads).toHaveBeenCalledWith({ userId: "owner1", businessId: "biz1", actorId: "person1" }, [{ name: "a.mp4", type: "video/mp4", size: 10 }]);

    upload.finishVideoUpload.mockResolvedValue({ key: "upload:j1" });
    const fin = await finishVideoUploadAction({ path: "owner1/clips/clip-0000.mp4", title: "Ad", productId: "", width: 1080, height: 1920 });
    expect(fin).toEqual({ ok: true, video: { key: "upload:j1" } });
    expect(upload.finishVideoUpload).toHaveBeenCalledWith({ userId: "owner1", businessId: "biz1", actorId: "person1" }, { path: "owner1/clips/clip-0000.mp4", title: "Ad", productId: null, width: 1080, height: 1920 });

    await discardVideoUploadAction("owner1/clips/clip-0000.mp4");
    expect(media.discardUpload).toHaveBeenCalledWith("owner1", "owner1/clips/clip-0000.mp4");
  });

  it("refuse before onboarding, too many files, and a too-long title; the Gallery's refusals come back in plain words", async () => {
    auth.requireActiveUser.mockResolvedValue({ id: "nobody", actorId: "nobody" });
    expect(await startVideoUploadsAction([{ name: "a.mp4", type: "video/mp4", size: 10 }])).toEqual({ ok: false, error: "Set up your business first." });
    auth.requireActiveUser.mockResolvedValue({ id: "owner1", actorId: "person1" });
    const eleven = Array.from({ length: 11 }, () => ({ name: "a.mp4", type: "video/mp4", size: 10 }));
    expect(await startVideoUploadsAction(eleven)).toEqual({ ok: false, error: "Pick up to 10 videos at a time." });
    expect(await finishVideoUploadAction({ path: "owner1/clips/clip-0000.mp4", title: "x".repeat(201) })).toEqual({ ok: false, error: "Keep the title under 200 characters." });
    upload.finishVideoUpload.mockRejectedValue(new media.MediaError("That file is not an MP4, MOV or WebM video."));
    expect(await finishVideoUploadAction({ path: "owner1/clips/clip-0000.mp4", title: "" })).toEqual({ ok: false, error: "That file is not an MP4, MOV or WebM video." });
  });
});
