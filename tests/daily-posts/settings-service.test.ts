import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const tx = { business: { findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } };
  return { tx, business: { findUnique: vi.fn() }, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
});
const usage = vi.hoisted(() => ({ getUsageSummary: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/usage", () => usage);

import { DailySettingsError, getDailySettings, saveDailySettings } from "@/lib/daily-posts/settings-service";
import { DEFAULT_DAILY_SETTINGS } from "@/lib/daily-posts/settings";
import { ForbiddenError } from "@/lib/team/roles";

const admin = { actorId: "person-1", role: "ADMIN" as const, businessId: "b1", ownerId: "owner-1" };
const input = { enabled: true, perApp: 2, apps: ["facebook" as const], design: "ai" as const };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.tx.business.findUnique.mockResolvedValue({ dailyPostSettings: null });
  usage.getUsageSummary.mockResolvedValue({ limits: { postsPerAppPerDay: 3 } });
});

describe("daily posts settings on the server", () => {
  it("reads the defaults when nothing is saved", async () => {
    prisma.business.findUnique.mockResolvedValue({ dailyPostSettings: null });
    expect(await getDailySettings("b1")).toEqual(DEFAULT_DAILY_SETTINGS);
  });

  it("lets an Owner or Admin save, with an audit row of before and after", async () => {
    const saved = await saveDailySettings(admin, input);
    expect(saved).toEqual(input);
    expect(prisma.tx.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { dailyPostSettings: input } });
    expect(prisma.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actor: "user:person-1", action: "content.daily_posts", target: "company:b1", before: DEFAULT_DAILY_SETTINGS, after: input });
  });

  it("refuses a Member, more posts per app than the plan allows, and bad input, before writing", async () => {
    await expect(saveDailySettings({ ...admin, role: "MEMBER" }, input)).rejects.toBeInstanceOf(ForbiddenError);
    usage.getUsageSummary.mockResolvedValueOnce({ limits: { postsPerAppPerDay: 1 } });
    await expect(saveDailySettings(admin, input)).rejects.toThrow("Your plan allows 1 post per app a day.");
    await expect(saveDailySettings(admin, { ...input, apps: [] })).rejects.toBeInstanceOf(DailySettingsError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps a plan's apps a day (Starter: one app) and saves within it", async () => {
    usage.getUsageSummary.mockResolvedValue({ limits: { postsPerAppPerDay: 1, dailyPostApps: 1 } });
    await expect(saveDailySettings(admin, { ...input, perApp: 1, apps: ["facebook", "instagram"] })).rejects.toThrow("Your plan makes daily posts for 1 app a day. Choose one app.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect((await saveDailySettings(admin, { ...input, perApp: 1, apps: ["instagram"] })).apps).toEqual(["instagram"]);
    usage.getUsageSummary.mockResolvedValue({ limits: { postsPerAppPerDay: 1, dailyPostApps: 0 } });
    expect((await saveDailySettings(admin, { ...input, perApp: 1, apps: ["facebook", "instagram"] })).apps).toEqual(["instagram", "facebook"]);
  });
});
