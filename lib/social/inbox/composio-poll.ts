import type { InboundEvent } from "@/lib/inbox/types";
import { isAfterSince, POST_WINDOW_DAYS, prunePosts, type InboxCursor } from "./cursor";
import { commentEvent, isOwn, listIn, messageEvent, readComment, readMessage, readPost, readThread, type AccountRef, type Comment, type DirectMessage, type Person, type Thread } from "./mapping";

// One check of one Instagram or Facebook account through BuPulse-Socials (Composio has no triggers for Meta, so new
// comments and DMs are found by asking). Each check costs as few Composio calls as possible:
//   1. the account's posts of the last 7 days with their comment counts (and, nested, their newest comments), and
//   2. its DM conversations with their last update time (Instagram: newest messages nested too),
// then one more call only for a post whose count went up without nested comments, or a conversation that changed
// without nested messages. A quiet check is 2 calls. Every call goes through `call`, which reserves it against the
// monthly limit first (lib/social/inbox/budget.ts) and stops the check at MAX_CALLS_PER_CHECK.

/** At most this many calls in one check; the rest waits for the next check (nothing is skipped: counts only move on once read). */
export const MAX_CALLS_PER_CHECK = 10;

/** Thrown by `call` when the monthly limit or the per-check limit is reached: the check stops and keeps what it has. */
export class CallLimitError extends Error {
  constructor(readonly reason: "month" | "check") {
    super(reason === "month" ? "This month's limit of Composio calls is reached" : "Per-check call limit reached");
    this.name = "CallLimitError";
  }
}

export type PollAccount = AccountRef & { network: "instagram" | "facebook"; externalAccountId: string; handle?: string | null };

export type PollInput = {
  account: PollAccount;
  cursor: InboxCursor;
  /** Runs one Composio tool (budgeted). Throws CallLimitError when no call is left. */
  call: (slug: string, args: Record<string, unknown>) => Promise<unknown>;
  ingest: (event: InboundEvent) => Promise<{ duplicate: boolean }>;
  now: Date;
};

export type PollResult = { cursor: InboxCursor; found: number; errors: string[]; limited: CallLimitError["reason"] | null };

const IG_COMMENT_FIELDS = "id,text,timestamp,from,username,parent_id";
const IG_MESSAGE_FIELDS = "id,created_time,from,to,message,attachments";
const FB_COMMENT_FIELDS = "id,message,created_time,from,parent";
const FB_MESSAGE_FIELDS = "id,created_time,from,message,attachments";

const TOOLS = {
  instagram: {
    posts: (a: PollAccount, since: number) => ["INSTAGRAM_GET_IG_USER_MEDIA", { ig_user_id: a.externalAccountId, since, limit: 25, fields: `id,caption,permalink,timestamp,comments_count,comments.limit(50){${IG_COMMENT_FIELDS}}` }] as const,
    comments: (_a: PollAccount, postId: string) => ["INSTAGRAM_GET_IG_MEDIA_COMMENTS", { ig_media_id: postId, limit: 50, fields: IG_COMMENT_FIELDS }] as const,
    threads: () => ["INSTAGRAM_LIST_ALL_CONVERSATIONS", { platform: "instagram", limit: 20, fields: `id,updated_time,participants,messages.limit(10){${IG_MESSAGE_FIELDS}}` }] as const,
    messages: (_a: PollAccount, threadId: string) => ["INSTAGRAM_LIST_ALL_MESSAGES", { conversation_id: threadId, limit: 10, fields: IG_MESSAGE_FIELDS }] as const,
  },
  facebook: {
    posts: (a: PollAccount, since: number) =>
      ["FACEBOOK_GET_PAGE_POSTS", { page_id: a.externalAccountId, since: String(since), limit: 25, fields: `id,message,permalink_url,created_time,comments.filter(stream).order(reverse_chronological).summary(true).limit(50){${FB_COMMENT_FIELDS}}` }] as const,
    comments: (_a: PollAccount, postId: string) => ["FACEBOOK_GET_COMMENTS", { object_id: postId, order: "reverse_chronological", filter: "stream", limit: 50, fields: FB_COMMENT_FIELDS }] as const,
    // Composio's notes ask not to nest messages in this list, so a changed conversation costs one more call.
    threads: (a: PollAccount) => ["FACEBOOK_GET_PAGE_CONVERSATIONS", { page_id: a.externalAccountId, limit: 20, fields: "id,updated_time,participants" }] as const,
    messages: (a: PollAccount, threadId: string) => ["FACEBOOK_GET_CONVERSATION_MESSAGES", { page_id: a.externalAccountId, conversation_id: threadId, limit: 10, fields: FB_MESSAGE_FIELDS }] as const,
  },
};

const plain = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export async function pollAccount(input: PollInput): Promise<PollResult> {
  const { account, now } = input;
  let cursor = prunePosts(input.cursor, now);
  let found = 0;
  let limited: PollResult["limited"] = null;
  const errors: string[] = [];
  const tools = TOOLS[account.network];

  const take = async (event: InboundEvent) => {
    if (!(await input.ingest(event)).duplicate) found++;
  };

  // ---- comments ----
  try {
    const since = Math.floor((now.getTime() - POST_WINDOW_DAYS * 86_400_000) / 1000);
    const [slug, args] = tools.posts(account, since);
    const posts = listIn(await input.call(slug, args)).map(readPost).filter((p) => !!p);
    const sinceAt = new Date(cursor.since).getTime();
    for (const post of posts) {
      const prev = cursor.posts[post.id];
      const t = post.at?.toISOString() ?? null;
      // A post from before the switch-on that we have not seen yet: remember its count, nothing to take in.
      if (!prev && post.at && post.at.getTime() < sinceAt && !post.comments) {
        cursor = { ...cursor, posts: { ...cursor.posts, [post.id]: { c: post.count, t } } };
        continue;
      }
      if (post.count <= (prev?.c ?? 0)) {
        cursor = { ...cursor, posts: { ...cursor.posts, [post.id]: { c: post.count, t } } };
        continue;
      }
      let comments: Comment[] = post.comments ?? [];
      if (!post.comments) {
        const [cSlug, cArgs] = tools.comments(account, post.id);
        comments = listIn(await input.call(cSlug, cArgs)).map(readComment).filter((c) => !!c);
      }
      // Oldest first, so automations see a person's comments in order.
      for (const c of [...comments].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))) {
        if (!c.from || isOwn(c.from, account) || !isAfterSince(cursor, c.at)) continue;
        await take(commentEvent(account, post, c as Comment & { from: Person }));
      }
      cursor = { ...cursor, posts: { ...cursor.posts, [post.id]: { c: post.count, t } } };
    }
  } catch (error) {
    if (error instanceof CallLimitError) limited = error.reason;
    else errors.push(`Comments: ${plain(error)}`);
  }

  // ---- direct messages ----
  if (!limited) {
    try {
      const [slug, args] = tools.threads(account);
      const threads = listIn(await input.call(slug, args))
        .map(readThread)
        .filter((t): t is Thread => !!t)
        .sort((a, b) => (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0));
      const seen = cursor.dmAt ? new Date(cursor.dmAt).getTime() : 0;
      let newest = seen;
      try {
        for (const thread of threads) {
          const updated = thread.updatedAt?.getTime() ?? now.getTime();
          if (updated <= seen) continue;
          let messages: DirectMessage[] = thread.messages ?? [];
          if (!thread.messages) {
            const [mSlug, mArgs] = tools.messages(account, thread.id);
            messages = listIn(await input.call(mSlug, mArgs)).map(readMessage).filter((m) => !!m);
          }
          for (const m of [...messages].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))) {
            if (!m.from || isOwn(m.from, account) || !isAfterSince(cursor, m.at)) continue;
            const who = thread.participants.find((p) => p.id === m.from!.id);
            const from = { ...m.from, name: m.from.name ?? who?.name, handle: m.from.handle ?? who?.handle };
            // No platform thread id: the engine keys DMs by account and person, the same as Meta's webhooks do,
            // so switching from BuPulse-Socials to Meta direct keeps one conversation per person.
            await take(messageEvent(account, undefined, { ...m, from }));
          }
          newest = Math.max(newest, updated);
        }
      } finally {
        // Conversations are read oldest first, so everything up to `newest` is in, even if the check stopped early.
        if (newest > seen) cursor = { ...cursor, dmAt: new Date(newest).toISOString() };
      }
    } catch (error) {
      if (error instanceof CallLimitError) limited = error.reason;
      else errors.push(`Messages: ${plain(error)}`);
    }
  }

  cursor = {
    ...cursor,
    checkedAt: now.toISOString(),
    activityAt: found > 0 ? now.toISOString() : cursor.activityAt,
    errors: errors.length ? cursor.errors + 1 : 0,
    lastError: errors.length ? errors.join(" ") : limited === "month" ? "This month's limit of checks is reached." : null,
  };
  return { cursor, found, errors, limited };
}
