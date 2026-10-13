import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  connection: { findMany: vi.fn() },
  product: { findFirst: vi.fn() },
  campaign: { findFirst: vi.fn() },
  generatedContent: { findFirst: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  business: { findUnique: vi.fn(), update: vi.fn() },
  autopilotSettings: { findUnique: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  post: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));

import {
  approvePosts,
  createPosts,
  deletePost,
  duplicatePost,
  markPosted,
  markPostedFromEmail,
  PublishingError,
  reschedulePost,
  retryPost,
  unschedulePost,
  updatePost,
} from "@/lib/publishing/service";
import type { ComposeInput } from "@/lib/publishing/types";

const owner = { businessId: "b1", userId: "u1" };
const now = new Date("2026-10-07T08:00:00Z"); // 10:00 in Kigali

const instagram = { id: "c-ig", provider: "instagram", displayName: "Bakery IG", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL", businessId: "b1" };
const facebook = { id: "c-fb", provider: "facebook", displayName: "Bakery Page", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL", businessId: "b1" };
const tiktok = { id: "c-tt", provider: "tiktok", displayName: "Bakery TikTok", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL", businessId: "b1" };
const photo = "u1/gallery/a.jpg";

function compose(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return { connectionIds: ["c-fb"], text: "Fresh bread", hashtags: ["#bread"], overrides: {}, mediaPaths: [], when: { mode: "queue" }, ...overrides };
}

function code(promise: Promise<unknown>) {
  return promise.then(
    () => "ok",
    (e: unknown) => (e instanceof PublishingError ? e.code : `other:${String(e)}`),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  prisma.business.findUnique.mockResolvedValue({ timezone: "Africa/Kigali" });
  prisma.autopilotSettings.findUnique.mockResolvedValue(null);
  prisma.connection.findMany.mockResolvedValue([facebook]);
  prisma.post.findMany.mockResolvedValue([]);
  prisma.mediaAsset.findMany.mockResolvedValue([]);
  prisma.post.create.mockImplementation(async ({ data }: { data: { connectionId: string } }) => ({ id: `post-${data.connectionId}` }));
  prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[] | ((tx: typeof prisma) => Promise<unknown>)) => (typeof ops === "function" ? ops(prisma) : Promise.all(ops)));
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.deleteMany.mockResolvedValue({ count: 1 });
});

describe("createPosts", () => {
  it("makes one post per account, all sharing a groupId", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram, facebook]);
    const result = await createPosts(owner, compose({ connectionIds: ["c-ig", "c-fb"], mediaPaths: [photo] }), now);
    expect(prisma.post.create).toHaveBeenCalledTimes(2);
    const rows = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => r.connectionId)).toEqual(["c-ig", "c-fb"]);
    expect(rows.map((r) => r.network)).toEqual(["instagram", "facebook"]);
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
    expect(rows[0].groupId).toBe(result.groupId);
    expect(rows.every((r) => r.businessId === "b1" && r.source === "MANUAL" && r.status === "SCHEDULED")).toBe(true);
    expect(result.postIds).toHaveLength(2);
  });

  it("gives each network its own text when the owner customised it", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram, facebook]);
    await createPosts(owner, compose({ connectionIds: ["c-ig", "c-fb"], mediaPaths: [photo], overrides: { instagram: { text: "Short IG caption", hashtags: ["#ig"] } } }), now);
    const [ig, fb] = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(ig).toMatchObject({ text: "Short IG caption", hashtags: ["#ig"] });
    expect(fb).toMatchObject({ text: "Fresh bread", hashtags: ["#bread"] });
  });

  it("picks the carousel format for several images and SCRIPT for video-only networks", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram, tiktok]);
    await createPosts(owner, compose({ connectionIds: ["c-ig", "c-tt"], mediaPaths: [photo, "u1/gallery/b.jpg"] }), now);
    const [ig, tt] = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(ig.format).toBe("CAROUSEL");
    expect(tt.format).toBe("SCRIPT");
  });

  it("rejects an Instagram post without an image and saves nothing", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram]);
    const error = await createPosts(owner, compose({ connectionIds: ["c-ig"] }), now).catch((e) => e);
    expect(error).toBeInstanceOf(PublishingError);
    expect(error.message).toMatch(/need a photo/);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("rejects text over the network's limit", async () => {
    const error = await createPosts(owner, compose({ connectionIds: ["c-fb"], text: "x".repeat(70_000) }), now).catch((e) => e);
    expect(error).toBeInstanceOf(PublishingError);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("lets a draft skip the network rules", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram]);
    const result = await createPosts(owner, compose({ connectionIds: ["c-ig"], when: { mode: "draft" } }), now);
    expect(result.status).toBe("DRAFT");
    expect(prisma.post.create.mock.calls[0][0].data).toMatchObject({ status: "DRAFT", scheduledAt: null });
  });

  it("will not schedule to an account that needs reconnecting", async () => {
    prisma.connection.findMany.mockResolvedValue([{ ...facebook, status: "EXPIRED" }]);
    expect(await code(createPosts(owner, compose(), now))).toBe("invalid");
  });

  it("allows reminder (NOTIFY) accounts that are not ACTIVE", async () => {
    prisma.connection.findMany.mockResolvedValue([{ ...instagram, postingMode: "NOTIFY", status: "ACTIVE" }]);
    expect(await code(createPosts(owner, compose({ connectionIds: ["c-ig"], mediaPaths: [photo] }), now))).toBe("ok");
  });

  describe("when", () => {
    it("Add to queue uses the next free slot of the business, in its time zone", async () => {
      // 10:00 in Kigali: the 09:00 slot has passed; 18:00 Kigali is 16:00 UTC.
      const result = await createPosts(owner, compose({ when: { mode: "queue" } }), now);
      expect(result.scheduledAt?.toISOString()).toBe("2026-10-07T16:00:00.000Z");
      expect(prisma.post.create.mock.calls[0][0].data.scheduledAt.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    });

    it("Add to queue skips slots the chosen accounts already use and honours saved posting times", async () => {
      prisma.autopilotSettings.findUnique.mockResolvedValue({ postingTimes: ["12:00", "18:00"] });
      prisma.post.findMany.mockResolvedValue([{ scheduledAt: new Date("2026-10-07T10:00:00Z") }]); // 12:00 Kigali taken
      const result = await createPosts(owner, compose({ when: { mode: "queue" } }), now);
      expect(result.scheduledAt?.toISOString()).toBe("2026-10-07T16:00:00.000Z");
      const where = prisma.post.findMany.mock.calls[0][0].where;
      expect(where.connectionId).toEqual({ in: ["c-fb"] });
    });

    it("Schedule reads the local time in the business zone", async () => {
      const result = await createPosts(owner, compose({ when: { mode: "schedule", local: "2026-10-09T09:30" } }), now);
      expect(result.scheduledAt?.toISOString()).toBe("2026-10-09T07:30:00.000Z");
    });

    it("Schedule rejects a time in the past or a malformed one", async () => {
      expect(await code(createPosts(owner, compose({ when: { mode: "schedule", local: "2026-10-07T09:00" } }), now))).toBe("invalid");
      expect(await code(createPosts(owner, compose({ when: { mode: "schedule", local: "tomorrow" } }), now))).toBe("invalid");
    });

    it("Post now is due immediately", async () => {
      const result = await createPosts(owner, compose({ when: { mode: "now" } }), now);
      expect(result.scheduledAt).toEqual(now);
      expect(prisma.post.create.mock.calls[0][0].data.status).toBe("SCHEDULED");
    });
  });

  describe("only touches the owner's own things", () => {
    it("rejects a connection that belongs to another business", async () => {
      prisma.connection.findMany.mockResolvedValue([]); // the query is scoped by businessId
      expect(await code(createPosts(owner, compose({ connectionIds: ["someone-elses"] }), now))).toBe("not_found");
      expect(prisma.connection.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "b1", kind: "SOCIAL" });
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it("rejects when only some of the accounts are the owner's", async () => {
      prisma.connection.findMany.mockResolvedValue([facebook]);
      expect(await code(createPosts(owner, compose({ connectionIds: ["c-fb", "someone-elses"] }), now))).toBe("not_found");
    });

    it("rejects photos outside the owner's folder", async () => {
      expect(await code(createPosts(owner, compose({ mediaPaths: ["u2/gallery/a.jpg"] }), now))).toBe("invalid");
      expect(await code(createPosts(owner, compose({ mediaPaths: ["u1/../u2/gallery/a.jpg"] }), now))).toBe("invalid");
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it("rejects another business's product, campaign or content", async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      prisma.campaign.findFirst.mockResolvedValue(null);
      expect(await code(createPosts(owner, compose({ subjectId: "other-product" }), now))).toBe("not_found");
      expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({ id: "other-product", businessId: "b1" });
      expect(prisma.campaign.findFirst.mock.calls[0][0].where).toEqual({ id: "other-product", businessId: "b1" });
      prisma.generatedContent.findFirst.mockResolvedValue(null);
      expect(await code(createPosts(owner, compose({ contentId: "other-content" }), now))).toBe("not_found");
      expect(prisma.generatedContent.findFirst.mock.calls[0][0].where).toEqual({ id: "other-content", businessId: "b1" });
    });
  });
});

describe("a post made from content takes its visual (docs/CONTENT_VISUALS.md)", () => {
  const linkedin = { id: "c-li", provider: "linkedin", displayName: "Bakery LI", status: "ACTIVE", postingMode: "AUTO", kind: "SOCIAL", businessId: "b1" };
  const slides = ["u1/designs/s1.png", "u1/designs/s2.png", "u1/designs/s3.png"];
  const video = "u1/videos/v1-abcd1.mp4";

  beforeEach(() => {
    prisma.generatedContent.findFirst.mockResolvedValue({ id: "content-1" });
    prisma.contentVisual.findMany.mockResolvedValue([
      { kind: "carousel", status: "ready", items: slides.map((path) => ({ path })) },
      { kind: "video", status: "ready", items: [{ path: video }] },
    ]);
    prisma.connection.findMany.mockResolvedValue([instagram, linkedin, tiktok]);
  });

  it("the carousel goes out as a carousel; TikTok's script reminder carries the video", async () => {
    await createPosts(owner, compose({ connectionIds: ["c-ig", "c-li", "c-tt"], contentId: "content-1", mediaPaths: slides, overrides: { tiktok: { text: "Hook: look" } } }), now);
    const rows = Object.fromEntries(prisma.post.create.mock.calls.map((c) => [c[0].data.network, c[0].data]));
    expect(rows.instagram).toMatchObject({ format: "CAROUSEL", mediaPaths: slides, contentId: "content-1" });
    expect(rows.linkedin).toMatchObject({ format: "CAROUSEL", mediaPaths: slides });
    expect(rows.tiktok).toMatchObject({ format: "SCRIPT", mediaPaths: [video] });
    expect(prisma.contentVisual.findMany.mock.calls[0][0].where).toMatchObject({ businessId: "b1", contentId: "content-1", status: "ready" });
  });

  it("the video as media: a Reel on Instagram, the content's pictures on LinkedIn", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram, linkedin]);
    await createPosts(owner, compose({ connectionIds: ["c-ig", "c-li"], contentId: "content-1", mediaPaths: [video] }), now);
    const rows = Object.fromEntries(prisma.post.create.mock.calls.map((c) => [c[0].data.network, c[0].data]));
    expect(rows.instagram).toMatchObject({ format: "POST", mediaPaths: [video] });
    expect(rows.linkedin).toMatchObject({ format: "CAROUSEL", mediaPaths: slides });
  });
});

describe("actions on existing posts are scoped to the business (IDOR)", () => {
  const post = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "p1",
    businessId: "b1",
    connectionId: "c-fb",
    network: "facebook",
    status,
    format: "POST",
    text: "Hello",
    hashtags: [],
    mediaPaths: [],
    scheduledAt: new Date("2026-10-09T07:00:00Z"),
    connection: { id: "c-fb", displayName: "Page", provider: "facebook", status: "ACTIVE", postingMode: "AUTO" },
    ...extra,
  });
  const edit = { text: "New text", hashtags: [], mediaPaths: [], when: { mode: "keep" as const } };

  it("looks every post up by id and businessId, and another business's post is simply not found", async () => {
    prisma.post.findFirst.mockResolvedValue(null);
    const calls = [
      () => updatePost(owner, "p1", edit, now),
      () => reschedulePost(owner, "p1", new Date("2026-10-20T10:00:00Z"), now),
      () => duplicatePost(owner, "p1"),
      () => deletePost(owner, "p1"),
      () => retryPost(owner, "p1", now),
    ];
    for (const call of calls) expect(await code(call())).toBe("not_found");
    for (const call of prisma.post.findFirst.mock.calls) expect(call[0].where).toMatchObject({ id: "p1", businessId: "b1" });
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("writes are scoped by businessId too, so a race cannot cross businesses", async () => {
    prisma.post.findFirst.mockResolvedValue(post("SCHEDULED"));
    await updatePost(owner, "p1", edit, now);
    expect(prisma.post.updateMany.mock.calls[0][0].where).toMatchObject({ id: "p1", businessId: "b1" });
    await reschedulePost(owner, "p1", new Date("2026-10-20T10:00:00Z"), now);
    expect(prisma.post.updateMany.mock.calls[1][0].where).toMatchObject({ id: "p1", businessId: "b1" });
    await deletePost(owner, "p1");
    expect(prisma.post.deleteMany.mock.calls[0][0].where).toMatchObject({ id: "p1", businessId: "b1" });
  });

  it("markPosted only changes the business's own NEEDS_ACTION posts", async () => {
    prisma.post.updateMany.mockResolvedValue({ count: 0 });
    prisma.post.findFirst.mockResolvedValue(null);
    expect(await code(markPosted("b1", "p-other", now))).toBe("not_found");
    expect(prisma.post.updateMany.mock.calls[0][0].where).toEqual({ id: "p-other", businessId: "b1", status: "NEEDS_ACTION" });
  });

  it("markPosted says so when the post is not waiting to be posted by hand", async () => {
    prisma.post.updateMany.mockResolvedValue({ count: 0 });
    prisma.post.findFirst.mockResolvedValue({ status: "SCHEDULED" });
    expect(await code(markPosted("b1", "p1", now))).toBe("conflict");
    prisma.post.findFirst.mockResolvedValue({ status: "PUBLISHED" });
    expect(await code(markPosted("b1", "p1", now))).toBe("ok");
  });

  it("the email link marks the post of whichever business owns it, and reports unknown posts", async () => {
    prisma.post.findUnique.mockResolvedValue(null);
    expect(await markPostedFromEmail("nope")).toEqual({ found: false });
    prisma.post.findUnique.mockResolvedValue({ businessId: "b9" });
    expect(await markPostedFromEmail("p9", now)).toEqual({ found: true });
    expect(prisma.post.updateMany.mock.calls[0][0].where).toEqual({ id: "p9", businessId: "b9", status: "NEEDS_ACTION" });
  });

  it("does not let a live or publishing post be edited, moved or deleted", async () => {
    prisma.post.findFirst.mockResolvedValue(post("PUBLISHED"));
    expect(await code(updatePost(owner, "p1", edit, now))).toBe("conflict");
    expect(await code(reschedulePost(owner, "p1", new Date("2026-10-20T10:00:00Z"), now))).toBe("conflict");
    prisma.post.findFirst.mockResolvedValue(post("PUBLISHING"));
    expect(await code(deletePost(owner, "p1"))).toBe("conflict");
  });

  it("deleting a published post removes it from BuPulse only, and says so", async () => {
    prisma.post.findFirst.mockResolvedValue(post("PUBLISHED"));
    const result = await deletePost(owner, "p1");
    expect(result.note).toMatch(/stays live on the network/);
    prisma.post.findFirst.mockResolvedValue(post("SCHEDULED"));
    expect(await deletePost(owner, "p1")).toEqual({});
  });

  it("rejects moving a post into the past", async () => {
    prisma.post.findFirst.mockResolvedValue(post("SCHEDULED"));
    expect(await code(reschedulePost(owner, "p1", new Date("2026-10-07T07:00:00Z"), now))).toBe("invalid");
  });

  it("moving a failed post puts it back in line with its counters reset", async () => {
    prisma.post.findFirst.mockResolvedValue(post("FAILED"));
    await reschedulePost(owner, "p1", new Date("2026-10-20T10:00:00Z"), now);
    expect(prisma.post.updateMany.mock.calls[0][0].data).toMatchObject({ status: "SCHEDULED", attempts: 0, lastError: null, nextAttemptAt: null });
  });

  it("retry only works on failed posts, due immediately", async () => {
    prisma.post.findFirst.mockResolvedValue(post("SCHEDULED"));
    expect(await code(retryPost(owner, "p1", now))).toBe("conflict");
    prisma.post.findFirst.mockResolvedValue(post("FAILED"));
    await retryPost(owner, "p1", now);
    expect(prisma.post.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "p1", businessId: "b1", status: "FAILED" }, data: { status: "SCHEDULED", scheduledAt: now, attempts: 0 } });
  });

  it("duplicate makes a fresh draft in a new group", async () => {
    prisma.post.findFirst.mockResolvedValue(post("PUBLISHED", { groupId: "g1", externalId: "ext", permalink: "x" }));
    prisma.post.create.mockResolvedValue({ id: "copy" });
    await duplicatePost(owner, "p1");
    const data = prisma.post.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DRAFT", source: "MANUAL", businessId: "b1", text: "Hello" });
    expect(data.groupId).not.toBe("g1");
    expect(data).not.toHaveProperty("externalId");
    expect(data).not.toHaveProperty("scheduledAt");
  });

  it("editing validates against the post's own network", async () => {
    prisma.post.findFirst.mockResolvedValue(post("SCHEDULED", { network: "instagram", connection: { ...instagram, provider: "instagram" } }));
    expect(await code(updatePost(owner, "p1", edit, now))).toBe("invalid"); // Instagram needs a photo
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });
});

describe("approvePosts", () => {
  it("only approves this business's posts that are waiting for approval", async () => {
    prisma.post.findMany.mockResolvedValue([{ id: "a", connectionId: "c-fb", scheduledAt: new Date("2026-10-09T07:00:00Z") }]);
    expect(await approvePosts("b1", ["a", "b", "a"], now)).toEqual({ approved: 1, skipped: 0 });
    expect(prisma.post.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, businessId: "b1", status: "PENDING_APPROVAL" });
    expect(prisma.post.updateMany.mock.calls[0][0]).toEqual({ where: { id: "a", businessId: "b1", status: "PENDING_APPROVAL" }, data: { status: "SCHEDULED", reviewNote: null } });
  });

  it("approves nothing for another business's posts", async () => {
    prisma.post.findMany.mockResolvedValue([]);
    expect(await approvePosts("b1", ["x"], now)).toEqual({ approved: 0, skipped: 0 });
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("moves posts whose time has passed to the next free slot instead of posting stale content at once", async () => {
    prisma.post.findMany
      .mockResolvedValueOnce([{ id: "late", connectionId: "c-fb", scheduledAt: new Date("2026-10-06T07:00:00Z") }])
      .mockResolvedValue([]);
    await approvePosts("b1", ["late"], now);
    const data = prisma.post.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("SCHEDULED");
    expect(data.scheduledAt.toISOString()).toBe("2026-10-07T16:00:00.000Z");
  });

  it("does nothing for an empty list", async () => {
    expect(await approvePosts("b1", [], now)).toEqual({ approved: 0, skipped: 0 });
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });
});

describe("Instagram photo size", () => {
  it("rejects a Gallery photo above 4096 pixels", async () => {
    prisma.connection.findMany.mockResolvedValue([instagram]);
    prisma.mediaAsset.findMany.mockResolvedValue([{ width: 6000, height: 4000 }]);
    const error = await createPosts(owner, compose({ connectionIds: ["c-ig"], mediaPaths: [photo] }), now).catch((e) => e);
    expect(error).toBeInstanceOf(PublishingError);
    expect(error.message).toMatch(/4096 pixels/);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it("does not look at sizes for other networks", async () => {
    prisma.mediaAsset.findMany.mockResolvedValue([{ width: 6000, height: 4000 }]);
    expect(await code(createPosts(owner, compose({ mediaPaths: [photo] }), now))).toBe("ok");
    expect(prisma.mediaAsset.findMany).not.toHaveBeenCalled();
  });
});

describe("owner edits are remembered, so BuPulse never replaces or redraws them", () => {
  const post = { id: "p1", businessId: "b1", connectionId: "c-fb", network: "facebook", status: "PENDING_APPROVAL", format: "POST", text: "Hello", hashtags: [], mediaPaths: [], scheduledAt: null, connection: { id: "c-fb", displayName: "Page", provider: "facebook", status: "ACTIVE", postingMode: "AUTO" } };

  it("an edit, a move or taking it back to review sets ownerEditedAt", async () => {
    prisma.post.findFirst.mockResolvedValue(post);
    await updatePost(owner, "p1", { text: "Mine", hashtags: [], mediaPaths: [], when: { mode: "keep" } }, now);
    await reschedulePost(owner, "p1", new Date("2026-10-20T10:00:00Z"), now);
    await unschedulePost(owner, "p1", now);
    for (const call of prisma.post.updateMany.mock.calls) expect(call[0].data.ownerEditedAt).toEqual(now);
  });

  it("scheduling Studio content by hand replaces only its untouched drafts, in the same transaction", async () => {
    prisma.generatedContent.findFirst.mockResolvedValue({ id: "content-1" });
    prisma.contentVisual.findMany.mockResolvedValue([]);
    await createPosts(owner, compose({ contentId: "content-1" }), now);
    const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(3);
    const drafts = { businessId: "b1", contentId: "content-1", source: "STUDIO", status: "PENDING_APPROVAL", connectionId: { in: ["c-fb"] } };
    expect(prisma.post.deleteMany).toHaveBeenCalledWith({ where: { ...drafts, ownerEditedAt: null } });
    // A draft the owner edited for the same account is cancelled as superseded, never left as a second post.
    expect(prisma.post.updateMany).toHaveBeenCalledWith({ where: { ...drafts, ownerEditedAt: { not: null } }, data: { status: "CANCELLED", reviewNote: "Replaced by the post you scheduled." } });
  });
});

describe("approving never stacks two posts on one account", () => {
  it("re-picks the time when another post took the slot meanwhile", async () => {
    // The first pick (today 18:00) collides with a post another approval just wrote; the second is free.
    prisma.post.findFirst.mockResolvedValueOnce({ id: "other" }).mockResolvedValue(null);
    let call = 0;
    prisma.post.findMany.mockImplementation(async (args: { where: { status?: unknown; connectionId?: unknown } }) => {
      if (args.where.status === "PENDING_APPROVAL") return [{ id: "a", network: "facebook", connectionId: "c-fb", scheduledAt: null }];
      // Queued posts on the account: none at first, then the one that took 18:00.
      return call++ === 0 ? [] : [{ connectionId: "c-fb", scheduledAt: new Date("2026-10-07T16:00:00Z") }];
    });
    expect(await approvePosts("b1", ["a"], now)).toEqual({ approved: 1, skipped: 0 });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const clash = prisma.post.findFirst.mock.calls[0][0].where;
    expect(clash).toMatchObject({ connectionId: "c-fb", id: { not: "a" } });
    const written = prisma.post.updateMany.mock.calls.at(-1)![0].data.scheduledAt as Date;
    expect(Math.abs(written.getTime() - new Date("2026-10-07T16:00:00Z").getTime())).toBeGreaterThanOrEqual(150 * 60_000);
  });
});


describe("approvePosts reports what it could not schedule", () => {
  it("counts a post as skipped when no free time is left after three tries", async () => {
    prisma.post.findMany.mockImplementation(async (args: { where: { status?: unknown } }) =>
      args.where.status === "PENDING_APPROVAL" ? [{ id: "a", network: "facebook", connectionId: "c-fb", scheduledAt: null }] : [],
    );
    prisma.post.findFirst.mockResolvedValue({ id: "other" });
    expect(await approvePosts("b1", ["a"], now)).toEqual({ approved: 0, skipped: 1 });
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });
});
