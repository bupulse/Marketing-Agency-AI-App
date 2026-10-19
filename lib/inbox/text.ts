// Small text helpers shared by the inbox (kept apart so channel and engine modules can import them without cycles).

/** The longest message the inbox stores; longer texts are cut. */
export const MAX_TEXT = 4000;
const PREVIEW = 140;

/** One line of at most 140 characters, for the inbox list. */
export function previewOf(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > PREVIEW ? `${one.slice(0, PREVIEW - 1)}…` : one;
}
