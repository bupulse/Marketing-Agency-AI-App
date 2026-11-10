// Pure display helpers for the Chats and Live visitors screens: flags, message runs, and what changed in the inbox
// since the last load (so new chats rise in and updated ones flash). No React, so the tests read them directly.

/** "RW" → 🇷🇼 (two regional-indicator letters). Anything that is not a two-letter code gives a globe. */
export function flagEmoji(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🌍";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null | undefined;

/** "RW" → "Rwanda". Unknown codes and full names come back as they are. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim();
  if (!/^[A-Za-z]{2}$/.test(c)) return c || null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(c.toUpperCase()) ?? c.toUpperCase();
  } catch {
    return c.toUpperCase();
  }
}

/** "Kigali, Rwanda", "Rwanda", or null. */
export const placeLabel = (city: string | null | undefined, country: string | null | undefined) => [city, countryName(country)].filter(Boolean).join(", ") || null;

type RunMessage = { author: string; kind: string; createdAt: string };
const RUN_GAP_MS = 5 * 60_000;

/** Which side and look a message has, for grouping: an internal note never joins a reply run. */
const lane = (m: RunMessage) => (m.kind === "EVENT" || m.author === "SYSTEM" ? "event" : m.kind === "NOTE" ? "note" : m.author);

/**
 * Messages from the same author, a few minutes apart, form a run: the name shows on the first of the run, the time
 * on the last, and the gap between them is tighter.
 */
export function messageRuns(messages: RunMessage[]): { first: boolean; last: boolean }[] {
  const joins = (a: RunMessage | undefined, b: RunMessage | undefined) =>
    !!a && !!b && lane(a) !== "event" && lane(a) === lane(b) && Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) <= RUN_GAP_MS;
  return messages.map((m, i) => ({ first: !joins(messages[i - 1], m), last: !joins(m, messages[i + 1]) }));
}

export type ListMemory = ReadonlyMap<string, string>;

/**
 * Compares a freshly loaded chat list with the one before: chats that were not there are `fresh` (they rise in), chats
 * with a newer last message are `bumped` (they flash). The first load of a list (no memory) marks nothing.
 */
export function diffList(prev: ListMemory | null, items: { id: string; lastMessageAt: string }[]): { memory: ListMemory; fresh: ReadonlySet<string>; bumped: ReadonlySet<string> } {
  const memory = new Map(items.map((c) => [c.id, c.lastMessageAt]));
  const fresh = new Set<string>();
  const bumped = new Set<string>();
  if (prev) {
    for (const c of items) {
      const before = prev.get(c.id);
      if (before === undefined) fresh.add(c.id);
      else if (before !== c.lastMessageAt) bumped.add(c.id);
    }
  }
  return { memory, fresh, bumped };
}

const AVATAR_TONES = [
  "bg-[#e6edff] text-[#1f55d6] dark:bg-[#2f6bff]/25 dark:text-[#b9ccff]",
  "bg-[#f1e4ff] text-[#5b3fd9] dark:bg-[#7b5cff]/25 dark:text-[#d6ccff]",
  "bg-[#ddf5ea] text-[#0f7a4a] dark:bg-[#5fd9a0]/20 dark:text-[#a5ecc9]",
  "bg-[#ffe9dc] text-[#a2450f] dark:bg-[#ff9a5c]/20 dark:text-[#ffc7a3]",
  "bg-[#ffe3ea] text-[#b0213f] dark:bg-[#ff7a8f]/20 dark:text-[#ffb8c4]",
];

/** A steady colour per person, so the same visitor always has the same avatar. */
export function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
