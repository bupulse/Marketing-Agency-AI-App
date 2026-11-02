"use server";

import { adminAction, finish } from "@/lib/admin/console";
import { AdminError } from "@/lib/admin/types";
import { setApprovedVoice } from "@/lib/content-languages/service";
import { APPROVAL_LANGUAGES, type ApprovalLanguage } from "@/lib/content-languages/voice";

// Admin -> Settings, "Voices for Kinyarwanda and Swahili" (lib/content-languages/voice.ts): the voice the owner approved
// for a language's daily videos, or none (music and subtitles only). Audited.

const BACK = "/admin/settings#language-voices";

function languageOf(f: FormData): ApprovalLanguage {
  const language = String(f.get("language") ?? "");
  if (!(APPROVAL_LANGUAGES as readonly string[]).includes(language)) throw new AdminError("invalid", "Choose Kinyarwanda or Swahili.");
  return language as ApprovalLanguage;
}

/** Saves the approved voice id; an empty field means none (no voice-over for that language). */
export async function saveLanguageVoiceAction(f: FormData) {
  const ctx = await adminAction("system");
  const voiceId = String(f.get("voiceId") ?? "").trim() || null;
  await finish(BACK, (language: ApprovalLanguage) => (voiceId ? `${language} videos now speak with voice ${voiceId}.` : `${language} videos have no voice-over (music and subtitles).`), async () => {
    const language = languageOf(f);
    await setApprovedVoice(ctx, language, voiceId);
    return language;
  });
}
