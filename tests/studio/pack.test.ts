import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    generatedContent: { findMany: vi.fn(), create: vi.fn() },
    connection: { findMany: vi.fn() },
    product: { findFirst: vi.fn() },
    campaign: { findFirst: vi.fn() },
    competitor: { count: vi.fn() },
    knowledgeFaq: { count: vi.fn() },
  },
  generate: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  getUsageSummary: vi.fn(),
  aiPhotosStatus: vi.fn(),
  planVisuals: vi.fn(),
  directVisual: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: mocks.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/usage", () => {
  class UsageLimitError extends Error {
    constructor(public reason: string, public metric: string) {
      super("limit");
    }
  }
  return { consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage, getUsageSummary: mocks.getUsageSummary, UsageLimitError };
});
vi.mock("@/lib/knowledge/service", () => ({
  writingSubject: async () => ({ subject: { kind: "product", id: "p1" }, type: "product", title: "Aero phone", price: "RWF 120,000", features: ["Big battery"], context: "<<<PRODUCT DATA\\nAero phone\\nPRODUCT DATA>>>", photoPaths: ["u1/gallery/aaaaaaaa-1.jpg"] }),
  subjectColumns: (s: { kind: string; id: string }) => ({ productId: s.kind === "product" ? s.id : null, campaignId: s.kind === "campaign" ? s.id : null }),
}));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: null, voiceProfile: null }) }));
vi.mock("@/lib/content-board/settings-service", () => ({ getContentSettings: async () => ({ requireApproval: {}, packSize: 5 }) }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "gemini-test", pruneVersions: async () => {}, StudioNotFoundError: class extends Error {}, variantsJson: () => [] }));
vi.mock("@/lib/analytics/events", () => ({ EVENT_NAMES: { textGenerated: "text_generated" }, trackEvent: async () => {} }));
vi.mock("@/lib/webhooks/emit", () => ({ queueWebhookEvent: async () => {} }));
vi.mock("@/lib/visuals/art-director", () => ({ directVisual: mocks.directVisual }));
vi.mock("@/lib/visuals/service", () => ({
  aiPhotosStatus: mocks.aiPhotosStatus,
  audienceFor: async () => ({ country: "Rwanda", personas: [] }),
  directionContext: (x: unknown) => x,
  planVisuals: mocks.planVisuals,
  videoAvailable: async () => true,
}));
vi.mock("@/lib/publishing/service", () => ({ accountUsable: () => true }));
vi.mock("@/lib/autopilot/calendar", () => ({ holidaysBetween: () => [] }));

import { buildPackPrompt, readPack } from "@/lib/ai/pack";
import { generatePackForSubject } from "@/lib/studio/pack";
import { UsageLimitError } from "@/lib/usage";
import { fallbackPlan } from "@/lib/visuals/direction";

const owner = { userId: "u1", businessId: "b1" };
const subject = { kind: "product" as const, id: "p1" };
const answer = (n: number) => ({ text: JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ index: i + 1, caption: `Post number ${i + 1}`, hashtags: ["#a"], videoScript: "0-3s Hook", headline: `Head ${i + 1}` })) }), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
const plan = () => fallbackPlan({ subjectType: "product", title: "Aero phone", caption: "", headlines: [], business: { name: "B" }, photos: [], carouselAllowed: false, aiAllowed: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "b1", name: "Kigali Phones", country: "Rwanda", tone: "friendly", industry: "Retail", brandColors: [], knowledge: {}, contentLanguage: "English", profile: null });
  mocks.prisma.generatedContent.findMany.mockResolvedValue([]);
  mocks.prisma.connection.findMany.mockResolvedValue([{ provider: "instagram" }, { provider: "facebook" }, { provider: "tiktok" }]);
  mocks.prisma.product.findFirst.mockResolvedValue({ createdAt: new Date("2020-01-01") });
  mocks.prisma.competitor.count.mockResolvedValue(0);
  mocks.prisma.knowledgeFaq.count.mockResolvedValue(0);
  mocks.prisma.generatedContent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `c-${data.angle}`, ...data }));
  mocks.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.getUsageSummary.mockResolvedValue({ used: { text: 0, image: 28 }, limits: { text: 100, image: 30 } });
  mocks.aiPhotosStatus.mockResolvedValue({ allowed: true, exhausted: null });
  mocks.directVisual.mockImplementation(async () => plan());
  mocks.planVisuals.mockResolvedValue({ image: "v", video: null });
  mocks.generate.mockResolvedValue(answer(5));
});

describe("the pack writer", () => {
  it("asks for one different post per angle and app, in order", () => {
    const prompt = buildPackPrompt({ businessName: "Kigali Phones" }, { type: "product", title: "Aero phone", features: [] }, [
      { angle: "tips", network: "instagram", format: "carousel" },
      { angle: "how-it-works", network: "tiktok", format: "video" },
    ]);
    expect(prompt).toMatch(/Write 2 posts/);
    expect(prompt).toMatch(/1\. Angle "Tips".*App: Instagram.*Format: a carousel post/);
    expect(prompt).toMatch(/2\. Angle "How it works".*App: TikTok.*Format: a video post \(write the videoScript\)/);
    expect(prompt).not.toMatch(/\nCreate:/);
  });

  it("matches posts to their slots, drops empty or repeated captions, keeps scripts only for video posts", () => {
    const slots = [
      { angle: "tips", network: "instagram", format: "carousel" },
      { angle: "price", network: "facebook", format: "image" },
      { angle: "story", network: "tiktok", format: "video" },
    ] as const;
    const posts = readPack({ posts: [
      { index: 3, caption: "A day with the phone", hashtags: ["kigali"], videoScript: "0-3s hook", headline: "Day" },
      { index: 1, caption: "Three tips", hashtags: [], videoScript: "should go", headline: "Tips" },
      { index: 2, caption: "three  TIPS", hashtags: [], videoScript: "", headline: "Copy" },
    ] }, slots);
    expect(posts.map((p) => [p.angle, p.caption, p.videoScript])).toEqual([["tips", "Three tips", ""], ["story", "A day with the phone", "0-3s hook"]]);
    expect(posts[1].hashtags).toEqual(["#kigali"]);
  });
});

describe("generatePackForSubject", () => {
  it("writes a pack of different posts, one per angle, spread over the apps, 1 text credit per post", async () => {
    const pack = await generatePackForSubject({ ...owner, subject, feature: "content" });
    expect(mocks.consumeUsage).toHaveBeenCalledWith("u1", "text", 5);
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    const rows = mocks.prisma.generatedContent.create.mock.calls.map(([a]) => a.data);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.angle)).size).toBe(5);
    expect(new Set(rows.map((r) => r.packId)).size).toBe(1);
    // 5 posts over 3 apps: 2, 2 and 1, each angle on the app it suits (how it works and the story as TikTok videos).
    expect(rows.map((r) => [r.angle, r.network])).toEqual([["features", "instagram"], ["price", "facebook"], ["story", "tiktok"], ["tips", "instagram"], ["how-it-works", "tiktok"]]);
    expect(rows.filter((r) => r.network === "tiktok").every((r) => r.videoScript === "0-3s Hook")).toBe(true);
    expect(rows.filter((r) => r.network !== "tiktok").every((r) => r.videoScript === "")).toBe(true);
    expect(pack.contents).toHaveLength(5);
  });

  it("rotates the subject's angles: the ones used last time come after the others", async () => {
    mocks.prisma.generatedContent.findMany.mockResolvedValue([{ angle: "features" }, { angle: "price" }, { angle: "story" }, { angle: "tips" }, { angle: "how-it-works" }]);
    mocks.generate.mockResolvedValue(answer(5));
    await generatePackForSubject({ ...owner, subject, feature: "regenerate" });
    const angles = mocks.prisma.generatedContent.create.mock.calls.map(([a]) => a.data.angle);
    expect(angles.slice(0, 3).sort()).toEqual(["behind-scenes", "cta", "faq"]);
  });

  it("with 3 text credits left the pack has 3 posts; posts the AI did not write are given back", async () => {
    mocks.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "text")).mockResolvedValueOnce({ periodStart: new Date("2026-10-01") });
    mocks.getUsageSummary.mockResolvedValue({ used: { text: 97, image: 0 }, limits: { text: 100, image: 30 } });
    mocks.generate.mockResolvedValue(answer(2));
    const pack = await generatePackForSubject({ ...owner, subject, feature: "content" });
    expect(mocks.consumeUsage).toHaveBeenLastCalledWith("u1", "text", 3);
    expect(pack.contents).toHaveLength(2);
    expect(mocks.refundUsage).toHaveBeenCalledWith("u1", "text", new Date("2026-10-01"), 1);
  });

  it("no credit left: nothing is charged; an AI failure gives every credit back", async () => {
    mocks.consumeUsage.mockRejectedValueOnce(new UsageLimitError("limit_reached", "text"));
    mocks.getUsageSummary.mockResolvedValue({ used: { text: 100, image: 0 }, limits: { text: 100, image: 30 } });
    await expect(generatePackForSubject({ ...owner, subject, feature: "content" })).rejects.toBeInstanceOf(UsageLimitError);
    expect(mocks.refundUsage).not.toHaveBeenCalled();

    mocks.generate.mockRejectedValueOnce(new Error("AI down"));
    await expect(generatePackForSubject({ ...owner, subject, feature: "content" })).rejects.toThrow("AI down");
    expect(mocks.refundUsage).toHaveBeenCalledWith("u1", "text", new Date("2026-10-01"), 5);
  });

  it("every post gets its own visual with its angle's people; AI images only while the plan's images last; video posts get a video plan", async () => {
    await generatePackForSubject({ ...owner, subject, feature: "content" });
    const asked = mocks.directVisual.mock.calls.map(([ctx]) => ctx);
    expect(asked).toHaveLength(5);
    // 2 AI images left this month: the first two posts may use one, the others are designed from the real photos.
    expect(asked.map((c) => c.aiAllowed)).toEqual([true, true, false, false, false]);
    expect(asked.every((c) => c.angle?.people)).toBe(true);
    const planned = mocks.planVisuals.mock.calls.map(([p]) => p);
    expect(planned.filter((p) => p.video).length).toBe(2); // the two TikTok posts
    // Covers are made different from one another.
    expect(new Set(planned.map((p) => p.precomputed.slides[0].template)).size).toBeGreaterThan(1);
  });

  it("AI images used up: the pack is still written, every post designed from real photos, with the refill note", async () => {
    mocks.aiPhotosStatus.mockResolvedValue({ allowed: false, exhausted: { refillAt: "2026-11-01T00:00:00.000Z" } });
    await generatePackForSubject({ ...owner, subject, feature: "content" });
    expect(mocks.directVisual.mock.calls.every(([c]) => c.aiAllowed === false)).toBe(true);
    expect(mocks.planVisuals.mock.calls.every(([p]) => p.aiExhausted?.refillAt === "2026-11-01T00:00:00.000Z")).toBe(true);
  });
});
