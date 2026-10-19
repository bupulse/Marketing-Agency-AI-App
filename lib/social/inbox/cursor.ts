// What the inbox check remembers per account (Connection.inboxCursor), so each check asks only for what changed.
// Pure. Rules:
// - `since`: when the business switched the account on. Nothing older is taken in, so switching on never makes
//   automations answer last month's comments.
// - `posts`: each recent post's comment count; comments are read only for posts whose count went up.
// - `dmAt`: the newest conversation update seen; only conversations updated after it are opened.

export type InboxCursor = {
  v: 1;
  since: string;
  posts: Record<string, { c: number; t: string | null }>;
  dmAt: string | null;
  /** The last time a new comment or message was found (sets the check's pace). */
  activityAt: string | null;
  checkedAt: string | null;
  /** Failed checks in a row, and the last reason, for the Channels page and the back-off. */
  errors: number;
  lastError: string | null;
};

/** Posts older than this are not watched (Meta allows private replies for 7 days, and old posts rarely get comments). */
export const POST_WINDOW_DAYS = 7;

export function newCursor(now = new Date()): InboxCursor {
  return { v: 1, since: now.toISOString(), posts: {}, dmAt: now.toISOString(), activityAt: null, checkedAt: null, errors: 0, lastError: null };
}

export function parseCursor(raw: unknown, now = new Date()): InboxCursor {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<InboxCursor>) : null;
  if (!o || o.v !== 1 || typeof o.since !== "string") return newCursor(now);
  return {
    v: 1,
    since: o.since,
    posts: o.posts && typeof o.posts === "object" ? o.posts : {},
    dmAt: typeof o.dmAt === "string" ? o.dmAt : null,
    activityAt: typeof o.activityAt === "string" ? o.activityAt : null,
    checkedAt: typeof o.checkedAt === "string" ? o.checkedAt : null,
    errors: typeof o.errors === "number" ? o.errors : 0,
    lastError: typeof o.lastError === "string" ? o.lastError : null,
  };
}

/** Drops posts older than the window, so the cursor stays small. */
export function prunePosts(cursor: InboxCursor, now = new Date()): InboxCursor {
  const cutoff = now.getTime() - POST_WINDOW_DAYS * 86_400_000;
  const posts = Object.fromEntries(Object.entries(cursor.posts).filter(([, p]) => !p.t || new Date(p.t).getTime() >= cutoff));
  return { ...cursor, posts };
}

/** True when the item happened after the account was switched on (an unknown time counts as new). */
export function isAfterSince(cursor: InboxCursor, at: Date | null): boolean {
  return !at || at.getTime() >= new Date(cursor.since).getTime();
}
