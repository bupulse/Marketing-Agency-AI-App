// Music credit lines on posts (owner, 11 November 2026). BuPulse's library holds Creative Commons tracks (Incompetech,
// CC BY 4.0; a few from the Free Music Archive, CC BY 3.0) whose licence asks for an easy-to-find credit. A post that
// carries a reel with such a track gets the credit as the last line of its caption, e.g.
//   "Music: Allada, Kevin MacLeod (incompetech.com), CC BY 4.0"
// Original music BuPulse owns (ElevenLabs Music), the Pixabay Content License and CC0 / public domain need none.
// The line is written when the reel is put on the post (lib/visuals/service.ts attachVisuals), so a music swap
// (changeVideoMusic -> the reel made again) replaces it, and it is never added twice. The caption's body is shortened
// to fit the app's length limit; the credit never is. Pure, unit tested.
import { isOwnedLicence } from "./tracks";

/** Whether a track's licence asks for a credit line. */
export function licenceNeedsCredit(licence: string | null | undefined): boolean {
  const l = (licence ?? "").trim();
  if (!l || isOwnedLicence(l)) return false;
  return !/\b(pixabay|cc0|cc[\s-]?zero|creative commons zero|public domain)\b/i.test(l);
}

/** The credit as a caption line: "Music: ..." (a line that already starts with "Music" is kept as it is). */
export function creditLine(attribution: string | null | undefined): string {
  const t = (attribution ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return /^music\b/i.test(t) ? t : `Music: ${t}`;
}

/** The credit line a library track needs on a post, or null. Without a written attribution: its title and source. */
export function trackCredit(track: { licence: string; attribution?: string | null; title?: string | null; sourceUrl?: string | null }): string | null {
  if (!licenceNeedsCredit(track.licence)) return null;
  const written = creditLine(track.attribution);
  if (written) return written;
  const fallback = [track.title, track.sourceUrl ? `(${track.sourceUrl})` : null, track.licence].filter(Boolean).join(", ");
  return creditLine(fallback) || null;
}

/** The caption without a music credit at its end (the lines starting with "Music:" after the body). */
export function stripMusicCredit(text: string): string {
  const lines = text.split(/\r?\n/);
  let end = lines.length;
  while (end > 0 && /^\s*music\s*:/i.test(lines[end - 1])) end--;
  if (end === lines.length) return text;
  while (end > 0 && !lines[end - 1].trim()) end--;
  return lines.slice(0, end).join("\n");
}

/** The body shortened to `max` characters, at a word when it can, with an ellipsis. */
function shorten(body: string, max: number): string {
  if (body.length <= max) return body;
  if (max <= 1) return "";
  const cut = body.slice(0, max - 1);
  const word = cut.replace(/\s+\S*$/, "");
  return `${(word.length >= max * 0.6 ? word : cut).trimEnd()}…`;
}

/**
 * The caption with the reel's credit as its last line (a blank line before it), replacing an earlier credit, or with
 * the credit taken off when the new music needs none. Within `maxText` (the app's caption limit): the body is shortened,
 * never the credit. A caption that already ends with exactly this credit is left as it is.
 */
export function withCredit(text: string, credit: string | null | undefined, maxText = Number.POSITIVE_INFINITY): string {
  const line = credit?.trim() ?? "";
  if (typeof text !== "string") return line || text;
  const lines = text.split(/\r?\n/);
  if (line && lines[lines.length - 1]?.trim() === line && text.length <= maxText) return text;
  const body = stripMusicCredit(text).trimEnd();
  if (!line) return body.length === text.trimEnd().length ? text : body;
  const suffix = body ? `\n\n${line}` : line;
  return `${shorten(body, Math.max(0, maxText - suffix.length))}${suffix}`;
}
