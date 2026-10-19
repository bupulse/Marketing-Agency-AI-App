import { beforeEach, describe, expect, it, vi } from "vitest";

// The Videos library (lib/video-library/service.ts) and "Your video is ready" (lib/video-studio/notices.ts), from
// docs/VIDEO_STUDIO_SPLIT.md: studio and post videos in one list, deleting refused while a post waits for the video,
// and one email per company for the videos that finished, never twice.

const h = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  visuals: [] as Record<string, unknown>[],
  waitingPosts: 0,
  resendOn: true,
  sent: [] as { to: string; subject: string }[],
  deletedAssets: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    videoJob: {
      findMany: vi.fn(async ({ where }) =>
        h.jobs.filter(
          (j) =>
            (!where.businessId || j.businessId === where.businessId) &&
            j.status === where.status &&
            j.videoPath &&
            (where.readyNoticeAt === undefined || j.readyNoticeAt === null) &&
            (where.seenAt === undefined || j.seenAt === null),
        ),
      ),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const j of h.jobs) {
          if (!where.id.in.includes(j.id)) continue;
          if (where.readyNoticeAt === null && j.readyNoticeAt !== null) continue;
          if (where.seenAt === null && j.seenAt !== null) continue;
          Object.assign(j, data);
          count += 1;
        }
        return { count };
      }),
      findFirst: vi.fn(async ({ where }) => h.jobs.find((j) => j.id === where.id && j.businessId === where.businessId && j.status === where.status) ?? null),
      findUnique: vi.fn(async ({ where }) => h.jobs.find((j) => j.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }) => Object.assign(h.jobs.find((j) => j.id === where.id)!, data)),
    },
    contentVisual: { findMany: vi.fn(async () => h.visuals) },
    post: { count: vi.fn(async () => h.waitingPosts) },
    mediaAsset: { findFirst: vi.fn(async ({ where }) => ({ id: `asset-of-${where.path}` })) },
    business: { findUnique: vi.fn(async () => ({ name: "Nova Phones", user: { email: "owner@nova.example" } })) },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrls: async (paths: string[], _s: number, opts?: { download?: boolean }) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}${opts?.download ? "?download" : ""}` })) }) }) },
  }),
}));
vi.mock("@/lib/media/service", () => ({ deleteAssets: vi.fn(async (_b: string, ids: string[]) => (h.deletedAssets.push(...ids), ids.length)) }));
vi.mock("@/lib/video-studio/schedule", () => ({ scheduledPostsOf: vi.fn(async () => new Map()) }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: vi.fn(async () => h.resendOn) }));
vi.mock("@/lib/auth/site-url", () => ({ siteUrl: () => "https://bupulse.com" }));
vi.mock("@/lib/team/recipients", () => ({ alertRecipients: vi.fn(async () => ["owner@nova.example"]) }));
vi.mock("@/lib/publishing/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/publishing/email")>()),
  sendEmail: vi.fn(async (e: { to: string; subject: string }) => (h.sent.push({ to: e.to, subject: e.subject }), true)),
}));

import { deleteStudioVideo, LibraryError, listLibraryVideos, markStudioVideosSeen } from "@/lib/video-library/service";
import { readyEmail, sendReadyNotices } from "@/lib/video-studio/notices";

const job = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  businessId: "biz1",
  status: "ready",
  engine: "motion",
  ratio: "9:16",
  durationMs: 15_000,
  createdAt: new Date("2026-10-19T08:00:00Z"),
  videoPath: `u1/clips/${id}.mp4`,
  posterPath: `u1/clips/${id}.jpg`,
  caption: "Galaxy A56 in stock",
  seenAt: null,
  readyNoticeAt: null,
  product: { name: "Galaxy A56" },
  ...extra,
});

beforeEach(() => {
  h.jobs = [];
  h.visuals = [];
  h.waitingPosts = 0;
  h.resendOn = true;
  h.sent = [];
  h.deletedAssets = [];
});

describe("the Videos library", () => {
  it("lists studio and post videos together, newest first, with links to play and to download", async () => {
    h.jobs = [job("j1")];
    h.visuals = [{ id: "cv1", items: [{ path: "u1/videos/cv1.mp4" }], seconds: 12, createdAt: new Date("2026-10-19T09:00:00Z"), content: { caption: "Open today", productId: "p1", campaignId: null, product: { name: "Repairs" } } }];
    const videos = await listLibraryVideos("biz1");
    expect(videos.map((v) => [v.key, v.title, v.isNew])).toEqual([
      ["slideshow:cv1", "Repairs", false],
      ["studio:j1", "Galaxy A56", true],
    ]);
    expect(videos[1]).toMatchObject({ videoUrl: "https://signed/u1/clips/j1.mp4", downloadUrl: "https://signed/u1/clips/j1.mp4?download", posterUrl: "https://signed/u1/clips/j1.jpg", engine: "motion" });
    expect(videos[0].postHref).toBe("/dashboard/content/products/p1");
  });

  it("marks videos seen once the library shows them", async () => {
    h.jobs = [job("j1")];
    await markStudioVideosSeen("biz1", ["j1"], new Date("2026-10-19T10:00:00Z"));
    expect(h.jobs[0].seenAt).toEqual(new Date("2026-10-19T10:00:00Z"));
  });

  it("deletes a studio video's file, unless a post that has not gone out still uses it", async () => {
    h.jobs = [job("j1")];
    h.waitingPosts = 1;
    await expect(deleteStudioVideo("biz1", "j1")).rejects.toBeInstanceOf(LibraryError);
    expect(h.deletedAssets).toEqual([]);
    h.waitingPosts = 0;
    await deleteStudioVideo("biz1", "j1");
    expect(h.deletedAssets).toEqual(["asset-of-u1/clips/j1.mp4"]);
    expect(h.jobs[0]).toMatchObject({ status: "cancelled", videoPath: null });
  });
});

describe("Your video is ready", () => {
  it("sends one email per company for its new videos, and never twice", async () => {
    const now = new Date();
    h.jobs = [job("j1", { updatedAt: now }), job("j2", { updatedAt: now })];
    expect(await sendReadyNotices(now)).toEqual({ companies: 1, videos: 2, emails: 1 });
    expect(h.sent).toEqual([{ to: "owner@nova.example", subject: "2 new videos are ready" }]);
    expect(await sendReadyNotices(now)).toEqual({ companies: 0, videos: 0, emails: 0 });
    expect(h.sent).toHaveLength(1);
  });

  it("does not email a video already opened, and waits while email is switched off", async () => {
    h.jobs = [job("j1", { seenAt: new Date() })];
    expect((await sendReadyNotices()).videos).toBe(0);
    h.jobs = [job("j2")];
    h.resendOn = false;
    expect(await sendReadyNotices()).toMatchObject({ waiting: "resend_off" });
    expect(h.jobs[0].readyNoticeAt).toBeNull();
  });

  it("names the product for a single video and links to it", () => {
    const one = readyEmail({ count: 1, businessName: "Nova Phones", productName: "Galaxy A56", href: "https://bupulse.com/dashboard/video?v=j1" });
    expect(one.subject).toBe("Your video for Galaxy A56 is ready");
    expect(one.html).toContain("https://bupulse.com/dashboard/video?v=j1");
    expect(one.text).toContain("View video");
  });
});
