// Which provider and voice speak English voice-overs (docs/VOICE_AND_MUSIC.md, "Voice providers"): the admin's
// choice in Admin -> Settings -> Voices, one AdminSetting row "voice.english" = { provider, voiceId }. A missing row is
// ElevenLabs with JB Pro (the voice before this setting existed), so nothing changes until the owner picks.
import "server-only";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { DEFAULT_VOICE_ID, isVoiceId, providerOfVoice, voicesOf, type VoiceProviderName } from "./voices";

export const ENGLISH_VOICE_KEY = "voice.english";

export type EnglishVoice = { provider: VoiceProviderName; voiceId: string };
export const DEFAULT_ENGLISH_VOICE: EnglishVoice = { provider: "elevenlabs", voiceId: DEFAULT_VOICE_ID };

/** A stored value as a setting; the default for anything else (a voice must belong to its provider). */
export function readEnglishVoice(raw: unknown): EnglishVoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const provider = v.provider === "gemini" ? "gemini" : v.provider === "elevenlabs" ? "elevenlabs" : null;
  if (!provider || !isVoiceId(v.voiceId) || providerOfVoice(v.voiceId) !== provider) return DEFAULT_ENGLISH_VOICE;
  return { provider, voiceId: v.voiceId };
}

/** The admin's choice. Never throws: the default on a database blip. */
export async function getEnglishVoice(): Promise<EnglishVoice> {
  const row = await Promise.resolve()
    .then(() => prisma.adminSetting.findUnique({ where: { key: ENGLISH_VOICE_KEY } }))
    .catch(() => null);
  return readEnglishVoice(row?.value);
}

/**
 * The voice a video speaks with: the video's own or the business's choice when it belongs to the active provider and
 * is not the old default (JB Pro, which every business has until it picks); otherwise the admin's voice.
 */
export function pickVoice(english: EnglishVoice, ...choices: (string | null | undefined)[]): string {
  for (const c of choices) {
    if (!isVoiceId(c) || providerOfVoice(c) !== english.provider) continue;
    if (c === DEFAULT_VOICE_ID && english.voiceId !== DEFAULT_VOICE_ID) continue;
    return c;
  }
  return english.voiceId;
}

/** Admin: set the provider and voice. The voice must be one of that provider's voices. Audited. */
export async function setEnglishVoice(ctx: AdminContext, input: { provider: string; voiceId: string }): Promise<EnglishVoice> {
  const provider = input.provider === "gemini" ? "gemini" : input.provider === "elevenlabs" ? "elevenlabs" : null;
  if (!provider) throw new AdminError("invalid", "Choose ElevenLabs or Gemini.");
  if (!voicesOf(provider).some((v) => v.id === input.voiceId)) throw new AdminError("invalid", "Choose one of that provider's voices.");
  const next: EnglishVoice = { provider, voiceId: input.voiceId };
  await prisma.$transaction(async (tx) => {
    const row = await tx.adminSetting.findUnique({ where: { key: ENGLISH_VOICE_KEY } });
    const value = next as unknown as Prisma.InputJsonValue;
    await tx.adminSetting.upsert({ where: { key: ENGLISH_VOICE_KEY }, create: { key: ENGLISH_VOICE_KEY, value }, update: { value } });
    await writeAudit(tx, ctx, "update_setting", `setting:${ENGLISH_VOICE_KEY}`, readEnglishVoice(row?.value), next);
  });
  return next;
}
