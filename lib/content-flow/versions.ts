// Post versions and "Generate again" (docs/CONTENT.md, "Caption, script and headlines"): what a version holds, how two
// compare, which parts of a post can be written again and how a version reads on screen. Pure and client-safe; the
// database side is lib/content-flow/post-versions.ts, the writing lib/content-flow/post-writing.ts.
import { readContest } from "@/lib/content-flow/contest";
import { EDITABLE } from "@/lib/publishing/status";

export const VERSION_KINDS = ["original", "edit", "regenerate", "restore"] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

/** What "Generate again" can write: the whole post, or one of its pieces. */
export const REWRITE_PARTS = ["post", "caption", "script", "headlines"] as const;
export type RewritePart = (typeof REWRITE_PARTS)[number];

/** The longest video script the owner may write by hand (as when editing content, lib/studio/schemas.ts). */
export const MAX_EDITED_SCRIPT = 8000;

/** Versions kept per post: the newest ones. */
export const MAX_POST_VERSIONS = 50;

/** A post's words: its own title, text and hashtags, with its content's video script and ad headlines. */
export type PostPieces = { title: string | null; text: string; hashtags: string[]; videoScript: string; adHeadlines: string[] };

/** The language each piece is written in. "Generate again" writes in the Brand's language of the day, so they can differ. */
export type PartLanguages = { caption: string; script: string; headlines: string };

export const allIn = (language: string): PartLanguages => ({ caption: language, script: language, headlines: language });

/** A version's stored languages (PostVersion.languages), each piece missing from it in `fallback`. */
export function readLanguages(value: unknown, fallback: string): PartLanguages {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof PartLanguages) => {
    const v = stored[key];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : fallback;
  };
  return { caption: pick("caption"), script: pick("script"), headlines: pick("headlines") };
}

/**
 * The languages of the words a post has now: its newest version's when that version holds them (the words were not
 * changed outside the versions since), else the language its content was written in.
 */
export function currentLanguages(latest: (PostPieces & { languages?: unknown }) | null | undefined, current: PostPieces, fallback: string): PartLanguages {
  return latest && samePieces(latest, current) ? readLanguages(latest.languages, fallback) : allIn(fallback);
}

/** The languages after "Generate again" wrote `part` in `language`. A script post's caption is its script. */
export function languagesAfter(before: PartLanguages, part: RewritePart, language: string, scriptPost = false): PartLanguages {
  if (part === "post") return allIn(language);
  if (part === "caption") return { ...before, caption: language };
  if (part === "script") return { ...before, script: language, ...(scriptPost ? { caption: language } : {}) };
  return { ...before, headlines: language };
}

/** The one language every piece is in, or null when they differ. */
export function sameLanguage(languages: PartLanguages): string | null {
  return languages.caption === languages.script && languages.script === languages.headlines ? languages.caption : null;
}

export function isRewritePart(value: unknown): value is RewritePart {
  return typeof value === "string" && (REWRITE_PARTS as readonly string[]).includes(value);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function samePieces(a: PostPieces, b: PostPieces): boolean {
  return (a.title ?? null) === (b.title ?? null) && a.text === b.text && sameList(a.hashtags, b.hashtags) && a.videoScript === b.videoScript && sameList(a.adHeadlines, b.adHeadlines);
}

/** The pieces of a post and its content (none for a post BuPulse did not write). */
export function piecesOf(post: { title: string | null; text: string; hashtags: string[] }, content: { videoScript: string; adHeadlines: string[] } | null): PostPieces {
  return { title: post.title, text: post.text, hashtags: post.hashtags, videoScript: content?.videoScript ?? "", adHeadlines: content?.adHeadlines ?? [] };
}

/** A TikTok or YouTube reminder whose text is the video script itself (no video of the owner's): its "caption" is the script. */
export function isScriptPost(post: { format: string; text: string }, content: { videoScript: string } | null): boolean {
  const script = content?.videoScript.trim() ?? "";
  return post.format === "SCRIPT" && script !== "" && post.text.trim() === script;
}

/**
 * What "Generate again" may write for a post: only for a post BuPulse wrote (it has content) that has not gone out.
 * A contest keeps its caption (its prize and rules are the owner's); a script post's caption is its script.
 */
export function rewriteParts(post: { status: string; format: string; text: string; contest?: unknown }, content: { videoScript: string } | null): RewritePart[] {
  if (!content || !(EDITABLE as readonly string[]).includes(post.status)) return [];
  const contest = readContest(post.contest) !== null;
  return [...(contest ? [] : (["post"] as const)), ...(contest || isScriptPost(post, content) ? [] : (["caption"] as const)), "script", "headlines"];
}

const PART_NAME: Record<RewritePart, string> = { post: "post", caption: "caption", script: "video script", headlines: "ad headlines" };

/** How a version is named in the list: "First version", "Edited", "New caption", "Restored version 2". */
export function versionLabel(version: { kind: string; part?: string | null }, restoredNumber?: number | null): string {
  if (version.kind === "original") return "First version";
  if (version.kind === "edit") return "Edited";
  if (version.kind === "restore") return restoredNumber ? `Restored version ${restoredNumber}` : "Restored";
  return !version.part || version.part === "post" || !isRewritePart(version.part) ? "Generated again" : `New ${PART_NAME[version.part]}`;
}

/** The pieces a version changed from the one before it (none for the first). */
export function changedPieces(version: PostPieces, before: PostPieces | null): ("caption" | "script" | "headlines")[] {
  if (!before) return [];
  return [
    ...((version.title ?? null) !== (before.title ?? null) || version.text !== before.text || !sameList(version.hashtags, before.hashtags) ? (["caption"] as const) : []),
    ...(version.videoScript !== before.videoScript ? (["script"] as const) : []),
    ...(!sameList(version.adHeadlines, before.adHeadlines) ? (["headlines"] as const) : []),
  ];
}

/** A version's preview in the list: what it changed (its new headlines or script), else its text; blank lines folded. */
export function versionPreview(version: PostPieces, before: PostPieces | null): string {
  const changed = changedPieces(version, before);
  const text = changed.length === 0 || changed.includes("caption") ? version.text : changed.includes("script") ? version.videoScript : version.adHeadlines.join(" · ");
  return text.replace(/\n\s*\n+/g, "\n").trim();
}

/** Show what is left of the month's text generations when it is 5 or fewer, or a tenth of the plan or less. */
export function textNearLimit(left: number, limit: number): boolean {
  return left <= Math.max(5, Math.ceil(limit * 0.1));
}

/** "Just now", "12 min ago", "3 h ago"; null after a day (the screen shows the date and time). */
export function timeAgo(iso: string, now: Date): string | null {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return null;
}
