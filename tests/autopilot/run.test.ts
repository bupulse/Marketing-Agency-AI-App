import { beforeEach, describe, expect, it, vi } from "vitest";
// Plans are not part of this test's database: every plan feature is granted (tests/stubs/entitlements.ts).
vi.mock("@/lib/entitlements", () => import("@/tests/stubs/entitlements"));

const mocks = vi.hoisted(() => ({
  prisma: {
    business: { findUnique: vi.fn() },
    autopilotRun: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    autopilotSettings: { findMany: vi.fn() },
    post: { createMany: vi.fn(), count: vi.fn() },
    serviceSwitch: { findMany: vi.fn() },
  },
  planWeek: vi.fn(),
  consumeUsage: vi.fn(),
  refundUsage: vi.fn(),
  writeGroup: vi.fn(),
  makeGroupImages: vi.fn(),
  sendReadyEmail: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: mocks.logError }));
vi.mock("@/lib/ai", () => ({ getTextProvider: () => ({ name: "gemini" }) }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: async (_c: unknown, _m: unknown, call: () => unknown) => call() }));
vi.mock("@/lib/studio/service", () => ({ configuredModel: () => "gemini-test" }));
vi.mock("@/lib/usage", async () => {
  class UsageLimitError extends Error {
    constructor(public reason: string, public metric: string) {
      super("limit");
    }
  }
  return { consumeUsage: mocks.consumeUsage, refundUsage: mocks.refundUsage, UsageLimitError };
});
vi.mock("@/lib/autopilot/plan", () => ({ planWeek: mocks.planWeek }));
vi.mock("@/lib/autopilot/writer", () => ({ writeGroup: mocks.writeGroup }));
vi.mock("@/lib/autopilot/images", () => ({ makeGroupImages: mocks.makeGroupImages, aspectFor: (n: string) => (n === "instagram" ? "4:5" : "1:1") }));
vi.mock("@/lib/autopilot/notify", () => ({ sendReadyEmail: mocks.sendReadyEmail }));

import { Prisma } from "@/lib/generated/prisma/client";
import { AIBudgetExceededError } from "@/lib/ai/budget";
import { AIProviderError } from "@/lib/ai/types";
import { getIdea } from "@/lib/autopilot/playbook";
import { runAutopilot, runAutopilotForUser, runDueBusinesses } from "@/lib/autopilot/run";
import { UsageLimitError } from "@/lib/usage";
import { clearSwitchCache } from "@/lib/admin/switch";

const now = new Date("2026-10-09T08:00:00Z");
const periodStart = new Date("2026-10-01");
const weekKey = new Date("2026-10-12T00:00:00Z"); // the local Monday as a date, whatever the time zone

const business = {
  id: "biz1",
  userId: "user1",
  name: "Sunrise Bakery",
  industry: "Food",
  description: "Fresh bread",
  audience: "Neighbours",
  tone: "friendly",
  website: null,
  ceoName: "Amina",
  country: "Rwanda",
  contentLanguage: "English",
  knowledge: null,
  timezone: "Africa/Kigali",
  user: { id: "user1", email: "owner@example.com", deletionScheduledFor: null },
};

function group(idea: string, networks: ("instagram" | "linkedin" | "tiktok")[] = ["instagram", "linkedin"]) {
  const formats = { instagram: "POST", linkedin: "POST", tiktok: "SCRIPT" } as const;
  return {
    groupId: `g-${idea}`,
    idea: getIdea(idea)!,
    day: "2026-10-13",
    photos: [],
    networks,
    posts: networks.map((n) => ({ connectionId: `c-${n}`, network: n, format: formats[n], scheduledAt: new Date("2026-10-13T07:00:00Z") })),
  };
}

const written = (networks: string[]) => ({
  image: { kicker: "Tip", headline: "Fresh", subline: "", chip: "" },
  versions: networks.map((n) => ({ network: n, title: null, text: `Text for ${n}`, hashtags: ["#bread"] })),
  provider: "gemini",
  model: "gemini-test",
  usage: { inputTokens: 1, outputTokens: 1 },
});

function plan(groups: ReturnType<typeof group>[], config: Partial<{ autoPublish: boolean; useAiImages: boolean }> = {}) {
  return {
    groups,
    notes: [] as string[],
    input: { connections: [{ id: "c-instagram", network: "instagram" }], config: { autoPublish: false, useAiImages: false, ...config } },
  };
}

beforeEach(() => {
  mocks.prisma.serviceSwitch.findMany.mockResolvedValue([]);
  clearSwitchCache();
  vi.resetAllMocks();
  mocks.prisma.business.findUnique.mockResolvedValue(business);
  mocks.prisma.autopilotRun.create.mockResolvedValue({ id: "run1" });
  mocks.prisma.autopilotRun.update.mockResolvedValue({});
  mocks.consumeUsage.mockResolvedValue({ periodStart });
  mocks.refundUsage.mockResolvedValue(undefined);
  mocks.writeGroup.mockImplementation(async (_p: unknown, req: { targets: { network: string }[] }) => written(req.targets.map((t) => t.network)));
  mocks.makeGroupImages.mockImplementation(async () => ({ designs: { "4:5": "user1/designs/a.png", "1:1": "user1/designs/b.png" }, aiStopped: false, notes: [], aiUsed: false }));
  mocks.prisma.post.createMany.mockResolvedValue({ count: 0 });
  mocks.prisma.post.count.mockResolvedValue(0);
  mocks.sendReadyEmail.mockResolvedValue(true);
  mocks.logError.mockResolvedValue(undefined);
});

const created = () => mocks.prisma.post.createMany.mock.calls.flatMap((c) => c[0].data as Record<string, unknown>[]);

describe("an Autopilot run", () => {
  it("claims the week, charges 1 text credit per group and saves posts waiting for approval", async () => {
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question")]));
    const result = await runAutopilot("biz1", { now });

    expect(mocks.prisma.autopilotRun.create).toHaveBeenCalledWith({ data: { businessId: "biz1", weekStart: weekKey }, select: { id: true } });
    expect(mocks.consumeUsage).toHaveBeenCalledTimes(2);
    expect(mocks.consumeUsage).toHaveBeenCalledWith("user1", "text");
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "planned", postCount: 4, groupCount: 2 });

    const posts = created();
    expect(posts).toHaveLength(4);
    for (const p of posts) {
      expect(p).toMatchObject({ businessId: "biz1", source: "AUTOPILOT", status: "PENDING_APPROVAL", autopilotRunId: "run1" });
      expect(typeof p.playbookId).toBe("string");
      expect(typeof p.groupId).toBe("string");
    }
    // Both networks of a group share its groupId; each network has its own version and picture size.
    const tip = posts.filter((p) => p.groupId === "g-tip-how-to");
    expect(tip.map((p) => p.network).sort()).toEqual(["instagram", "linkedin"]);
    expect(tip.find((p) => p.network === "instagram")!.mediaPaths).toEqual(["user1/designs/a.png"]);
    expect(tip.find((p) => p.network === "linkedin")!.mediaPaths).toEqual(["user1/designs/b.png"]);
    expect(mocks.prisma.autopilotRun.update).toHaveBeenLastCalledWith({ where: { id: "run1" }, data: { status: "DONE", postCount: 4, error: null } });
  });

  it("emails the owner when posts need approval", async () => {
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    await runAutopilot("biz1", { now });
    expect(mocks.sendReadyEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", postCount: 2 }));
  });

  it("schedules directly and sends no approval email with 'Post without asking'", async () => {
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")], { autoPublish: true }));
    await runAutopilot("biz1", { now });
    expect(created().every((p) => p.status === "SCHEDULED")).toBe(true);
    expect(mocks.sendReadyEmail).not.toHaveBeenCalled();
  });

  it("is idempotent: a second call for a planned week does nothing and charges nothing", async () => {
    mocks.prisma.autopilotRun.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    mocks.prisma.autopilotRun.findUnique.mockResolvedValue({ id: "run1", status: "DONE", postCount: 4, createdAt: new Date("2026-10-09T06:00:00Z") });
    const result = await runAutopilot("biz1", { now });
    expect(result.status).toBe("already_planned");
    expect(mocks.planWeek).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.prisma.post.createMany).not.toHaveBeenCalled();
  });

  it("does not take over a run that is still going", async () => {
    mocks.prisma.autopilotRun.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    mocks.prisma.autopilotRun.findUnique.mockResolvedValue({ id: "run1", status: "RUNNING", postCount: 0, createdAt: new Date("2026-10-09T07:55:00Z") });
    expect((await runAutopilot("biz1", { now })).status).toBe("already_planned");
    expect(mocks.prisma.autopilotRun.updateMany).not.toHaveBeenCalled();
  });

  it("retries a failed run, once, even when two callers race", async () => {
    mocks.prisma.autopilotRun.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    mocks.prisma.autopilotRun.findUnique.mockResolvedValue({ id: "run1", status: "FAILED", postCount: 0, createdAt: new Date("2026-10-09T06:00:00Z") });
    mocks.prisma.autopilotRun.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    const [a, b] = await Promise.all([runAutopilot("biz1", { now }), runAutopilot("biz1", { now })]);
    expect([a.status, b.status].sort()).toEqual(["already_planned", "planned"]);
    expect(mocks.planWeek).toHaveBeenCalledTimes(1);
  });

  it("retries a stale RUNNING run and an empty DONE run", async () => {
    mocks.prisma.autopilotRun.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    mocks.prisma.autopilotRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    for (const run of [
      { id: "run1", status: "RUNNING", postCount: 0, createdAt: new Date("2026-10-09T07:00:00Z") },
      { id: "run1", status: "DONE", postCount: 0, createdAt: new Date("2026-10-08T07:00:00Z") },
    ]) {
      mocks.prisma.autopilotRun.findUnique.mockResolvedValue(run);
      expect((await runAutopilot("biz1", { now })).status).toBe("planned");
    }
  });

  it("keys the week by the local Monday date, so a time zone change cannot make a second run", async () => {
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    await runAutopilot("biz1", { now });
    mocks.prisma.business.findUnique.mockResolvedValue({ ...business, timezone: "America/New_York" });
    mocks.prisma.autopilotRun.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    mocks.prisma.autopilotRun.findUnique.mockResolvedValue({ id: "run1", status: "DONE", postCount: 2, createdAt: now });
    const second = await runAutopilot("biz1", { now });
    expect(second.status).toBe("already_planned");
    const keys = mocks.prisma.autopilotRun.create.mock.calls.map((c) => c[0].data.weekStart.toISOString());
    expect(keys).toEqual([weekKey.toISOString(), weekKey.toISOString()]);
    expect(mocks.planWeek).toHaveBeenCalledTimes(1);
  });

  it("closes a stale RUNNING run that already saved posts instead of planning the week again", async () => {
    mocks.prisma.autopilotRun.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    mocks.prisma.autopilotRun.findUnique.mockResolvedValue({ id: "run1", status: "RUNNING", postCount: 0, createdAt: new Date("2026-10-09T07:00:00Z") });
    mocks.prisma.post.count.mockResolvedValue(6);
    mocks.prisma.autopilotRun.updateMany.mockResolvedValue({ count: 1 });
    const result = await runAutopilot("biz1", { now });
    expect(result.status).toBe("already_planned");
    expect(mocks.planWeek).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    expect(mocks.prisma.autopilotRun.updateMany).toHaveBeenCalledWith({ where: { id: "run1", status: "RUNNING" }, data: expect.objectContaining({ status: "DONE", postCount: 6 }) });
  });

  it("refunds a reserved credit for every group that did not finish, whatever stopped it", async () => {
    mocks.makeGroupImages.mockRejectedValue(new Error("renderer crashed"));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question"), group("thank-you")]));
    await runAutopilot("biz1", { now });
    expect(mocks.consumeUsage).toHaveBeenCalledTimes(3);
    expect(mocks.refundUsage).toHaveBeenCalledTimes(3);
    expect(mocks.prisma.post.createMany).not.toHaveBeenCalled();
  });

  it("waits without claiming the week while AI is switched off in the admin console", async () => {
    mocks.prisma.business.findUnique.mockResolvedValue(business);
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([{ service: "gemini" }]);
    clearSwitchCache();
    const result = await runAutopilot("biz1", { now });
    expect(result).toMatchObject({ status: "nothing_to_plan", note: expect.stringMatching(/paused for a short while/) });
    expect(mocks.prisma.autopilotRun.create).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    mocks.prisma.serviceSwitch.findMany.mockResolvedValue([]);
    clearSwitchCache();
  });

  it("says why when the plan lacks Autopilot or cannot be checked, without claiming the week", async () => {
    const grant = await import("@/tests/stubs/entitlements");
    mocks.prisma.business.findUnique.mockResolvedValue(business);
    try {
      grant.missing.add("autopilot");
      expect(await runAutopilot("biz1", { now })).toMatchObject({ status: "nothing_to_plan", note: expect.stringMatching(/not part of your plan/) });
      grant.missing.clear();
      grant.state.planUnknown = true;
      expect(await runAutopilot("biz1", { now })).toMatchObject({ status: "nothing_to_plan", note: expect.stringMatching(/could not check your plan/) });
      expect(mocks.prisma.autopilotRun.create).not.toHaveBeenCalled();
      expect(mocks.consumeUsage).not.toHaveBeenCalled();
    } finally {
      grant.missing.clear();
      grant.state.planUnknown = false;
    }
  });

  it("leaves accounts waiting for deletion alone", async () => {
    mocks.prisma.business.findUnique.mockResolvedValue({ ...business, user: { ...business.user, deletionScheduledFor: new Date() } });
    expect((await runAutopilot("biz1", { now })).status).toBe("nothing_to_plan");
    expect(mocks.prisma.autopilotRun.create).not.toHaveBeenCalled();
  });

  it("leaves suspended accounts alone before claiming the week, and skips them in the due list", async () => {
    mocks.prisma.business.findUnique.mockResolvedValue({ ...business, user: { ...business.user, suspendedAt: new Date() } });
    expect((await runAutopilot("biz1", { now })).status).toBe("nothing_to_plan");
    expect(mocks.prisma.autopilotRun.create).not.toHaveBeenCalled();
    expect(mocks.consumeUsage).not.toHaveBeenCalled();
    mocks.prisma.autopilotSettings.findMany.mockResolvedValue([]);
    await runDueBusinesses({ now });
    expect(mocks.prisma.autopilotSettings.findMany.mock.calls.at(-1)![0].where.business).toEqual({ user: { deletionScheduledFor: null, suspendedAt: null } });
  });

  it("stops with a friendly note when credits run out mid-week, keeping what was written", async () => {
    mocks.consumeUsage.mockResolvedValueOnce({ periodStart }).mockRejectedValue(new UsageLimitError("limit_reached", "text"));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question"), group("thank-you"), group("how-we-work")]));
    const result = await runAutopilot("biz1", { now });
    expect(result.status).toBe("planned");
    expect(result.groupCount).toBe(1);
    expect(result.note).toMatch(/ran out of text credits after 1 of 4/);
    expect(created()).toHaveLength(2);
    // Nothing was reserved by the refused attempts, so nothing is refunded.
    expect(mocks.refundUsage).not.toHaveBeenCalled();
    const last = mocks.prisma.autopilotRun.update.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("DONE");
    expect(last.data.error).toMatch(/credits/);
  });

  it("reports no_credits when not a single post could be written", async () => {
    mocks.consumeUsage.mockRejectedValue(new UsageLimitError("limit_reached", "text"));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    const result = await runAutopilot("biz1", { now });
    expect(result).toMatchObject({ status: "no_credits", postCount: 0 });
    expect(result.note).toMatch(/no text credits left/);
    expect(mocks.sendReadyEmail).not.toHaveBeenCalled();
  });

  it("refunds the credit when the AI fails and carries on with the other posts", async () => {
    mocks.writeGroup.mockImplementation(async (_p: unknown, req: { idea: { id: string }; targets: { network: string }[] }) => {
      if (req.idea.id === "poll-question") throw new AIProviderError("bad json", "gemini", true);
      return written(req.targets.map((t) => t.network));
    });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question")]));
    const result = await runAutopilot("biz1", { now });
    expect(mocks.consumeUsage).toHaveBeenCalledTimes(2);
    expect(mocks.refundUsage).toHaveBeenCalledTimes(1);
    expect(mocks.refundUsage).toHaveBeenCalledWith("user1", "text", periodStart);
    expect(result).toMatchObject({ status: "planned", postCount: 2, groupCount: 1 });
    expect(result.note).toMatch(/could not be written/);
  });

  it("refunds when saving the posts fails", async () => {
    mocks.prisma.post.createMany.mockRejectedValue(new Error("db down"));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    await runAutopilot("biz1", { now });
    expect(mocks.refundUsage).toHaveBeenCalledWith("user1", "text", periodStart);
  });

  it("pauses cleanly when the monthly AI budget is reached", async () => {
    mocks.writeGroup.mockRejectedValue(new AIBudgetExceededError("gemini"));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question")]));
    const result = await runAutopilot("biz1", { now });
    expect(result.note).toMatch(/paused/);
    expect(mocks.refundUsage).toHaveBeenCalled();
    expect(created()).toHaveLength(0);
  });

  it("leaves a post that needs a picture as a draft instead of a doomed scheduled post", async () => {
    mocks.makeGroupImages.mockResolvedValue({ designs: {}, aiStopped: false, notes: [], aiUsed: false });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")], { autoPublish: true }));
    await runAutopilot("biz1", { now });
    const posts = created();
    expect(posts.find((p) => p.network === "instagram")).toMatchObject({ status: "DRAFT", lastError: expect.stringMatching(/picture/) });
    expect(posts.find((p) => p.network === "linkedin")).toMatchObject({ status: "SCHEDULED" });
  });

  it("gives scripts and articles no pictures and keeps image notes", async () => {
    mocks.makeGroupImages.mockResolvedValue({ designs: {}, aiStopped: true, notes: ["You ran out of image credits, so the remaining posts use your free templates."], aiUsed: false });
    mocks.planWeek.mockResolvedValue(plan([group("reel-quick-tip", ["tiktok"])]));
    const result = await runAutopilot("biz1", { now });
    const [post] = created();
    expect(post).toMatchObject({ network: "tiktok", format: "SCRIPT", mediaPaths: [], status: "PENDING_APPROVAL" });
    expect(result.note).toMatch(/image credits/);
  });

  it("removes the run and says what to do when there is no account to write for", async () => {
    mocks.planWeek.mockResolvedValue({ groups: [], notes: [], input: { connections: [], config: {} } });
    const result = await runAutopilot("biz1", { now });
    expect(result.status).toBe("nothing_to_plan");
    expect(mocks.prisma.autopilotRun.delete).toHaveBeenCalledWith({ where: { id: "run1" } });
  });

  it("reserves credits one at a time, so the first use of the usage row cannot race", async () => {
    let active = 0;
    let maxActive = 0;
    mocks.consumeUsage.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { periodStart };
    });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question"), group("thank-you"), group("how-we-work")]));
    const result = await runAutopilot("biz1", { now });
    expect(result.groupCount).toBe(4);
    expect(maxActive).toBe(1);
  });

  it("treats an unexpected reservation error as a failed post, not a failed week", async () => {
    mocks.consumeUsage.mockResolvedValueOnce({ periodStart }).mockRejectedValueOnce(new Error("db hiccup")).mockResolvedValue({ periodStart });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to"), group("poll-question"), group("thank-you")]));
    const result = await runAutopilot("biz1", { now });
    expect(result.status).toBe("planned");
    expect(result.groupCount).toBe(2);
    expect(result.note).toMatch(/could not be written/);
  });

  it("keeps the posts already saved, and does not allow a repeat, when the run breaks part-way", async () => {
    mocks.prisma.autopilotRun.update.mockImplementation(async ({ data }: { data: { status?: string } }) => {
      if (data.status === "DONE" && !("error" in data && typeof (data as { error?: unknown }).error === "string")) throw new Error("db down at the end");
      return {};
    });
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    const result = await runAutopilot("biz1", { now });
    expect(created()).toHaveLength(2);
    expect(result).toMatchObject({ status: "planned", postCount: 2 });
    expect(result.note).toMatch(/part-way/);
    expect(mocks.prisma.autopilotRun.update).toHaveBeenLastCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "DONE", postCount: 2 }) });
  });

  it("marks the run FAILED when planning blows up", async () => {
    mocks.planWeek.mockRejectedValue(new Error("boom"));
    const result = await runAutopilot("biz1", { now });
    expect(result.status).toBe("failed");
    expect(mocks.prisma.autopilotRun.update).toHaveBeenCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "FAILED" }) });
  });
});

describe("running for a user (IDOR)", () => {
  it("only ever runs the business the user owns", async () => {
    mocks.prisma.business.findUnique.mockImplementation(async ({ where }: { where: { userId?: string; id?: string } }) => (where.userId === "user1" ? { id: "biz1" } : where.id === "biz1" ? business : null));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    expect((await runAutopilotForUser("user1", { now })).status).toBe("planned");
    expect(mocks.prisma.business.findUnique).toHaveBeenCalledWith({ where: { userId: "user1" }, select: { id: true } });
    expect((await runAutopilotForUser("someone-else", { now })).status).toBe("nothing_to_plan");
    expect(mocks.prisma.autopilotRun.create).toHaveBeenCalledTimes(1);
  });
});

describe("the Friday cron", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const row = (id: string) => ({ businessId: id, business: { timezone: "Africa/Kigali" } });
  // Behaves like the database: ordered by id, after the cursor, one page at a time.
  const paged = (all: string[]) => async ({ where, take }: { where: { businessId?: { gt: string } }; take: number }) =>
    all.filter((id) => !where.businessId || id > where.businessId.gt).slice(0, take).map(row);

  it("waits until it is Friday in the business's own zone", async () => {
    mocks.prisma.autopilotSettings.findMany.mockImplementation(paged(ids.slice(0, 3)));
    const result = await runDueBusinesses({ now: new Date("2026-10-08T12:00:00Z") }); // Thursday
    expect(result).toMatchObject({ checked: 3, planned: 0, skipped: 3, failed: 0, nextCursor: null });
    expect(mocks.prisma.autopilotRun.create).not.toHaveBeenCalled();
  });

  it("skips accounts waiting for deletion in the query", async () => {
    mocks.prisma.autopilotSettings.findMany.mockImplementation(paged([]));
    await runDueBusinesses({ now });
    expect(mocks.prisma.autopilotSettings.findMany.mock.calls[0][0].where).toMatchObject({ enabled: true, business: { user: { deletionScheduledFor: null, suspendedAt: null } } });
  });

  it("plans a couple per call and a cursor reaches business N+1 until everyone was visited", async () => {
    mocks.prisma.autopilotSettings.findMany.mockImplementation(paged(ids));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    const visited: string[] = [];
    mocks.prisma.autopilotRun.create.mockImplementation(async ({ data }: { data: { businessId: string } }) => {
      visited.push(data.businessId);
      return { id: `run-${data.businessId}` };
    });
    let cursor: string | null = null;
    let calls = 0;
    do {
      const result = await runDueBusinesses({ now, limit: 2, cursor });
      expect(result.planned).toBeLessThanOrEqual(2);
      cursor = result.nextCursor;
      calls += 1;
    } while (cursor && calls < 10);
    expect(visited).toEqual(ids);
    expect(calls).toBe(3);
  });

  it("does not let skipped (already planned) businesses use up the limit", async () => {
    mocks.prisma.autopilotSettings.findMany.mockImplementation(paged(ids));
    mocks.planWeek.mockResolvedValue(plan([group("tip-how-to")]));
    mocks.prisma.autopilotRun.create.mockImplementation(async ({ data }: { data: { businessId: string } }) => {
      if (["a", "b", "c"].includes(data.businessId)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" });
      return { id: `run-${data.businessId}` };
    });
    mocks.prisma.autopilotRun.findUnique.mockResolvedValue({ id: "r", status: "DONE", postCount: 3, createdAt: now });
    const result = await runDueBusinesses({ now, limit: 2 });
    expect(result).toMatchObject({ checked: 5, planned: 2, skipped: 3, nextCursor: "e" });
  });
});
