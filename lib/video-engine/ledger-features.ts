// The Video Studio's names in the AI cost ledger (AiCall.feature, docs/VIDEO_APP_INTEGRATION.md section 4). Admin → AI
// groups spend by these. Video is metered in video credits (lib/usage.ts "videoCredits"), so these calls do not count
// toward a company's monthly AI allowance (lib/ai/budget.ts); the platform's monthly cap still applies to them.
export const VIDEO_LEDGER_PREFIX = "video-";
export const VIDEO_LEDGER_FEATURES = {
  /** A Motion design, edit or extend (Claude). */
  design: "video-design",
  /** A Premium 3D scene design (Claude). */
  premium: "video-premium",
  /** A Seedance prompt written by Claude. */
  seedancePrompt: "video-seedance-prompt",
  /** A Seedance clip (BytePlus). */
  seedance: "video-seedance",
  /** A voice-over take (ElevenLabs). */
  voice: "video-voice",
  /** A presenter or AI image (Gemini). */
  image: "video-image",
} as const;
export type VideoLedgerFeature = (typeof VIDEO_LEDGER_FEATURES)[keyof typeof VIDEO_LEDGER_FEATURES];
export const isVideoLedgerFeature = (feature: string | null | undefined): boolean => !!feature && feature.startsWith(VIDEO_LEDGER_PREFIX);
