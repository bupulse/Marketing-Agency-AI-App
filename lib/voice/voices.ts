// The voices a business can choose for its video voiceovers (Content -> Settings; docs/VOICE_AND_MUSIC.md). Client-safe.
// JB Pro is the owner's choice and the default. The others are ElevenLabs voices to start with; replace or add voices
// from the ElevenLabs Voice Library (African English accents) by adding their ids here; the settings page plays each
// voice's own preview so the owner can check them.
export interface VoiceOption {
  id: string;
  name: string;
  gender: "male" | "female";
  description: string;
}

export const DEFAULT_VOICE_ID = "NZ8KtusXpnktPYja5Qko";

export const VOICES: readonly VoiceOption[] = [
  { id: DEFAULT_VOICE_ID, name: "JB Pro", gender: "male", description: "Warm, confident, clear (default)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female", description: "Soft, friendly, natural" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", description: "Calm, clear narration" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male", description: "Deep, steady narration" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "male", description: "Young, upbeat" },
];

export function isVoiceId(value: unknown): value is string {
  return typeof value === "string" && VOICES.some((v) => v.id === value);
}

export function voiceName(id: string | null | undefined): string {
  return VOICES.find((v) => v.id === id)?.name ?? "JB Pro";
}
