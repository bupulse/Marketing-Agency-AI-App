import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ job: null as Record<string, unknown> | null, connections: [] as { id: string; provider: string; displayName: string | null; status: string; postingMode: string }[] }));
const prisma = vi.hoisted(() => ({
  videoJob: { findFirst: vi.fn(async () => db.job) },
  connection: {
    findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; provider?: { in: string[] } } }) =>
      db.connections.filter((c) => (!where.id || where.id.in.includes(c.id)) && (!where.provider || where.provider.in.includes(c.provider))),
    ),
  },
  business: { findUnique: vi.fn(async () => ({ timezone: "Africa/Kigali" })) },
  post: { findMany: vi.fn(async () => []) },
}));
const publishing = vi.hoisted(() => ({ createPosts: vi.fn(async () => ({ groupId: "g1", postIds: ["p1", "p2"], scheduledAt: new Date("2026-10-18T07:00:00Z"), status: "SCHEDULED" })) }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/publishing/service", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/service")>()), createPosts: publishing.createPosts }));
vi.mock("@/lib/video-studio/brief", () => ({
  loadBriefFacts: vi.fn(async () => ({
    productId: "p1",
    business: { name: "Nova Phones Kigali", description: "Phones in Kigali, next to Simba Supermarket, with delivery", language: "English", country: "Rwanda", phone: "+250 788 300 400", website: null },
    product: { name: "Samsung Galaxy A56", summary: "A56 5G, 8 GB, 256 GB", price: "420,000 RWF", usps: ["Genuine with 12-month warranty"], features: [] },
  })),
}));

import { CAPTION_PASS, scheduleJob, scheduleOptions } from "@/lib/video-studio/schedule";
import { PublishingError } from "@/lib/publishing/service";

const GOOD = "🔥 Samsung Galaxy A56, 420,000 RWF\n✅ Genuine with 12-month warranty\n📍 Next to Simba Supermarket, Kigali\n🚚 Delivery available\n📞 Call/WhatsApp: 0788 300 400";
const owner = { businessId: "b1", userId: "u1", actorId: "a1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.job = { id: "j1", status: "ready", videoPath: "u1/clips/v.mp4", productId: "p1", caption: GOOD, hashtags: ["#kigali", "#novaphones"], platform: "tiktok", templateId: "product-hero", seconds: 15, ratio: "9:16", music: { trackId: "t2", title: "Night Market", attribution: "Music by A. Artist (CC BY 4.0)", owned: false }, brief: {} };
  db.connections = [
    { id: "c-tt", provider: "tiktok", displayName: "@novaphones", status: "ACTIVE", postingMode: "AUTO" },
    { id: "c-ig", provider: "instagram", displayName: "Nova IG", status: "ACTIVE", postingMode: "AUTO" },
    { id: "c-li", provider: "linkedin", displayName: "Nova LinkedIn", status: "ACTIVE", postingMode: "AUTO" },
  ];
});

describe("scheduling a studio MP4", () => {
  it("offers the video networks only, the design's caption for its own platform and the Brain's for the others, and the music credit", async () => {
    const o = await scheduleOptions("b1", "j1");
    expect(o.accounts.map((a) => a.network)).toEqual(["tiktok", "instagram"]);
    expect(o.captions.tiktok).toMatchObject({ text: GOOD, own: true });
    expect(o.captions.instagram?.own).toBe(false);
    expect(o.captions.instagram?.text).toContain("420,000 RWF");
    expect(CAPTION_PASS).toBe(70);
    expect(o.captions.instagram?.score).toBeGreaterThanOrEqual(CAPTION_PASS);
    expect(o.credit).toBe("Music by A. Artist (CC BY 4.0)");
    expect(o.timezone).toBe("Africa/Kigali");
  });

  it("makes one post per account through createPosts: the MP4, each network's caption with the music credit, the product", async () => {
    const out = await scheduleJob(owner, "j1", { connectionIds: ["c-tt", "c-ig"], when: { mode: "queue" } });
    expect(out.postIds).toEqual(["p1", "p2"]);
    const [who, input] = publishing.createPosts.mock.calls[0] as unknown as [typeof owner, { mediaPaths: string[]; subjectId: string; when: unknown; overrides: Record<string, { text: string; hashtags: string[] }>; connectionIds: string[] }];
    expect(who).toEqual(owner);
    expect(input).toMatchObject({ mediaPaths: ["u1/clips/v.mp4"], subjectId: "p1", when: { mode: "queue" }, connectionIds: ["c-tt", "c-ig"] });
    expect(input.overrides.tiktok.text).toBe(`${GOOD}\n\nMusic by A. Artist (CC BY 4.0)`);
    expect(input.overrides.instagram.text.endsWith("Music by A. Artist (CC BY 4.0)")).toBe(true);
    expect(input.overrides.tiktok.hashtags).toEqual(["#kigali", "#novaphones"]);
  });

  it("the owner's own captions are used when they pass the check; a weak one stops everything, in plain words", async () => {
    await scheduleJob(owner, "j1", { connectionIds: ["c-ig"], when: { mode: "schedule", local: "2026-10-20T09:00" }, captions: { instagram: { text: GOOD, hashtags: ["#kigali"] } } });
    expect((publishing.createPosts.mock.calls[0] as unknown as [unknown, { overrides: Record<string, { text: string }> }])[1].overrides.instagram.text.startsWith(GOOD)).toBe(true);
    vi.clearAllMocks();
    const weak = scheduleJob(owner, "j1", { connectionIds: ["c-ig"], when: { mode: "queue" }, captions: { instagram: { text: "New stock!", hashtags: [] } } });
    await expect(weak).rejects.toBeInstanceOf(PublishingError);
    await expect(weak).rejects.toThrow(/^Improve the caption first\. Instagram caption \(\d+\/100\)/);
    expect(publishing.createPosts).not.toHaveBeenCalled();
  });

  it("refuses LinkedIn, an account of another company, and a video without its MP4", async () => {
    await expect(scheduleJob(owner, "j1", { connectionIds: ["c-li"], when: { mode: "queue" } })).rejects.toThrow("LinkedIn takes photos only from BuPulse, so a studio video cannot go there.");
    await expect(scheduleJob(owner, "j1", { connectionIds: ["c-other"], when: { mode: "queue" } })).rejects.toThrow("Choose at least one connected account.");
    db.job = { ...db.job!, status: "designed", videoPath: null };
    await expect(scheduleOptions("b1", "j1")).rejects.toThrow("Make the MP4 first: then it can be scheduled.");
    expect(publishing.createPosts).not.toHaveBeenCalled();
  });
});
