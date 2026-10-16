import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  generatedContent: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  connection: { findMany: vi.fn() },
  post: { deleteMany: vi.fn(), create: vi.fn(), count: vi.fn() },
  contentVisual: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
const auto = vi.hoisted(() => ({ autoSchedule: vi.fn(async () => ({ scheduled: 0, waiting: 0 })) }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));
vi.mock("@/lib/content-board/auto", () => auto);

import { draftFor, draftPostsFromContent, draftPostsFromPack, latestContentPosts } from "@/lib/content-board/drafts";
import { missing } from "@/tests/stubs/entitlements";

const content = {
  id: "content-2",
  caption: "Our sourdough is back",
  hashtags: ["#bread", "#kigali", "#bakery", "#fresh"],
  videoScript: "0-3s: Hook. Fresh sourdough.",
  variants: [
    { network: "instagram", caption: "Our sourdough is back", hashtags: ["#bread"] },
    { network: "facebook", caption: "Our sourdough is back on the shelves", hashtags: ["#bread"] },
    { network: "linkedin", caption: "Our sourdough, baked at 6am.", hashtags: ["#bakery"] },
    { network: "x", caption: "Sourdough!", hashtags: [] },
  ],
  productId: "p1",
  campaignId: null,
};
const conn = (id: string, provider: string, status = "ACTIVE") => ({ id, provider, status, postingMode: "AUTO", kind: "SOCIAL" });

beforeEach(() => {
  vi.clearAllMocks();
  missing.clear();
  prisma.generatedContent.findFirst.mockResolvedValue(content);
  prisma.connection.findMany.mockResolvedValue([conn("c-ig", "instagram"), conn("c-li", "linkedin"), conn("c-tt", "tiktok"), conn("c-x", "facebook", "REVOKED")]);
  prisma.post.deleteMany.mockResolvedValue({ count: 2 });
  prisma.post.create.mockImplementation(async ({ data }: { data: { connectionId: string } }) => ({ id: `post-${data.connectionId}` }));
  prisma.contentVisual.findMany.mockResolvedValue([{ kind: "carousel", status: "ready", items: [{ path: "u1/designs/1.png" }, { path: "u1/designs/2.png" }] }]);
  prisma.generatedContent.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.count.mockResolvedValue(0);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
});

describe("draftFor", () => {
  it("uses each network's own version, the script for video apps, and the network's hashtag limit", () => {
    expect(draftFor("linkedin", content)).toEqual({ text: "Our sourdough, baked at 6am.", hashtags: ["#bakery"], format: "POST" });
    expect(draftFor("instagram", content)).toMatchObject({ text: "Our sourdough is back", format: "POST" });
    expect(draftFor("tiktok", content)).toMatchObject({ text: "0-3s: Hook. Fresh sourdough.", format: "SCRIPT" });
  });
});

describe("draftPostsFromContent", () => {
  it("drafts one post per usable account, waiting for review, with the content's picture", async () => {
    const result = await draftPostsFromContent({ businessId: "b1" }, "content-2");
    expect(result).toMatchObject({ created: 4, replaced: 2 });
    const rows = prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => r.network)).toEqual(["instagram", "linkedin", "tiktok", "facebook"]);
    expect(rows.every((r) => r.status === "PENDING_APPROVAL" && r.source === "STUDIO" && r.productId === "p1" && r.contentId === "content-2" && r.businessId === "b1")).toBe(true);
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
    expect(rows[0]).toMatchObject({ connectionId: "c-ig", remindOnly: false, format: "CAROUSEL", mediaPaths: ["u1/designs/1.png", "u1/designs/2.png"] });
    expect(rows[2]).toMatchObject({ format: "SCRIPT", mediaPaths: [] });
    expect(auto.autoSchedule).toHaveBeenCalledWith("b1", ["post-c-ig", "post-c-li", "post-c-tt", "post-null"], expect.any(Date));
  });

  it("drafts a reminder post for each app the content was written for that has no usable account", async () => {
    prisma.connection.findMany.mockResolvedValue([]);
    const result = await draftPostsFromContent({ businessId: "b1" }, "content-2");
    expect(result.created).toBe(3);
    const rows = prisma.post.create.mock.calls.map((c) => c[0].data);
    // The networks the content has versions for; x is not an app BuPulse supports.
    expect(rows.map((r) => r.network)).toEqual(["instagram", "facebook", "linkedin"]);
    expect(rows.every((r) => r.connectionId === null && r.remindOnly === true)).toBe(true);
    expect(rows[0]).toMatchObject({ mediaPaths: ["u1/designs/1.png", "u1/designs/2.png"] });
  });

  it("marks the content as drafted, in the same transaction that replaces older untouched drafts", async () => {
    await draftPostsFromContent({ businessId: "b1" }, "content-2");
    expect(prisma.post.deleteMany).toHaveBeenCalledWith({ where: { businessId: "b1", productId: "p1", source: "STUDIO", status: "PENDING_APPROVAL", ownerEditedAt: null, NOT: { contentId: { in: ["content-2"] } } } });
    expect(prisma.generatedContent.updateMany).toHaveBeenCalledWith({ where: { id: "content-2", businessId: "b1" }, data: { postsDraftedAt: expect.any(Date) } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("drafts once when called twice at the same time: the second finds the first one's drafts under the lock", async () => {
    // A real lock serialises the two transactions; the mock runs them one after the other the same way.
    let made = 0;
    prisma.post.create.mockImplementation(async ({ data }: { data: { connectionId: string } }) => {
      made += 1;
      return { id: `post-${data.connectionId}` };
    });
    prisma.post.count.mockImplementation(async () => made);
    let queue = Promise.resolve<unknown>(undefined);
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => (queue = queue.then(() => fn(prisma))));
    const [first, second] = await Promise.all([draftPostsFromContent({ businessId: "b1" }, "content-2"), draftPostsFromContent({ businessId: "b1" }, "content-2")]);
    expect(first.created).toBe(4);
    expect(second).toMatchObject({ created: 0, existing: 4 });
    expect(made).toBe(4);
    const lockKey = (prisma.$executeRaw.mock.calls[0] as unknown[]).slice(1);
    expect(lockKey).toEqual(["content-drafts:content-2"]);
  });

  it("does nothing without scheduling in the plan or for another business's content", async () => {
    missing.add("calendar");
    expect((await draftPostsFromContent({ businessId: "b1" }, "content-2")).created).toBe(0);
    missing.clear();
    prisma.generatedContent.findFirst.mockResolvedValue(null);
    expect((await draftPostsFromContent({ businessId: "b1" }, "content-2")).created).toBe(0);
    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
  });
});

describe("latestContentPosts (backfill)", () => {
  it("drafts content from before, once, when it has no posts", async () => {
    prisma.generatedContent.findFirst.mockResolvedValueOnce({ id: "old", postsDraftedAt: null }).mockResolvedValue({ ...content, id: "old" });
    prisma.post.count.mockResolvedValue(0);
    expect(await latestContentPosts("b1", { productId: "p1" }, { backfill: true })).toEqual({ contentId: "old", hasPosts: true });
    expect(prisma.post.create).toHaveBeenCalled();
  });

  it("never re-drafts content whose drafts the owner rejected, and only backfills when asked", async () => {
    prisma.generatedContent.findFirst.mockResolvedValue({ id: "c", postsDraftedAt: new Date() });
    prisma.post.count.mockResolvedValue(0);
    expect(await latestContentPosts("b1", { productId: "p1" }, { backfill: true })).toEqual({ contentId: "c", hasPosts: false });
    prisma.generatedContent.findFirst.mockResolvedValue({ id: "c", postsDraftedAt: null });
    expect(await latestContentPosts("b1", { productId: "p1" })).toEqual({ contentId: "c", hasPosts: false });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });
});

describe("content packs (docs/CONTENT_PACKS.md)", () => {
  const packPost = (id: string, angle: string, network: string) => ({ ...content, id, caption: `${angle} post`, packId: "pack-1", angle, network, variants: [] });

  it("a pack post is drafted only on its own app, and keeps the other posts of its pack", async () => {
    prisma.generatedContent.findFirst.mockResolvedValue(packPost("c-tips", "tips", "instagram"));
    prisma.generatedContent.findMany.mockResolvedValue([{ id: "c-tips", angle: "tips", network: "instagram" }, { id: "c-price", angle: "price", network: "facebook" }, { id: "c-how", angle: "how-it-works", network: "tiktok" }]);
    const result = await draftPostsFromContent({ businessId: "b1" }, "c-tips");
    expect(result.created).toBe(1);
    const row = prisma.post.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ network: "instagram", connectionId: "c-ig", contentId: "c-tips", text: "tips post" });
    expect(prisma.post.deleteMany.mock.calls[0][0].where.NOT).toEqual({ contentId: { in: ["c-tips", "c-price", "c-how"] } });
  });

  it("an app that is not connected gets a reminder post; an edited pack post replaces only the post it came from", async () => {
    prisma.generatedContent.findFirst.mockResolvedValue(packPost("c-price-2", "price", "facebook"));
    prisma.connection.findMany.mockResolvedValue([conn("c-ig", "instagram")]);
    prisma.generatedContent.findMany.mockResolvedValue([{ id: "c-price", angle: "price", network: "facebook" }, { id: "c-price-2", angle: "price", network: "facebook" }, { id: "c-tips", angle: "tips", network: "instagram" }]);
    await draftPostsFromContent({ businessId: "b1" }, "c-price-2");
    expect(prisma.post.create.mock.calls.map((c) => c[0].data)).toEqual([expect.objectContaining({ network: "facebook", connectionId: null, remindOnly: true })]);
    // The edited post's original ("c-price") is not kept: its draft is replaced.
    expect(prisma.post.deleteMany.mock.calls[0][0].where.NOT).toEqual({ contentId: { in: ["c-price-2", "c-tips"] } });
  });

  it("drafts every post of a pack, each on its app", async () => {
    const posts = [packPost("a", "tips", "instagram"), packPost("b", "price", "linkedin"), packPost("c", "how-it-works", "tiktok")];
    prisma.generatedContent.findMany.mockImplementation(async (args: { select: { angle?: boolean } }) => (args.select.angle ? posts.map((p) => ({ id: p.id, angle: p.angle, network: p.network })) : posts.map((p) => ({ id: p.id }))));
    prisma.generatedContent.findFirst.mockImplementation(async (args: { where: { id: string } }) => posts.find((p) => p.id === args.where.id));
    const result = await draftPostsFromPack({ businessId: "b1" }, "pack-1");
    expect(result.created).toBe(3);
    expect(prisma.post.create.mock.calls.map((c) => [c[0].data.contentId, c[0].data.network, c[0].data.format])).toEqual([
      ["a", "instagram", "CAROUSEL"],
      ["b", "linkedin", "CAROUSEL"],
      ["c", "tiktok", "SCRIPT"],
    ]);
  });
});
