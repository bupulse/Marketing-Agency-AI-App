import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const tx = { business: { findUnique: vi.fn(), update: vi.fn() }, adminSetting: { findUnique: vi.fn(), upsert: vi.fn() }, auditLog: { create: vi.fn() } };
  return { tx, business: { findUnique: vi.fn() }, adminSetting: { findMany: vi.fn() }, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
});
vi.mock("@/lib/db", () => ({ prisma }));

import { approvedVoices, ContentLanguagesError, getContentLanguages, saveContentLanguages, setApprovedVoice } from "@/lib/content-languages/service";
import { AdminError } from "@/lib/admin/types";
import type { ContentLanguage } from "@/lib/brand/languages";
import type { ContentLanguages, LanguageChoice } from "@/lib/content-languages/settings";
import { ForbiddenError } from "@/lib/team/roles";

const admin = { actorId: "person-1", role: "ADMIN" as const, businessId: "b1" };
const one = (language: ContentLanguage): LanguageChoice => ({ mode: "one", language });
const input: ContentLanguages = { images: { mode: "mix", languages: ["English", "Kinyarwanda"] }, videos: one("Kinyarwanda"), skits: one("English") };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.tx.business.findUnique.mockResolvedValue({ country: "Rwanda", contentLanguage: "English", dailyPostSettings: { enabled: true, perApp: 2 } });
  prisma.adminSetting.findMany.mockResolvedValue([]);
});

describe("content languages on the server", () => {
  it("read the defaults for a business that never saved them: Kinyarwanda in Rwanda", async () => {
    prisma.business.findUnique.mockResolvedValue({ country: "Rwanda", contentLanguage: "English", dailyPostSettings: null });
    expect(await getContentLanguages("b1")).toEqual({ images: one("Kinyarwanda"), videos: one("Kinyarwanda"), skits: one("Kinyarwanda") });
    prisma.business.findUnique.mockResolvedValue({ country: "Kenya", contentLanguage: "Swahili", dailyPostSettings: { enabled: true } });
    expect((await getContentLanguages("b1")).images).toEqual(one("Swahili"));
  });

  it("an Owner or Admin saves them beside the daily posts choices, audited", async () => {
    const saved = await saveContentLanguages(admin, input);
    expect(saved).toEqual(input);
    expect(prisma.tx.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { dailyPostSettings: { enabled: true, perApp: 2, languages: input } } });
    expect(prisma.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actor: "user:person-1", action: "content.languages", target: "company:b1", after: input });
  });

  it("refuse a Member and a broken mix before writing", async () => {
    await expect(saveContentLanguages({ ...admin, role: "MEMBER" }, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveContentLanguages(admin, { ...input, images: { mode: "mix", languages: ["English"] } })).rejects.toBeInstanceOf(ContentLanguagesError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("approved voices: none by default, read from the AdminSettings, and none on a database blip", async () => {
    expect(await approvedVoices()).toEqual({ Kinyarwanda: null, Swahili: null });
    prisma.adminSetting.findMany.mockResolvedValue([{ key: "voice.kinyarwanda", value: { approvedVoiceId: "RwandaVoice123" } }]);
    expect(await approvedVoices()).toEqual({ Kinyarwanda: "RwandaVoice123", Swahili: null });
    prisma.adminSetting.findMany.mockRejectedValue(new Error("down"));
    expect(await approvedVoices()).toEqual({ Kinyarwanda: null, Swahili: null });
  });

  it("the admin approves a voice (audited) and refuses an id that is not one", async () => {
    prisma.tx.adminSetting.findUnique.mockResolvedValue(null);
    await setApprovedVoice({ actor: "admin", ip: null, viaApi: false }, "Kinyarwanda", "RwandaVoice123");
    expect(prisma.tx.adminSetting.upsert).toHaveBeenCalledWith({ where: { key: "voice.kinyarwanda" }, create: { key: "voice.kinyarwanda", value: { approvedVoiceId: "RwandaVoice123" } }, update: { value: { approvedVoiceId: "RwandaVoice123" } } });
    expect(prisma.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "update_setting", target: "setting:voice.kinyarwanda", before: { approvedVoiceId: null }, after: { approvedVoiceId: "RwandaVoice123" } });
    await expect(setApprovedVoice({ actor: "admin", ip: null, viaApi: false }, "Swahili", "no spaces!")).rejects.toBeInstanceOf(AdminError);
  });
});
