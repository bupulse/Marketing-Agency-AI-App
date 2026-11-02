// Content languages on the server (Posts -> Settings, "Languages"): read for a business, and saved by an Owner or Admin
// with an audit row, inside Business.dailyPostSettings beside the daily posts choices (which keep their own keys).
// The approved voices per language (AdminSetting "voice.kinyarwanda" / "voice.swahili") are read and set here too.
import "server-only";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { can, ForbiddenError, type Role } from "@/lib/team/roles";
import { contentLanguagesSchema, LANGUAGES_KEY, readContentLanguages, storedLanguages, type ContentLanguages, type ContentLanguagesInput } from "./settings";
import { APPROVAL_LANGUAGES, isVoiceIdShape, readApprovedVoice, VOICE_SETTING_KEYS, type ApprovalLanguage } from "./voice";

export class ContentLanguagesError extends Error {}

const SELECT = { country: true, contentLanguage: true, dailyPostSettings: true } as const;

/** The business's choices, or the defaults (Kinyarwanda in Rwanda, else its content language). */
export async function getContentLanguages(businessId: string): Promise<ContentLanguages> {
  const row = await prisma.business.findUnique({ where: { id: businessId }, select: SELECT });
  return readContentLanguages(storedLanguages(row?.dailyPostSettings), { country: row?.country, contentLanguage: row?.contentLanguage });
}

/**
 * Saves the three choices. Only Owners and Admins (`contentSettings`, checked here, not only on the page); the daily
 * posts choices in the same JSON are kept as they are. Applies from the next posts made.
 */
export async function saveContentLanguages(actor: { actorId: string; role: Role; businessId: string }, input: ContentLanguagesInput): Promise<ContentLanguages> {
  if (!can(actor.role, "contentSettings")) throw new ForbiddenError("contentSettings");
  const parsed = contentLanguagesSchema.safeParse(input);
  if (!parsed.success) throw new ContentLanguagesError(parsed.error.issues[0]?.message ?? "Check the languages and try again.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.business.findUnique({ where: { id: actor.businessId }, select: SELECT });
    if (!row) throw new ContentLanguagesError("We could not find your business.");
    const ctx = { country: row.country, contentLanguage: row.contentLanguage };
    const before = readContentLanguages(storedLanguages(row.dailyPostSettings), ctx);
    const next = readContentLanguages(parsed.data, ctx);
    const stored = row.dailyPostSettings && typeof row.dailyPostSettings === "object" && !Array.isArray(row.dailyPostSettings) ? (row.dailyPostSettings as Record<string, unknown>) : {};
    await tx.business.update({ where: { id: actor.businessId }, data: { dailyPostSettings: { ...stored, [LANGUAGES_KEY]: next } as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, { actor: `user:${actor.actorId}`, ip: null, viaApi: false }, "content.languages", `company:${actor.businessId}`, before, next);
    return next;
  });
}

/** The owner's approved voice for each language that needs one (null: none yet). Never throws: none on a blip. */
export async function approvedVoices(): Promise<Record<ApprovalLanguage, string | null>> {
  const rows = await Promise.resolve()
    .then(() => prisma.adminSetting.findMany({ where: { key: { in: Object.values(VOICE_SETTING_KEYS) } } }))
    .catch(() => []);
  return Object.fromEntries(APPROVAL_LANGUAGES.map((l) => [l, readApprovedVoice(rows.find((r) => r.key === VOICE_SETTING_KEYS[l])?.value)])) as Record<ApprovalLanguage, string | null>;
}

/** Admin: approve a voice for a language (an ElevenLabs voice id), or null to go back to no voice-over. Audited. */
export async function setApprovedVoice(ctx: AdminContext, language: ApprovalLanguage, voiceId: string | null): Promise<void> {
  if (voiceId !== null && !isVoiceIdShape(voiceId)) throw new AdminError("invalid", "That is not an ElevenLabs voice id (8 to 40 letters and digits).");
  const key = VOICE_SETTING_KEYS[language];
  await prisma.$transaction(async (tx) => {
    const row = await tx.adminSetting.findUnique({ where: { key } });
    const value = { approvedVoiceId: voiceId } as Prisma.InputJsonValue;
    await tx.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await writeAudit(tx, ctx, "update_setting", `setting:${key}`, { approvedVoiceId: readApprovedVoice(row?.value) }, { approvedVoiceId: voiceId });
  });
}
