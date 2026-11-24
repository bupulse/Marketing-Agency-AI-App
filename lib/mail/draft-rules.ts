// Drafts and attachments in the B Mail composer (docs/mail-crm/GAPS.md section C): what the composer opens with, what
// a saved draft keeps, when a draft is empty enough to drop, and how big attachments may be. Pure: the composer, the
// server and the tests share it.

import type { ReplyMode } from "./compose-rules";

export type ComposeMode = "new" | ReplyMode;

/** The earlier message under a reply or forward, shown behind ···: a header line(s) and the text. */
export type QuotePreview = { head: string; body: string };
export type ReplyOption = { to: string[]; cc: string[]; subject: string; quote: QuotePreview };

export type ComposeAttachment = { id: string; filename: string; size: number; contentType: string; /** copied from the forwarded message */ forwarded?: boolean };

export type ComposeInit = {
  /** A saved draft this composer edits. */
  draftId?: string;
  from?: string;
  /** Addresses and department chips ("dept:<id>"). */
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  /** Plain text to start with. */
  text?: string;
  /** The body of a reopened draft (cleaned HTML, without the signature). */
  html?: string;
  parentId?: string | null;
  mode?: ComposeMode;
  /** The earlier message, shown hidden behind ··· (the server adds it when sending). */
  quote?: QuotePreview;
  /** Reply / Reply all / Forward for the same message: the switch in the reply header. */
  options?: Partial<Record<ReplyMode, ReplyOption>>;
  attachments?: ComposeAttachment[];
  /** How many files the message being answered has (forwarding copies them into the draft). */
  parentFiles?: number;
};

/** What a draft keeps (MailMessage.draft): the composer as it was. Also kept on the first message of a send, for Undo. */
export type DraftMeta = {
  v: 1;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Cleaned composer HTML, without the signature and the quote. */
  body: string;
  parentId: string | null;
  mode: ComposeMode;
  /** Paths of the forwarded message's files the person removed. */
  dropped: string[];
};

const MODES: readonly ComposeMode[] = ["new", "reply", "all", "forward"];
const list = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 320)).filter(Boolean).slice(0, max) : []);

/** Reads a stored draft safely (old drafts have none: null). */
export function readDraftMeta(value: unknown): DraftMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return {
    v: 1,
    to: list(v.to),
    cc: list(v.cc),
    bcc: list(v.bcc),
    subject: typeof v.subject === "string" ? v.subject.slice(0, 500) : "",
    body: typeof v.body === "string" ? v.body : "",
    parentId: typeof v.parentId === "string" && v.parentId ? v.parentId : null,
    mode: MODES.includes(v.mode as ComposeMode) ? (v.mode as ComposeMode) : "new",
    dropped: list(v.dropped, 50),
  };
}

const same = (a: string[], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Nothing worth keeping: no words, no files the person added, and the recipients and subject as the composer opened
 * with them (a reply's To is filled in for you). Closing such a composer drops its draft instead of filling Drafts.
 */
export function isDraftEmpty(s: { to: string[]; cc: string[]; bcc: string[]; subject: string; bodyText: string; attachments: ComposeAttachment[]; initial?: { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string } }): boolean {
  const i = s.initial ?? {};
  if (!same(s.to, i.to) || !same(s.cc, i.cc) || !same(s.bcc, i.bcc)) return false;
  if (s.bodyText.replace(/​/g, "").trim()) return false;
  if (s.attachments.some((a) => !a.forwarded)) return false;
  return s.subject.trim() === (i.subject ?? "").trim();
}

/**
 * Forwarding keeps the original files: a forward draft holds a copy of each one (same stored file) unless the person
 * removed it; switching to Reply takes the copies away again. Returns what to add and which draft rows to remove.
 */
export function forwardFilePlan<P extends { path: string }, D extends { id: string; path: string }>(parentFiles: P[], draftFiles: D[], mode: ComposeMode, dropped: string[]): { add: P[]; remove: string[] } {
  const parentPaths = new Set(parentFiles.map((f) => f.path));
  if (mode !== "forward") return { add: [], remove: draftFiles.filter((f) => parentPaths.has(f.path)).map((f) => f.id) };
  const have = new Set(draftFiles.map((f) => f.path));
  return { add: parentFiles.filter((f) => !have.has(f.path) && !dropped.includes(f.path)), remove: [] };
}

// Attachments: 20 MB in all per email (Resend takes up to 40 MB once encoded, which adds about a third), 20 files.
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACH_MAX_FILES = 20;
/** The private Storage bucket mail files live in (lib/mail/storage.ts). */
export const MAIL_BUCKET_NAME = "mail";

export const fileSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Why one more file may not be attached, or null. */
export function attachmentProblem(existing: number[], size: number): string | null {
  if (size <= 0) return "That file is empty.";
  if (existing.length >= ATTACH_MAX_FILES) return `At most ${ATTACH_MAX_FILES} files in one email.`;
  const total = existing.reduce((a, b) => a + b, 0) + size;
  if (total > ATTACH_MAX_BYTES) return `Attachments can be up to ${fileSize(ATTACH_MAX_BYTES)} in all. This one would make ${fileSize(total)}.`;
  return null;
}

/** Why a file does not fit in the person's storage, or null (quota in MB, as set in the Mail console). */
export function quotaProblem(usedBytes: number, quotaMb: number, size: number): string | null {
  const quota = quotaMb * 1024 * 1024;
  if (usedBytes + size <= quota) return null;
  return `Your storage is full (${fileSize(usedBytes)} of ${quotaMb >= 1000 ? `${quotaMb / 1000} GB` : `${quotaMb} MB`} used). Delete old mail with files, or ask your Mail admin for more space.`;
}

/** A content type safe to store and send; anything odd becomes application/octet-stream. */
export const safeContentType = (t: string | null | undefined) => (t && /^[\w.+-]+\/[\w.+-]+$/.test(t) && t.length < 120 ? t.toLowerCase() : "application/octet-stream");
/** A file name as shown and sent (no line breaks, not too long). */
export const safeFilename = (n: string) => n.replace(/[\r\n\t"\\/]+/g, " ").trim().slice(0, 200) || "file";
