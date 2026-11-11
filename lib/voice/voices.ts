// The voices for video voiceovers (docs/VOICE_AND_MUSIC.md). Client-safe.
// Two providers (lib/ai/tts.ts): ElevenLabs voices (ids from the ElevenLabs Voice Library) and Gemini text-to-speech's
// prebuilt voices (ids "gemini:<Name>"). Which provider and voice speak English voice-overs by default is the admin's
// choice (Admin -> Settings -> Voices, lib/voice/provider-setting.ts); JB Pro (ElevenLabs) stays the default until the
// owner picks another. A business may still choose another voice of the active provider (Content -> Settings).
// Kinyarwanda and Swahili are never spoken by these voices (lib/content-languages/voice.ts: only an approved voice).
export type VoiceProviderName = "elevenlabs" | "gemini";

export interface VoiceOption {
  id: string;
  name: string;
  gender: "male" | "female";
  description: string;
  provider?: VoiceProviderName;
}

export const DEFAULT_VOICE_ID = "NZ8KtusXpnktPYja5Qko";

/** ElevenLabs voices (the business voice picker's list while ElevenLabs is the provider). */
export const VOICES: readonly VoiceOption[] = [
  { id: DEFAULT_VOICE_ID, name: "JB Pro", gender: "male", description: "Warm, confident, clear (default)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female", description: "Soft, friendly, natural" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", description: "Calm, clear narration" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male", description: "Deep, steady narration" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "male", description: "Young, upbeat" },
  // Candidates for the new voice actor (owner, 11 November 2026): African-accent voices and a social media voice.
  { id: "4SFJvuIUvxaPLgk8FoK3", name: "Alimata", gender: "female", description: "African accent, professional, welcoming" },
  { id: "kRnE5e47lbU8Zg2MPQPm", name: "Moussa", gender: "male", description: "African accent, warm, resonant" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male", description: "Energetic social media creator" },
];

/**
 * Gemini text-to-speech prebuilt voices (aistudio.google.com/docs/speech-generation, 11 November 2026): the ones that
 * suit short adverts. Google's own one-word descriptions; the gender is how they sound.
 */
export const GEMINI_VOICES: readonly VoiceOption[] = [
  { id: "gemini:Sulafat", name: "Sulafat", gender: "female", description: "Warm", provider: "gemini" },
  { id: "gemini:Achird", name: "Achird", gender: "male", description: "Friendly", provider: "gemini" },
  { id: "gemini:Sadachbia", name: "Sadachbia", gender: "male", description: "Lively", provider: "gemini" },
  { id: "gemini:Puck", name: "Puck", gender: "male", description: "Upbeat", provider: "gemini" },
  { id: "gemini:Kore", name: "Kore", gender: "female", description: "Firm", provider: "gemini" },
  { id: "gemini:Aoede", name: "Aoede", gender: "female", description: "Breezy", provider: "gemini" },
  { id: "gemini:Laomedeia", name: "Laomedeia", gender: "female", description: "Upbeat", provider: "gemini" },
  { id: "gemini:Charon", name: "Charon", gender: "male", description: "Informative", provider: "gemini" },
  { id: "gemini:Iapetus", name: "Iapetus", gender: "male", description: "Clear", provider: "gemini" },
  { id: "gemini:Gacrux", name: "Gacrux", gender: "female", description: "Mature", provider: "gemini" },
  { id: "gemini:Algieba", name: "Algieba", gender: "male", description: "Smooth", provider: "gemini" },
  { id: "gemini:Vindemiatrix", name: "Vindemiatrix", gender: "female", description: "Gentle", provider: "gemini" },
];

export const ALL_VOICES: readonly VoiceOption[] = [...VOICES, ...GEMINI_VOICES];

/** Which provider speaks a voice id (Gemini ids start with "gemini:"). */
export function providerOfVoice(id: string): VoiceProviderName {
  return id.startsWith("gemini:") ? "gemini" : "elevenlabs";
}

/** The provider's own voice name: "Kore" for "gemini:Kore", the ElevenLabs id as it is. */
export function providerVoiceName(id: string): string {
  return id.startsWith("gemini:") ? id.slice("gemini:".length) : id;
}

export function voicesOf(provider: VoiceProviderName): readonly VoiceOption[] {
  return provider === "gemini" ? GEMINI_VOICES : VOICES;
}

export function isVoiceId(value: unknown): value is string {
  return typeof value === "string" && ALL_VOICES.some((v) => v.id === value);
}

export function voiceName(id: string | null | undefined): string {
  return ALL_VOICES.find((v) => v.id === id)?.name ?? "JB Pro";
}
