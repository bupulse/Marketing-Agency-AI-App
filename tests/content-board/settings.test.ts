import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const tx = { business: { findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } };
  return { tx, business: { findUnique: vi.fn() }, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
});
vi.mock("@/lib/db", () => ({ prisma }));

import { autoApps, contentSettingsSchema, DEFAULT_CONTENT_SETTINGS, readContentSettings, requiresApproval } from "@/lib/content-board/settings";
import { ContentSettingsError, saveContentSettings } from "@/lib/content-board/settings-service";
import { ForbiddenError } from "@/lib/team/roles";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.tx.business.findUnique.mockResolvedValue({ contentSettings: null });
});

describe("content settings", () => {
  it("require approval for every app by default", () => {
    expect(readContentSettings(null)).toEqual(DEFAULT_CONTENT_SETTINGS);
    expect(Object.values(DEFAULT_CONTENT_SETTINGS.requireApproval).every(Boolean)).toBe(true);
  });

  it("read stored choices and fill the rest with approval", () => {
    const s = readContentSettings({ requireApproval: { instagram: false } });
    expect(requiresApproval(s, "instagram")).toBe(false);
    expect(requiresApproval(s, "facebook")).toBe(true);
    expect(requiresApproval(s, "myspace")).toBe(true);
    expect(autoApps(s)).toEqual(["instagram"]);
  });

  it("treat anything unreadable as approval required", () => {
    expect(readContentSettings({ requireApproval: { instagram: "no" } })).toEqual(DEFAULT_CONTENT_SETTINGS);
    expect(readContentSettings("garbage")).toEqual(DEFAULT_CONTENT_SETTINGS);
  });

  it("validate input strictly", () => {
    expect(contentSettingsSchema.safeParse({ requireApproval: { tiktok: false } }).success).toBe(true);
    expect(contentSettingsSchema.safeParse({ requireApproval: { myspace: false } }).success).toBe(false);
    expect(contentSettingsSchema.safeParse({ requireApproval: { tiktok: false }, extra: 1 }).success).toBe(false);
  });
});

describe("saveContentSettings", () => {
  const admin = { actorId: "person-1", role: "ADMIN" as const, businessId: "b1" };

  it("lets an Owner or Admin save, and writes an audit row with what changed", async () => {
    const saved = await saveContentSettings(admin, { requireApproval: { facebook: false } });
    expect(requiresApproval(saved, "facebook")).toBe(false);
    expect(prisma.tx.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { contentSettings: saved } });
    const audit = prisma.tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actor: "user:person-1", action: "content.settings", target: "company:b1", before: { autoApps: [] }, after: { autoApps: ["facebook"] } });
    await saveContentSettings({ ...admin, role: "OWNER" }, { requireApproval: {} });
    expect(prisma.tx.business.update).toHaveBeenCalledTimes(2);
  });

  it("refuses a Member, before touching anything", async () => {
    await expect(saveContentSettings({ ...admin, role: "MEMBER" }, { requireApproval: { facebook: false } })).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses invalid input", async () => {
    await expect(saveContentSettings(admin, { requireApproval: { facebook: "off" } } as never)).rejects.toBeInstanceOf(ContentSettingsError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("pack size (docs/CONTENT_PACKS.md)", () => {
  it("5 posts by default; the owner may choose 3 to 7", async () => {
    const { PACK_SIZE } = await import("@/lib/content-board/settings");
    expect(readContentSettings(null).packSize).toBe(5);
    expect(readContentSettings({ requireApproval: {}, packSize: 7 }).packSize).toBe(7);
    expect(contentSettingsSchema.safeParse({ requireApproval: {}, packSize: 2 }).success).toBe(false);
    expect(contentSettingsSchema.safeParse({ requireApproval: {}, packSize: 8 }).success).toBe(false);
    expect(readContentSettings({ requireApproval: { instagram: false }, packSize: 99 })).toEqual({ ...DEFAULT_CONTENT_SETTINGS });
    expect(PACK_SIZE).toEqual({ min: 3, max: 7, default: 5 });
  });
});
