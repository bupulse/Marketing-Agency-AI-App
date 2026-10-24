// The editor's draft, kept in this browser (localStorage) so a reload or a closed tab does not lose an edit. One draft per
// reel ("bp-editor-draft:<reelId>", the example is ":demo"), the 5 newest kept. Every read and write is wrapped: private
// mode or a full disk just means no draft. Stored clip links are stripped of their signature and never trusted: on restore
// every clip link is replaced by one of the fresh links of the reel that was just opened. Pure apart from the storage given.
import type { MotionSpec } from "@/lib/video-engine/spec";

export const DRAFT_PREFIX = "bp-editor-draft:";
export const DRAFTS_KEPT = 5;
export const DRAFT_DELAY_MS = 1000;

export type Draft = { spec: MotionSpec; savedAt: number };
/** The part of window.localStorage that is used (a Map-based stand-in in tests). */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const draftKey = (reelId: string | null | undefined) => `${DRAFT_PREFIX}${reelId || "demo"}`;

/** The browser's storage, or null when it is not there or throws (private mode). */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isSpec = (v: unknown): v is MotionSpec => !!v && typeof v === "object" && Array.isArray((v as MotionSpec).scenes) && (v as MotionSpec).scenes.length > 0 && (v as MotionSpec).version === 1;

export function readDraft(storage: DraftStorage | null, key: string): Draft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Draft>;
    return isSpec(v.spec) && typeof v.savedAt === "number" ? { spec: v.spec, savedAt: v.savedAt } : null;
  } catch {
    return null;
  }
}

export function removeDraft(storage: DraftStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* no draft to remove */
  }
}

/** The spec without the clips' signatures (a signed link carries a token and expires in an hour anyway). */
export function storable(spec: MotionSpec): MotionSpec {
  return { ...spec, scenes: spec.scenes.map((s) => ({ ...s, layers: s.layers.map((l) => (l.kind === "video" ? { ...l, url: pathOf(l.url) } : l)) })) };
}

/** Saves the draft, then keeps only the newest DRAFTS_KEPT. False when it could not be saved. */
export function writeDraft(storage: DraftStorage | null, key: string, spec: MotionSpec, now: number = Date.now()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify({ spec: storable(spec), savedAt: now } satisfies Draft));
    pruneDrafts(storage);
    return true;
  } catch {
    return false;
  }
}

/** Removes all but the newest `keep` drafts. */
export function pruneDrafts(storage: DraftStorage | null, keep = DRAFTS_KEPT): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    const dated = keys.map((k) => ({ k, at: readDraft(storage, k)?.savedAt ?? 0 })).sort((a, b) => b.at - a.at || a.k.localeCompare(b.k));
    for (const { k } of dated.slice(keep)) storage.removeItem(k);
  } catch {
    /* keeping a few extra drafts is harmless */
  }
}

/** A link without its query (the signature), so the same clip has the same text whenever it was signed. */
export function pathOf(url: string): string {
  const i = url.indexOf("?");
  return i < 0 ? url : url.slice(0, i);
}

const clipUrls = (spec: MotionSpec) => [...new Set(spec.scenes.flatMap((s) => s.layers.flatMap((l) => (l.kind === "video" ? [l.url] : []))))];

/**
 * A stored spec with the fresh clip links of the reel that was just opened: each clip is matched by its link without the
 * signature, else by the order the clips first appear in, else the first fresh clip. So no stored link is ever used.
 */
export function freshenUrls(stored: MotionSpec, fresh: MotionSpec): MotionSpec {
  const have = clipUrls(fresh);
  if (!have.length) return stored;
  const byPath = new Map(have.map((u) => [pathOf(u), u]));
  const order = clipUrls(stored);
  const swap = (url: string) => byPath.get(pathOf(url)) ?? have[order.indexOf(url)] ?? have[0];
  return { ...stored, scenes: stored.scenes.map((s) => ({ ...s, layers: s.layers.map((l) => (l.kind === "video" ? { ...l, url: swap(l.url) } : l)) })) };
}

/** Whether two specs are the same edit. */
export const sameSpec = (a: MotionSpec, b: MotionSpec) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function timeAgo(savedAt: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - savedAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
