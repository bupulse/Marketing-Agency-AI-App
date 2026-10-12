import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    connection: { findMany: vi.fn() },
    autopilotSettings: { upsert: vi.fn() },
    post: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  },
  approvePosts: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  writeGroup: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini" }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "gemini-test" }));
vi.mock("@/lib/publishing/service", () => ({ approvePosts: mocks.approvePosts }));
vi.mock("@/lib/autopilot/writer", () => ({ writeGroup: mocks.writeGroup }));
vi.mock("@/lib/usage", async () => {
  class UsageLimitError extends Error {
    constructor(public reason: string, public metric: string) {
      super("limit");
    }
  }
  return { consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage, UsageLimitError };
});

import { approveAll, regenerateGroup, removeGroup, saveSettings } from "@/lib/autopilot/manage";
import { UsageLimitError } from "@/lib/usage";

const periodStart = new Date("2026-10-01");
const business = { id: "biz1", userId: "user1", name: "Sunrise Bakery", industry: null, description: null, audience: null, tone: null, website: null, ceoName: null, country: "Rwanda", contentLanguage: "English", knowledge: null, timezone: "Africa/Kigali" };

const valid = { enabled: true, autoPublish: false, postsPerWeek: 4, connectionIds: ["c1"], postingTimes: ["09:00", "18:00"], useAiImages: false, skipReligious: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.business.findUnique.mockResolvedValue(business);
  mocks.prisma.connection.findMany.mockResolvedValue([{ id: "c1", provider: "instagram" }]);
  mocks.consumeUsage.mockResolvedValue({ periodStart });
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.logError.mockResolvedValue(undefined);
});

describe("saving settings", () => {
  it("saves for the signed-in user's business, including the skip-religious-holidays choice", async () => {
    expect(await saveSettings("user1", { ...valid, skipReligious: true })).toEqual({ ok: true });
    expect(mocks.prisma.business.findUnique).toHaveBeenCalledWith({ where: { userId: "user1" }, include: { industryRef: true } });
    const call = mocks.prisma.autopilotSettings.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ businessId: "biz1" });
    expect(call.update).toMatchObject({ enabled: true, postsPerWeek: 4, connectionIds: ["c1"], postingTimes: ["09:00", "18:00"], skipReligiousHolidays: true });
  });

  it("drops accounts that are not the user's own (IDOR)", async () => {
    mocks.prisma.connection.findMany.mockResolvedValue([{ id: "c1", provider: "instagram" }]);
    await saveSettings("user1", { ...valid, connectionIds: ["c1", "someone-elses"] });
    expect(mocks.prisma.connection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: "biz1", kind: "SOCIAL" }) }));
    expect(mocks.prisma.autopilotSettings.upsert.mock.calls[0][0].update.connectionIds).toEqual(["c1"]);
  });

  it("refuses to switch on with no valid account", async () => {
    mocks.prisma.connection.findMany.mockResolvedValue([]);
    const result = await saveSettings("user1", { ...valid, connectionIds: ["someone-elses"] });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/at least one account/) });
    expect(mocks.prisma.autopilotSettings.upsert).not.toHaveBeenCalled();
  });

  it("validates the numbers and times", async () => {
    expect((await saveSettings("user1", { ...valid, postsPerWeek: 1 })).ok).toBe(false);
    expect((await saveSettings("user1", { ...valid, postsPerWeek: 15 })).ok).toBe(false);
    expect((await saveSettings("user1", { ...valid, postsPerWeek: 2.5 })).ok).toBe(false);
    expect((await saveSettings("user1", { ...valid, postingTimes: ["25:00"] })).ok).toBe(false);
    expect((await saveSettings("user1", { ...valid, postingTimes: [] })).ok).toBe(false);
    expect((await saveSettings("user1", { ...valid, postingTimes: ["06:00", "07:00", "08:00", "09:00", "10:00"] })).ok).toBe(false);
    expect(mocks.prisma.autopilotSettings.upsert).not.toHaveBeenCalled();
  });

  it("does nothing for a user without a business", async () => {
    mocks.prisma.business.findUnique.mockResolvedValue(null);
    expect((await saveSettings("ghost", valid)).ok).toBe(false);
  });
});

describe("approve, remove (IDOR)", () => {
  it("approves only the user's own posts waiting for approval", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    mocks.approvePosts.mockResolvedValue({ approved: 2 });
    expect(await approveAll("user1")).toEqual({ ok: true, approved: 2 });
    expect(mocks.prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz1", source: "AUTOPILOT", status: "PENDING_APPROVAL" } }));
    expect(mocks.approvePosts).toHaveBeenCalledWith("biz1", ["p1", "p2"]);
  });

  it("removes only changeable Autopilot posts of the user's business", async () => {
    mocks.prisma.post.deleteMany.mockResolvedValue({ count: 2 });
    expect(await removeGroup("user1", "g1")).toEqual({ ok: true, removed: 2 });
    expect(mocks.prisma.post.deleteMany).toHaveBeenCalledWith({
      where: { groupId: "g1", source: "AUTOPILOT", status: { in: ["PENDING_APPROVAL", "SCHEDULED", "DRAFT"] }, business: { userId: "user1" } },
    });
  });

  it("says so when another user's group matches nothing", async () => {
    mocks.prisma.post.deleteMany.mockResolvedValue({ count: 0 });
    expect((await removeGroup("intruder", "g1")).ok).toBe(false);
  });
});

describe("regenerating a post", () => {
  const post = { id: "p1", network: "instagram", format: "POST", text: "Old text about bread", playbookId: "tip-how-to", scheduledAt: new Date("2026-10-13T07:00:00Z"), project: null };

  it("charges 1 text credit and rewrites every post of the group", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post, { ...post, id: "p2", network: "linkedin" }]);
    mocks.writeGroup.mockResolvedValue({
      image: {},
      versions: [
        { network: "instagram", title: null, text: "New IG", hashtags: ["#a"] },
        { network: "linkedin", title: null, text: "New LI", hashtags: [] },
      ],
    });
    expect(await regenerateGroup("user1", "g1")).toEqual({ ok: true });
    expect(mocks.consumeUsage).toHaveBeenCalledTimes(1);
    expect(mocks.consumeUsage).toHaveBeenCalledWith("user1", "text");
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    expect(mocks.writeGroup.mock.calls[0][1]).toMatchObject({ previousText: "Old text about bread" });
    expect(mocks.prisma.post.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.post.updateMany.mock.calls[0][0].where).toMatchObject({ businessId: "biz1" });
  });

  it("looks the group up inside the user's business only (IDOR)", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([]);
    const result = await regenerateGroup("intruder", "g1");
    expect(result.ok).toBe(false);
    expect(mocks.prisma.post.findMany.mock.calls[0][0].where).toMatchObject({ groupId: "g1", businessId: "biz1", source: "AUTOPILOT" });
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
  });

  it("refunds the credit and keeps the old text when the AI fails", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post]);
    mocks.writeGroup.mockRejectedValue(new Error("model down"));
    const result = await regenerateGroup("user1", "g1");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/credit was returned/) });
    expect(mocks.refundUsage).toHaveBeenCalledWith("user1", "text", periodStart);
    expect(mocks.prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it("explains when there are no credits and charges nothing", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([post]);
    mocks.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "text"));
    const result = await regenerateGroup("user1", "g1");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no text credits/) });
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    expect(mocks.writeGroup).not.toHaveBeenCalled();
  });
});
