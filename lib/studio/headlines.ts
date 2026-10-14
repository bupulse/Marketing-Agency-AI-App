// Ad headlines (docs/CONTENT.md): BuPulse writes exactly three for every post, each at most MAX_HEADLINE_LENGTH
// characters. Pure and client-safe, so the writers, the screens and the tests agree.
import { MAX_HEADLINE_LENGTH } from "./schemas";
import { truncateSmart } from "./variants";

export const AD_HEADLINE_COUNT = 3;

/** The AI's headlines cleaned: no list marks or quotes, held to the length, no empty ones, no repeats, at most three. */
export function cleanHeadlines(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const text = raw
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:\d+[.)]|[-*•])\s+/, "")
      .replace(/^["“”']+|["“”']+$/g, "")
      .trim();
    const headline = truncateSmart(text, MAX_HEADLINE_LENGTH);
    const key = headline.toLowerCase();
    if (!headline || seen.has(key)) continue;
    seen.add(key);
    out.push(headline);
    if (out.length === AD_HEADLINE_COUNT) break;
  }
  return out;
}

/** Exactly three cleaned headlines, or null when the AI gave fewer usable ones. */
export function exactlyThreeHeadlines(list: readonly string[]): string[] | null {
  const clean = cleanHeadlines(list);
  return clean.length === AD_HEADLINE_COUNT ? clean : null;
}
