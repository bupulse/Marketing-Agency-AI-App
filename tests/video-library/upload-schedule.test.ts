import { beforeEach, describe, expect, it, vi } from "vitest";

// Scheduling an uploaded video (lib/video-studio/schedule.ts, engine "upload"): with a product it is checked as an ad
// about that product, like a studio video; with none it is about the business, checked as a page post (one friendly
// line, few hashtags), starting from the owner's title, and the posts have no product.

const db = vi.hoisted(() => ({ job: null as Record<string, unknown> | null }));
const prisma = vi.hoisted(() => ({
  videoJob: { findFirst: vi.fn(async ({ where }: { where: { engine: { in: string[] } } }) => (db.job && where.engine.in.includes(String(db.job.engine)) ? db.job : null)) },
  connection: {
    findMany: vi.fn(async () => [{ id: "c-ig", provider: "instagram", displayName: "Leaf IG", status: "ACTIVE", postingMode: "AUTO" }]),
  },
  business: { findUnique: vi.fn(async () => ({ timezone: "Africa/Kigali" })) },
}));
const publishing = vi.hoisted(() => ({ createPosts: vi.fn(async () => ({ groupId: "g1", postIds: ["p1"], scheduledAt: null, status: "SCHEDULED" })) }));
const brief = vi.hoisted(() => ({
  loadBriefFacts: vi.fn(async () => ({ productId: "p1", business: { name: "Leaf", description: "Juice bar in Kigali", language: "English", phone: null, website: null }, product: { name: "Mango juice", price: null, usps: [], features: [] } })),
  loadBusinessFacts: vi.fn(async () => ({ business: { name: "Leaf", description: "Juice bar in Kigali", language: "English", phone: null, website: null }, product: { name: "Leaf", summary: "Juice bar in Kigali", price: null, usps: [], features: [] } })),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/publishing/service", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/service")>()), createPosts: publishing.createPosts }));
vi.mock("@/lib/video-studio/brief", () => brief);

import { scheduleJob, scheduleOptions } from "@/lib/video-studio/schedule";

const owner = { businessId: "b1", userId: "u1", actorId: "a1" };
const LINE = "Fresh mango juice pressed every morning at our Kigali bar, come and taste it today";

beforeEach(() => {
  vi.clearAllMocks();
  db.job = { id: "j1", engine: "upload", status: "ready", videoPath: "u1/clips/clip-0000.mp4", productId: null, caption: LINE, hashtags: [], platform: null, templateId: null, seconds: 31, ratio: "9:16", music: null, brief: {} };
});

describe("scheduling an uploaded video", () => {
  it("about the business: the owner's title as the caption, checked as a page post, and no product on the posts", async () => {
    const o = await scheduleOptions("b1", "j1");
    expect(brief.loadBusinessFacts).toHaveBeenCalledWith("b1");
    expect(brief.loadBriefFacts).not.toHaveBeenCalled();
    expect(o.captions.instagram).toMatchObject({ text: LINE, own: true });
    expect(o.captions.instagram!.score).toBeGreaterThanOrEqual(70);
    const out = await scheduleJob(owner, "j1", { connectionIds: ["c-ig"], when: { mode: "queue" } });
    expect(out.postIds).toEqual(["p1"]);
    const input = (publishing.createPosts.mock.calls[0] as unknown as [unknown, { mediaPaths: string[]; subjectId: string | null }])[1];
    expect(input).toMatchObject({ mediaPaths: ["u1/clips/clip-0000.mp4"], subjectId: null });
  });

  it("an empty title must be written before it is scheduled", async () => {
    db.job = { ...db.job!, caption: "" };
    await expect(scheduleJob(owner, "j1", { connectionIds: ["c-ig"], when: { mode: "queue" } })).rejects.toThrow(/^Improve the caption first\./);
    expect(publishing.createPosts).not.toHaveBeenCalled();
  });

  it("about a product: that product's facts, and the product on the posts", async () => {
    db.job = { ...db.job!, productId: "p1" };
    await scheduleOptions("b1", "j1");
    expect(brief.loadBriefFacts).toHaveBeenCalledWith("b1", "p1");
  });

  it("a studio video still needs its product, and other engines are not scheduled here", async () => {
    db.job = { ...db.job!, engine: "motion", productId: null };
    await expect(scheduleOptions("b1", "j1")).rejects.toThrow("Make the MP4 first: then it can be scheduled.");
    db.job = { ...db.job!, engine: "seedance" };
    await expect(scheduleOptions("b1", "j1")).rejects.toThrow("We could not find that video.");
  });
});
