// Which voice speaks a daily video in its language (owner decision, 2 November 2026): the voice model cannot speak
// Kinyarwanda or Swahili well, so until the owner approves a voice for one of them (Admin -> Settings, AdminSetting
// "voice.kinyarwanda" / "voice.swahili" = { approvedVoiceId }), a video in that language has no voice-over: music,
// subtitles and caption in that language. Pure and client-safe, shared by the voiceover (lib/voice/service.ts), the
// settings form's note and the tests.
import type { ContentLanguage } from "@/lib/brand/languages";

/** The languages that need the owner's approved voice before a video speaks them. */
export const APPROVAL_LANGUAGES = ["Kinyarwanda", "Swahili"] as const satisfies readonly ContentLanguage[];
export type ApprovalLanguage = (typeof APPROVAL_LANGUAGES)[number];

/** The AdminSetting that holds a language's approved voice. */
export const VOICE_SETTING_KEYS: Record<ApprovalLanguage, string> = { Kinyarwanda: "voice.kinyarwanda", Swahili: "voice.swahili" };

export function needsApprovedVoice(language: string | null | undefined): language is ApprovalLanguage {
  return (APPROVAL_LANGUAGES as readonly string[]).includes(language ?? "");
}

/** An ElevenLabs voice id, as the voice service takes it. */
export const isVoiceIdShape = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9]{8,40}$/.test(value);

/** The stored AdminSetting value as an approved voice id, or null. */
export function readApprovedVoice(value: unknown): string | null {
  const id = value && typeof value === "object" ? (value as { approvedVoiceId?: unknown }).approvedVoiceId : null;
  return isVoiceIdShape(id) ? id : null;
}

export type LanguageVoice =
  /** The company's own voice (Content -> Settings) speaks it. */
  | { speak: "own" }
  /** The owner's approved voice for this language speaks it. */
  | { speak: "approved"; voiceId: string }
  /** No voice-over: music and subtitles only, with the reason shown on the video. */
  | { speak: "none"; note: string };

/** What the client is told about a language that has no voice yet (settings form and the video). */
export function noVoiceNote(language: string): string {
  return `BuPulse has no ${language} voice yet, so ${language} videos have music with ${language} subtitles and caption, and no voice-over.`;
}

/**
 * How a video in `language` is voiced. Unknown or missing language: the company's voice, as before. Pure.
 * `approved` is the approved voice id per language (from the AdminSettings).
 */
export function languageVoice(language: string | null | undefined, approved: Partial<Record<ApprovalLanguage, string | null>>): LanguageVoice {
  if (needsApprovedVoice(language)) {
    const id = approved[language];
    return id ? { speak: "approved", voiceId: id } : { speak: "none", note: noVoiceNote(language) };
  }
  return { speak: "own" };
}
