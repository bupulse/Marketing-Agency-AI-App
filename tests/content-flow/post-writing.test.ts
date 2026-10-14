import { beforeEach, describe, expect, it, vi } from "vitest";

// "Generate again" and the versions of one post (lib/content-flow/post-writing.ts): one text generation each, given
// back when anything fails; every change kept as a version; restoring adds a version; everything scoped by business.

const prisma = vi.hoisted(() => ({
  post: { findFirst: vi.fn(), updateMany: vi.fn() },
  generatedContent: { findFirst: vi.fn(), updateMany: vi.fn() },
  business: { findUnique: vi.fn() },
  postVersion: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const usage = vi.hoisted(() => {
  class UsageLimitError extends Error {
    constructor(
      public reason: string,
      public metric: string,
    ) {
      super("limit");
    }
  }
  return { consumeUsage: vi.fn(), refundUsage: vi.fn(), getUsageSummary: vi.fn(), UsageLimitError };
});
const ai = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini", generate: ai.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: (_a: unknown, _b: unknown, fn: () => unknown) => fn() }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "test-model" }));
vi.mock("@/lib/visuals/service", () => ({ VisualError: class extends Error {} }));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: "Customers: schools in Kigali.\nPrice: 15,000 RWF", voiceProfile: null }) }));
vi.mock("@/lib/knowledge/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge/service")>()),
  writingSubject: vi.fn(async () => ({ subject: { kind: "product", id: "p-tower" }, type: "product", title: "Hydro tower", context: "Name: Hydro tower\nPrice: 15,000 RWF\nGrows 40 plants", price: "15,000 RWF", features: ["Grows 40 plants"], photoPaths: [] })),
}));

import { AIProviderError } from "@/lib/ai/types";
import { addVersion } from "@/lib/content-flow/post-versions";
import { postWritingView, PostWriteError, restorePostVersion, rewritePost, WRITE_FAILED } from "@/lib/content-flow/post-writing";
import { UsageLimitError } from "@/lib/usage";

const actor = { userId: "owner-account", businessId: "b1", actorId: "person-1" };
const CREATED = new Date("2026-10-14T06:00:00Z");
const SCRIPT = "[Tower in a classroom] Grow greens at school.\n[Kids pick lettuce] Fresh every week.\n[Logo] Ask us today.";
const HEADLINES = ["Grow at school", "Greens for every class", "Lettuce by Friday"];
const post = (extra: Record<string, unknown> = {}) => ({ id: "p1", businessId: "b1", network: "instagram", status: "PENDING_APPROVAL", format: "POST", title: null, text: "Fresh greens at school.", hashtags: ["#green"], contest: null, contentId: "c1", createdAt: CREATED, updatedAt: CREATED, ...extra });
const content = (extra: Record<string, unknown> = {}) => ({ id: "c1", caption: "Fresh greens at school.", videoScript: SCRIPT, adHeadlines: HEADLINES, angle: "tips", format: "image", mode: "ai", brief: null, productId: "p-tower", campaignId: null, ...extra });
const reply = (body: unknown) => ({ text: JSON.stringify(body), provider: "gemini", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
const versionsMade = () => prisma.postVersion.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.post.findFirst.mockResolvedValue(post());
  prisma.post.updateMany.mockResolvedValue({ count: 1 });
  prisma.generatedContent.findFirst.mockResolvedValue(content());
  prisma.generatedContent.updateMany.mockResolvedValue({ count: 1 });
  prisma.business.findUnique.mockResolvedValue({ id: "b1", name: "Green Kigali", contentLanguage: "Kinyarwanda", industry: null, industryRef: null, description: null, audience: null, tone: "friendly", website: null, knowledge: null, profile: null, marketingProfile: null });
  prisma.postVersion.findFirst.mockResolvedValue(null);
  prisma.postVersion.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "v-new", ...data }));
  prisma.postVersion.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  usage.consumeUsage.mockResolvedValue({ periodStart: new Date("2026-10-01") });
  usage.refundUsage.mockResolvedValue(undefined);
  usage.getUsageSummary.mockResolvedValue({ used: { text: 27 }, limits: { text: 30 } });
});

describe("Generate again", () => {
  it("writes three new ad headlines in the brand's language for one text generation, and keeps both versions", async () => {
    ai.generate.mockResolvedValue(reply({ adHeadlines: ["Amashu ku ishuri", "Imboga nshya buri cyumweru", "Twandikire uyu munsi"] }));
    await rewritePost(actor, "p1", "headlines");

    expect(usage.consumeUsage).toHaveBeenCalledTimes(1);
    expect(usage.consumeUsage).toHaveBeenCalledWith("owner-account", "text");
    expect(usage.refundUsage).not.toHaveBeenCalled();
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Write in Kinyarwanda.");
    expect(prompt).toContain("<<<PREVIOUS HEADLINES\n- Grow at school");
    expect(prompt).toContain("Write exactly 3 different ad headlines");
    // The post does not show its price, so the writer gets none and is told not to state one.
    expect(prompt).toContain("Do not mention any price");
    expect(prompt).not.toContain("15,000");

    expect(prisma.post.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", businessId: "b1" });
    expect(prisma.generatedContent.updateMany).toHaveBeenCalledWith({ where: { id: "c1", businessId: "b1" }, data: { adHeadlines: ["Amashu ku ishuri", "Imboga nshya buri cyumweru", "Twandikire uyu munsi"] } });
    expect(prisma.post.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "p1", businessId: "b1", text: "Fresh greens at school.", hashtags: { equals: ["#green"] } }, data: { text: "Fresh greens at school.", hashtags: ["#green"] } });
    expect(versionsMade()).toEqual([
      expect.objectContaining({ businessId: "b1", postId: "p1", kind: "original", adHeadlines: HEADLINES, createdAt: CREATED }),
      expect.objectContaining({ businessId: "b1", postId: "p1", kind: "regenerate", part: "headlines", actorId: "person-1", adHeadlines: ["Amashu ku ishuri", "Imboga nshya buri cyumweru", "Twandikire uyu munsi"], text: "Fresh greens at school." }),
    ]);
  });

  it("writes a new caption from a fresh take (the old one in the prompt), held to the app's rules", async () => {
    ai.generate.mockResolvedValue(reply({ posts: [{ index: 1, caption: "Lettuce grown by pupils, right in class. 🌱 Ask us how.", hashtags: ["school", "#green"], videoScript: SCRIPT, adHeadlines: HEADLINES }] }));
    await rewritePost(actor, "p1", "caption");
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('A previous version read:\n"""Fresh greens at school."""');
    expect(prompt).toContain("Write all content in Kinyarwanda");
    expect(prompt).toMatch(/1\. Angle "Tip of the day|1\. Angle "Tips/);
    expect(prisma.post.updateMany.mock.calls[0][0].data).toEqual({ text: "Lettuce grown by pupils, right in class. 🌱 Ask us how.", hashtags: ["#school", "#green"] });
    // Only the caption: the script and headlines stay.
    expect(prisma.generatedContent.updateMany.mock.calls[0][0].data).toEqual({ caption: "Lettuce grown by pupils, right in class. 🌱 Ask us how.", hashtags: ["#school", "#green"] });
    expect(versionsMade()[1]).toMatchObject({ kind: "regenerate", part: "caption", videoScript: SCRIPT, adHeadlines: HEADLINES });
  });

  it("writes the whole post again: caption, 30-second script and exactly three headlines", async () => {
    ai.generate.mockResolvedValue(reply({ posts: [{ index: 1, caption: "New caption.", hashtags: ["#a"], videoScript: "[Shot one] Line one.\n[Shot two] Line two.\n[Logo] Visit us.", adHeadlines: ["One", "Two", "Three", "Four"] }] }));
    await rewritePost(actor, "p1", "post");
    expect(prisma.generatedContent.updateMany.mock.calls[0][0].data).toEqual({ caption: "New caption.", hashtags: ["#a"], videoScript: "[Shot one] Line one.\n[Shot two] Line two.\n[Logo] Visit us.", adHeadlines: ["One", "Two", "Three"] });
    expect(versionsMade()[1]).toMatchObject({ kind: "regenerate", part: "post", text: "New caption.", adHeadlines: ["One", "Two", "Three"] });
  });

  it("writes a new video script from a fresh take; on a script post the post's text is the new script", async () => {
    prisma.post.findFirst.mockResolvedValue(post({ network: "tiktok", format: "SCRIPT", text: SCRIPT, hashtags: ["#green"] }));
    ai.generate.mockResolvedValue(reply({ scenes: ["[Close-up of lettuce] Grown in class.", "[Pupils smile] They love it.", "[Logo] Call us today."] }));
    await rewritePost(actor, "p1", "script");
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("<<<PREVIOUS SCRIPT\n[Tower in a classroom]");
    const script = "[Close-up of lettuce] Grown in class.\n[Pupils smile] They love it.\n[Logo] Call us today.";
    expect(prisma.post.updateMany.mock.calls[0][0].data).toEqual({ text: script, hashtags: ["#green"] });
    expect(prisma.generatedContent.updateMany.mock.calls[0][0].data).toEqual({ videoScript: script });
  });

  it("a post that shows its price keeps it: the writer gets the price and is asked to state it exactly", async () => {
    prisma.post.findFirst.mockResolvedValue(post({ text: "The hydro tower: 15,000 RWF." }));
    ai.generate.mockResolvedValue(reply({ posts: [{ index: 1, caption: "Only 15,000 RWF for a classroom garden.", hashtags: [], videoScript: SCRIPT, adHeadlines: HEADLINES }] }));
    await rewritePost(actor, "p1", "caption");
    const prompt = ai.generate.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("State the price exactly as given: 15,000 RWF.");
    expect(prisma.post.updateMany.mock.calls[0][0].data.text).toBe("Only 15,000 RWF for a classroom garden.");
  });

  it("with no text generations left it charges nothing, writes nothing and says why (the screen offers the plans)", async () => {
    usage.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "text"));
    const error = await rewritePost(actor, "p1", "headlines").catch((e) => e);
    expect(error).toBeInstanceOf(PostWriteError);
    expect(error).toMatchObject({ message: "No text generations left this month.", blocked: "limit_reached" });
    expect(ai.generate).not.toHaveBeenCalled();
    expect(usage.refundUsage).not.toHaveBeenCalled();
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("gives the generation back when the AI fails, returns fewer than three headlines, or the post changed meanwhile", async () => {
    ai.generate.mockRejectedValueOnce(new AIProviderError("down", "gemini", true));
    await expect(rewritePost(actor, "p1", "headlines")).rejects.toThrow(WRITE_FAILED);
    ai.generate.mockResolvedValueOnce(reply({ adHeadlines: ["Only one"] }));
    await expect(rewritePost(actor, "p1", "headlines")).rejects.toThrow(WRITE_FAILED);
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
    expect(prisma.postVersion.create).not.toHaveBeenCalled();

    ai.generate.mockResolvedValueOnce(reply({ adHeadlines: ["One", "Two", "Three"] }));
    prisma.post.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(rewritePost(actor, "p1", "headlines")).rejects.toThrow(/changed while BuPulse was writing/);
    expect(usage.refundUsage).toHaveBeenCalledTimes(3);
    expect(usage.refundUsage).toHaveBeenCalledWith("owner-account", "text", new Date("2026-10-01"));
    expect(prisma.generatedContent.updateMany).not.toHaveBeenCalled();
  });

  it("is refused before charging for another business's post, a post that went out, a hand-made post or a contest's caption", async () => {
    prisma.post.findFirst.mockResolvedValueOnce(null);
    await expect(rewritePost(actor, "p-other", "post")).rejects.toThrow("We could not find that post.");
    expect(prisma.post.findFirst.mock.calls[0][0].where).toEqual({ id: "p-other", businessId: "b1" });
    prisma.post.findFirst.mockResolvedValueOnce(post({ status: "PUBLISHED" }));
    await expect(rewritePost(actor, "p1", "post")).rejects.toThrow(/can no longer be changed/);
    prisma.post.findFirst.mockResolvedValueOnce(post({ contentId: null }));
    await expect(rewritePost(actor, "p1", "post")).rejects.toThrow(/BuPulse did not write this post/);
    prisma.post.findFirst.mockResolvedValueOnce(post({ contest: {} }));
    await expect(rewritePost(actor, "p1", "caption")).rejects.toThrow(/contest keeps its caption/);
    expect(usage.consumeUsage).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("looks the content up inside the business too", async () => {
    prisma.generatedContent.findFirst.mockResolvedValueOnce(null);
    await expect(rewritePost(actor, "p1", "script")).rejects.toThrow(/BuPulse did not write this post/);
    expect(prisma.generatedContent.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", businessId: "b1" });
  });
});

describe("restoring a version", () => {
  const older = { id: "v1", kind: "original", part: null, restoredFromId: null, actorId: null, createdAt: CREATED, title: null, text: "The first caption.", hashtags: ["#first"], videoScript: "[Old] Old script.", adHeadlines: ["Old one", "Old two", "Old three"] };

  it("brings it back as a new current version: nothing is deleted, the script and headlines come back too", async () => {
    prisma.postVersion.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("id" in where ? older : null));
    expect(await restorePostVersion(actor, "p1", "v1")).toEqual({ changed: true });
    expect(prisma.postVersion.findFirst.mock.calls.find((c) => "id" in c[0].where)![0].where).toEqual({ id: "v1", postId: "p1", businessId: "b1" });
    expect(prisma.post.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "p1", businessId: "b1", status: "PENDING_APPROVAL" }, data: { title: null, text: "The first caption.", hashtags: ["#first"] } });
    expect(prisma.generatedContent.updateMany).toHaveBeenCalledWith({ where: { id: "c1", businessId: "b1" }, data: { videoScript: "[Old] Old script.", adHeadlines: ["Old one", "Old two", "Old three"] } });
    expect(versionsMade().at(-1)).toMatchObject({ businessId: "b1", postId: "p1", kind: "restore", restoredFromId: "v1", actorId: "person-1", text: "The first caption." });
    expect(prisma.postVersion.deleteMany).not.toHaveBeenCalled();
    expect(usage.consumeUsage).not.toHaveBeenCalled();
  });

  it("a scheduled contest restored away from its confirmed prize goes back to waiting for confirmation", async () => {
    prisma.post.findFirst.mockResolvedValue(post({ status: "SCHEDULED", text: "Win 50,000 RWF! Ends 20 October. Most likes wins.", contest: { prize: "50,000 RWF", endsOn: "2026-10-20", howChosen: "Most likes wins", confirmedAt: "2026-10-14T07:00:00Z" } }));
    prisma.postVersion.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("id" in where ? { ...older, text: "Win [PRIZE]! Rules: [HOW THE WINNER IS CHOSEN]." } : null));
    await restorePostVersion(actor, "p1", "v1");
    expect(prisma.post.updateMany.mock.calls[0][0].data).toMatchObject({ status: "PENDING_APPROVAL", reviewNote: "Needs your confirmation: prize & rules", autoScheduledAt: null });
  });

  it("does nothing for the current version, and finds no version of another business or post", async () => {
    prisma.postVersion.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("id" in where ? { ...older, text: "Fresh greens at school.", hashtags: ["#green"], videoScript: SCRIPT, adHeadlines: HEADLINES } : null));
    expect(await restorePostVersion(actor, "p1", "v1")).toEqual({ changed: false });
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
    prisma.postVersion.findFirst.mockResolvedValue(null);
    await expect(restorePostVersion(actor, "p1", "v-other")).rejects.toThrow(/could not find that version/);
    prisma.post.findFirst.mockResolvedValueOnce(post({ status: "PUBLISHED" }));
    await expect(restorePostVersion(actor, "p1", "v1")).rejects.toThrow(/can no longer be changed/);
  });
});

describe("the post's panel", () => {
  it("lists the versions newest first, numbered, the current one marked, with who made each", async () => {
    prisma.postVersion.findMany.mockResolvedValue([
      { id: "v3", kind: "restore", part: null, restoredFromId: "v1", actorId: "person-2", createdAt: new Date("2026-10-14T09:00:00Z"), title: null, text: "Fresh greens at school.", hashtags: ["#green"], videoScript: SCRIPT, adHeadlines: HEADLINES },
      { id: "v2", kind: "regenerate", part: "caption", restoredFromId: null, actorId: "person-1", createdAt: new Date("2026-10-14T08:00:00Z"), title: null, text: "Another take.", hashtags: [], videoScript: SCRIPT, adHeadlines: HEADLINES },
      { id: "v1", kind: "original", part: null, restoredFromId: null, actorId: null, createdAt: CREATED, title: null, text: "Fresh greens at school.", hashtags: ["#green"], videoScript: SCRIPT, adHeadlines: HEADLINES },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: "person-2", name: "Aline", email: "aline@example.com" }]);
    const view = await postWritingView(actor, "p1");
    expect(prisma.postVersion.findMany.mock.calls[0][0].where).toEqual({ postId: "p1", businessId: "b1" });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["person-2"] } });
    expect(view.versions.map((v) => v.preview)).toEqual(["Fresh greens at school.", "Another take.", "Fresh greens at school."]);
    expect(view.versions.map((v) => [v.number, v.label, v.by, v.current])).toEqual([
      [3, "Restored version 1", "Aline", true],
      [2, "New caption", "you", false],
      [1, "First version", null, false],
    ]);
    expect(view).toMatchObject({ written: true, videoScript: SCRIPT, adHeadlines: HEADLINES, language: "Kinyarwanda", parts: ["post", "caption", "script", "headlines"], canRestore: true, usage: { left: 3, limit: 30 } });
  });

  it("a published post can be read but not changed", async () => {
    prisma.post.findFirst.mockResolvedValue(post({ status: "PUBLISHED" }));
    const view = await postWritingView(actor, "p1");
    expect(view).toMatchObject({ parts: [], canRestore: false });
  });
});

describe("keeping versions", () => {
  it("keeps the newest 50 per post, deleting only the business's own older ones", async () => {
    prisma.postVersion.findMany.mockResolvedValue([{ id: "old-1" }, { id: "old-2" }]);
    await addVersion(prisma as never, { id: "p1", businessId: "b1" }, { title: null, text: "t", hashtags: [], videoScript: "", adHeadlines: [] }, { kind: "edit", actorId: "person-1" });
    expect(prisma.postVersion.findMany.mock.calls[0][0]).toMatchObject({ where: { postId: "p1", businessId: "b1" }, skip: 50 });
    expect(prisma.postVersion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old-1", "old-2"] }, businessId: "b1" } });
  });
});
