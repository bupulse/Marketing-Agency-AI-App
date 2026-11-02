import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn(), findMany: vi.fn() },
    skit: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    campaign: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    connection: { findMany: vi.fn() },
    post: { create: vi.fn() },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
  storage: { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
  getSetting: vi.fn(),
  featureStatus: vi.fn(),
  generate: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
  sendEmail: vi.fn(),
  push: vi.fn(),
  autoSchedule: vi.fn(),
  logError: vi.fn(),
  getPlans: vi.fn(),
  getPlanLimits: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/admin/settings", () => ({ getSetting: mocks.getSetting }));
vi.mock("@/lib/admin/auth", () => ({ adminEmails: () => ["admin@bupulse.test"] }));
vi.mock("@/lib/entitlements", () => ({ featureStatus: mocks.featureStatus }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "fake", generate: mocks.generate }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => Promise<unknown>) => call() }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "fake-model" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => mocks.storage } }) }));
vi.mock("@/lib/knowledge/writer-context", () => ({ writerKnowledge: async () => ({ knowledgeBase: null, voiceProfile: null }) }));
vi.mock("@/lib/knowledge/service", () => ({ writingSubject: async () => ({ title: "Red umbrella", context: "<<<P\nRed\nP>>>", price: "5,000 RWF", photoPaths: ["u1/gallery/a.jpg"] }) }));
vi.mock("@/lib/plan-catalog", () => ({ getPlans: mocks.getPlans, getPlanLimits: mocks.getPlanLimits }));
vi.mock("@/lib/publishing/email", () => ({ renderEmail: (x: { heading: string }) => ({ html: x.heading, text: x.heading }), sendEmail: mocks.sendEmail }));
vi.mock("@/lib/push/service", () => ({ pushToLeadWatchers: mocks.push }));
vi.mock("@/lib/team/recipients", () => ({ alertRecipients: async (_b: string, f: string) => [f] }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://bupulse.com" }));
vi.mock("@/lib/content-board/auto", () => ({ autoSchedule: mocks.autoSchedule }));
vi.mock("@/lib/publishing/service", () => ({ accountUsable: () => true }));
vi.mock("@/lib/social/composio/ways", () => ({ tiktokVideoPosts: () => false }));
vi.mock("@/lib/social/registry", () => ({ isNetwork: (n: string) => ["instagram", "facebook", "linkedin", "tiktok", "youtube", "twitter"].includes(n) }));
vi.mock("@/lib/skits/higgsfield", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/skits/higgsfield")>();
  return { ...real, higgsfieldConfigured: () => true, submitSkitVideo: mocks.submit, skitVideoStatus: mocks.status };
});

import { Prisma } from "@/lib/generated/prisma/client";
import { carryOverSkits, checkSkitVideo, claimSkit, orderExtraSkit, saveSkitVoice, sendSkitNotice, SkitError, startSkitVideo, writeDaySkit } from "@/lib/skits/service";
import { sweepSkits } from "@/lib/skits/sweep";

// 09:00 in Kigali on Tuesday 3 November 2026 (a Business skit day).
const NOW = new Date("2026-11-03T07:00:00Z");
const DAY = new Date("2026-11-03T00:00:00Z");
const duplicate = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" });
const owner = { userId: "u1", businessId: "b1" };
const written = { title: "Rain", scene: "A stall.", speakers: [{ name: "Seller", look: "" }, { name: "Customer", look: "" }], lines: [{ speaker: 1, text: "Imvura!" }, { speaker: 2, text: "Umutaka?" }], caption: "Umutaka.", hashtags: ["Kigali"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSetting.mockResolvedValue(false);
  mocks.featureStatus.mockResolvedValue("ok");
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "b1", userId: "u1", name: "Mama Shop", description: "Umbrellas", industryDescription: null, country: "Rwanda", contentLanguage: "English", dailyPostSettings: null, timezone: "Africa/Kigali", logoUrl: null });
  mocks.prisma.skit.findMany.mockResolvedValue([]);
  mocks.prisma.campaign.findMany.mockResolvedValue([]);
  mocks.prisma.product.findMany.mockResolvedValue([{ id: "p1" }]);
  mocks.prisma.skit.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.skit.update.mockResolvedValue({});
  mocks.storage.upload.mockResolvedValue({ error: null });
  mocks.storage.remove.mockResolvedValue({});
  mocks.storage.createSignedUrl.mockImplementation(async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }));
  mocks.generate.mockResolvedValue({ text: JSON.stringify(written), provider: "fake", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
  mocks.sendEmail.mockResolvedValue(true);
  mocks.push.mockResolvedValue(1);
  mocks.autoSchedule.mockResolvedValue({ scheduled: 0, waiting: 2 });
});

describe("writing the day's skit", () => {
  it("claims the day once; a failed write is retaken, a finished one is not", async () => {
    mocks.prisma.skit.create.mockResolvedValueOnce({ id: "s1" });
    expect(await claimSkit("b1", "2026-11-03", NOW)).toEqual({ id: "s1" });
    mocks.prisma.skit.create.mockRejectedValue(duplicate());
    mocks.prisma.skit.findUnique.mockResolvedValueOnce({ id: "s1", status: "WAITING_VOICE", attempts: 1, updatedAt: NOW });
    expect(await claimSkit("b1", "2026-11-03", NOW)).toBeNull();
    mocks.prisma.skit.findUnique.mockResolvedValueOnce({ id: "s1", status: "WRITE_FAILED", attempts: 1, updatedAt: NOW });
    expect(await claimSkit("b1", "2026-11-03", NOW)).toEqual({ id: "s1" });
    mocks.prisma.skit.findUnique.mockResolvedValueOnce({ id: "s1", status: "WRITE_FAILED", attempts: 3, updatedAt: NOW });
    expect(await claimSkit("b1", "2026-11-03", NOW)).toBeNull();
  });

  it("writes the lines in the skit language (Kinyarwanda in Rwanda) and waits for the voice", async () => {
    mocks.prisma.skit.create.mockResolvedValueOnce({ id: "s1" });
    expect(await writeDaySkit("b1", "2026-11-03", NOW)).toBe("s1");
    expect(mocks.generate.mock.calls[0][0].prompt).toContain("Write the lines and the caption in Kinyarwanda");
    expect(mocks.generate.mock.calls[0][0].prompt).toContain("Red umbrella");
    const data = mocks.prisma.skit.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "WAITING_VOICE", language: "Kinyarwanda", subjectKind: "product", subjectId: "p1", voicePaths: ["", ""] });
    expect(data.lines).toEqual(written.lines);
  });

  it("records a failed write to try again later", async () => {
    mocks.prisma.skit.create.mockResolvedValueOnce({ id: "s1" });
    mocks.generate.mockResolvedValueOnce({ text: "not json", provider: "fake", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    expect(await writeDaySkit("b1", "2026-11-03", NOW)).toBeNull();
    expect(mocks.prisma.skit.update.mock.calls[0][0].data.status).toBe("WRITE_FAILED");
  });
});

describe("carry-over and the notice", () => {
  it("moves a skit not recorded yesterday to today, and expires one already moved 3 times", async () => {
    const yesterday = new Date("2026-11-02T00:00:00Z");
    mocks.prisma.skit.findMany.mockResolvedValueOnce([
      { id: "a", plannedDay: yesterday, carryCount: 0, updatedAt: NOW, business: { timezone: "Africa/Kigali" } },
      { id: "b", plannedDay: yesterday, carryCount: 3, updatedAt: NOW, business: { timezone: "Africa/Kigali" } },
      { id: "c", plannedDay: DAY, carryCount: 0, updatedAt: NOW, business: { timezone: "Africa/Kigali" } },
    ]);
    expect(await carryOverSkits(NOW)).toEqual({ moved: 1, expired: 1 });
    expect(mocks.prisma.skit.updateMany).toHaveBeenCalledWith({ where: { id: "a", status: "WAITING_VOICE", updatedAt: NOW }, data: { plannedDay: DAY, carryCount: 1, notifiedAt: null } });
    expect(mocks.prisma.skit.updateMany).toHaveBeenCalledWith({ where: { id: "b", status: "WAITING_VOICE", updatedAt: NOW }, data: { status: "EXPIRED" } });
  });

  it("sends 'Record your skit' once, from 7 in the morning on its day", async () => {
    const skit = { id: "s1", status: "WAITING_VOICE", plannedDay: DAY, notifiedAt: null, businessId: "b1", business: { name: "Mama Shop", timezone: "Africa/Kigali", user: { email: "owner@x.test" } } };
    mocks.prisma.skit.findUnique.mockResolvedValue(skit);
    expect(await sendSkitNotice("s1", new Date("2026-11-03T03:00:00Z"))).toBe(false); // 05:00 in Kigali
    expect(await sendSkitNotice("s1", NOW)).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@x.test", subject: "Record your skit for today" }));
    expect(mocks.push).toHaveBeenCalledWith("b1", expect.objectContaining({ url: "/dashboard/content#skits" }));
  });
});

describe("the voice notes", () => {
  const file = { type: "audio/wav", size: 1000, name: "skit-1.wav", bytes: new Uint8Array(1000) };
  const skit = { id: "s1", status: "WAITING_VOICE", speakers: written.speakers, voicePaths: ["", ""], updatedAt: NOW };

  it("saves one speaker's note in the company account's folder and waits for the other", async () => {
    mocks.prisma.skit.findFirst.mockResolvedValueOnce(skit);
    expect(await saveSkitVoice(owner, "s1", 1, file, NOW)).toEqual({ status: "WAITING_VOICE", missing: [2] });
    expect(mocks.storage.upload.mock.calls[0][0]).toMatch(/^u1\/skits\/s1-1-.+\.wav$/);
    expect(mocks.prisma.skit.updateMany.mock.calls[0][0].data).toMatchObject({ status: "WAITING_VOICE", voiceAt: null });
  });

  it("with every voice in, the skit is 'Voice received' and waits while the switch is off", async () => {
    mocks.prisma.skit.findFirst.mockResolvedValueOnce({ ...skit, voicePaths: ["u1/skits/s1-1-x.wav", ""] });
    expect(await saveSkitVoice(owner, "s1", 2, file, NOW)).toEqual({ status: "VOICE_RECEIVED", missing: [] });
    expect(mocks.prisma.skit.updateMany.mock.calls[0][0].data).toMatchObject({ status: "VOICE_RECEIVED", voiceAt: NOW });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("refuses a wrong file, a wrong speaker and a skit already being made", async () => {
    await expect(saveSkitVoice(owner, "s1", 1, { ...file, type: "image/png", name: "x.png" }, NOW)).rejects.toThrow(SkitError);
    mocks.prisma.skit.findFirst.mockResolvedValueOnce(skit);
    await expect(saveSkitVoice(owner, "s1", 3, file, NOW)).rejects.toThrow("Choose who is speaking.");
    mocks.prisma.skit.findFirst.mockResolvedValueOnce({ ...skit, status: "MAKING" });
    await expect(saveSkitVoice(owner, "s1", 1, file, NOW)).rejects.toThrow(/already being made/);
    expect(mocks.storage.upload).not.toHaveBeenCalled();
  });
});

describe("the video (Higgsfield mocked)", () => {
  const recorded = { id: "s1", status: "VOICE_RECEIVED", updatedAt: NOW, businessId: "b1", scene: "A stall.", speakers: written.speakers, lines: written.lines, language: "Kinyarwanda", subjectKind: "product", subjectId: "p1", voicePaths: ["u1/skits/a.wav", "u1/skits/b.wav"], business: { name: "Mama Shop", userId: "u1", logoUrl: "u1/logo/l.png" } };

  it("does nothing while the switch is off", async () => {
    expect(await startSkitVideo("s1", NOW)).toBe("off");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("sends the voices and pictures once the switch is on", async () => {
    mocks.getSetting.mockResolvedValue(true);
    mocks.prisma.skit.findUnique.mockResolvedValueOnce(recorded);
    mocks.submit.mockResolvedValueOnce("req-1");
    expect(await startSkitVideo("s1", NOW)).toBe("started");
    const req = mocks.submit.mock.calls[0][0];
    expect(req.audioUrls).toEqual(["https://signed/u1/skits/a.wav", "https://signed/u1/skits/b.wav"]);
    expect(req.imageUrls).toEqual(["https://signed/u1/gallery/a.jpg", "https://signed/u1/logo/l.png"]);
    expect(req.seconds).toBe(10);
    expect(req.prompt).toContain("@Audio2");
    expect(mocks.prisma.skit.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { taskId: "req-1" } });
  });

  it("a finished video is kept and becomes posts waiting for approval", async () => {
    mocks.prisma.skit.findUnique.mockResolvedValueOnce({ id: "s1", status: "MAKING", taskId: "req-1", taskStartedAt: NOW, updatedAt: NOW, businessId: "b1", caption: "Umutaka.", hashtags: ["Kigali"], subjectKind: "product", subjectId: "p1", plannedDay: DAY, business: { userId: "u1" } });
    mocks.status.mockResolvedValueOnce({ status: "completed", videoUrl: "https://cdn/v.mp4", error: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(2000), { status: 200 }));
    mocks.prisma.connection.findMany.mockResolvedValueOnce([{ id: "c1", provider: "instagram", status: "ACTIVE", postingMode: "AUTO", accountType: null }]);
    mocks.prisma.post.create.mockImplementation(async ({ data }: { data: { network: string } }) => ({ id: `post-${data.network}` }));
    expect(await checkSkitVideo("s1", NOW)).toBe("ready");
    fetchSpy.mockRestore();
    expect(mocks.storage.upload.mock.calls[0][0]).toBe("u1/skits/s1.mp4");
    const rows = mocks.prisma.post.create.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => r.network)).toEqual(["instagram"]);
    expect(rows[0]).toMatchObject({ status: "PENDING_APPROVAL", source: "DAILY", groupId: "skit-s1", connectionId: "c1", productId: "p1", text: "Umutaka.", mediaPaths: ["u1/skits/s1.mp4"] });
    expect(mocks.autoSchedule).toHaveBeenCalledWith("b1", ["post-instagram"], NOW);
    expect(mocks.prisma.skit.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: expect.objectContaining({ status: "READY", postGroupId: "skit-s1" }) });
  });

  it("a refused video is FAILED with Higgsfield's reason", async () => {
    mocks.prisma.skit.findUnique.mockResolvedValueOnce({ id: "s1", status: "MAKING", taskId: "req-1", taskStartedAt: NOW, updatedAt: NOW, businessId: "b1", business: { userId: "u1" } });
    mocks.status.mockResolvedValueOnce({ status: "failed", videoUrl: null, error: "Higgsfield's moderation refused the video." });
    expect(await checkSkitVideo("s1", NOW)).toBe("failed");
    expect(mocks.prisma.skit.updateMany).toHaveBeenCalledWith({ where: { id: "s1", status: "MAKING" }, data: { status: "FAILED", error: "Higgsfield's moderation refused the video." } });
  });
});

describe("extra skits", () => {
  it("records the order in the next slot and tells BuPulse", async () => {
    mocks.prisma.skit.count.mockResolvedValueOnce(0);
    mocks.prisma.skit.findFirst.mockResolvedValueOnce({ slot: 0 });
    mocks.prisma.skit.create.mockResolvedValueOnce({ id: "x1" });
    expect(await orderExtraSkit(owner, NOW)).toEqual({ id: "x1" });
    expect(mocks.prisma.skit.create.mock.calls[0][0].data).toMatchObject({ slot: 1, extra: true, status: "ORDERED", day: DAY });
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@bupulse.test" }));
  });
  it("refuses a fourth open order", async () => {
    mocks.prisma.skit.count.mockResolvedValueOnce(3);
    await expect(orderExtraSkit(owner, NOW)).rejects.toThrow(/already have 3/);
  });
});

describe("the sweep", () => {
  it("writes today's skit for a company on its skit day, and none for a plan without skits", async () => {
    mocks.getPlans.mockResolvedValue([{ key: "BUSINESS", limits: { skitsPerWeek: 2 } }, { key: "STARTER", limits: {} }]);
    mocks.prisma.business.findMany.mockResolvedValueOnce([{ id: "b1", timezone: "Africa/Kigali", user: { subscription: { plan: "BUSINESS" } } }]);
    mocks.prisma.skit.findUnique.mockResolvedValueOnce(null);
    mocks.prisma.skit.create.mockResolvedValueOnce({ id: "s1" });
    const out = await sweepSkits({ now: NOW });
    expect(out.written).toBe(1);
    expect(mocks.prisma.business.findMany.mock.calls[0][0].where.user.subscription.plan).toEqual({ in: ["BUSINESS"] });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("writes nothing on a day that is not a skit day", async () => {
    mocks.getPlans.mockResolvedValue([{ key: "BUSINESS", limits: { skitsPerWeek: 2 } }]);
    mocks.prisma.business.findMany.mockResolvedValueOnce([{ id: "b1", timezone: "Africa/Kigali", user: { subscription: { plan: "BUSINESS" } } }]);
    const out = await sweepSkits({ now: new Date("2026-11-02T07:00:00Z") }); // Monday
    expect(out.written).toBe(0);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
