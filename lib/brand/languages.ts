// Languages BuPulse writes content in (Business.contentLanguage). The AI is told the English name.
export const CONTENT_LANGUAGES = [
  "English",
  "French",
  "Kinyarwanda",
  "Swahili",
  "Spanish",
  "Portuguese",
  "Arabic",
  "German",
  "Italian",
  "Dutch",
  "Hindi",
  "Chinese (Simplified)",
  "Japanese",
  "Turkish",
  "Indonesian",
] as const;

export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return CONTENT_LANGUAGES.includes(value as ContentLanguage);
}
