import type { ChannelKind, InboundEvent } from "@/lib/inbox/types";

// Reading what Instagram and Facebook return (through Composio's tools, Composio's proxy or Meta's own Graph API and
// webhooks) into the engine's InboundEvent. Pure, so the tests feed it recorded shapes. Composio passes the network's
// answer back in `data`, sometimes wrapped once more, so the readers look one level down too.

type Json = Record<string, unknown>;

export const asObject = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The first array of objects in `data`: itself, or under data / items / response_data, one or two levels down. */
export function listIn(data: unknown): Json[] {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as Json[];
  const o = asObject(data);
  for (const key of ["data", "items", "response_data"]) {
    const found = o[key];
    if (Array.isArray(found)) return found.filter((x) => x && typeof x === "object") as Json[];
    if (found && typeof found === "object") {
      const deeper = listIn(found);
      if (deeper.length) return deeper;
    }
  }
  return [];
}

/** Graph times ("2026-10-19T08:00:00+0000") or Unix seconds / milliseconds. */
export function timeOf(v: unknown): Date | null {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type Person = { id: string; name?: string; handle?: string };

/** A comment as both networks give it: Instagram (text, username) or Facebook (message, from.name). */
export type Comment = { id: string; text: string; at: Date | null; from: Person | null; parentId?: string };

export function readComment(raw: Json): Comment | null {
  const id = str(raw.id);
  if (!id) return null;
  const from = asObject(raw.from);
  const fromId = str(from.id);
  const handle = str(from.username) ?? str(raw.username);
  return {
    id,
    text: str(raw.text) ?? str(raw.message) ?? "",
    at: timeOf(raw.timestamp ?? raw.created_time),
    from: fromId ? { id: fromId, name: str(from.name), handle } : null,
    parentId: str(asObject(raw.parent).id) ?? str(raw.parent_id),
  };
}

/** A post with its comment count and, when the list call nested them, its newest comments. */
export type PostInfo = { id: string; caption?: string; at: Date | null; count: number; comments: Comment[] | null };

export function readPost(raw: Json): PostInfo | null {
  const id = str(raw.id);
  if (!id) return null;
  const nested = asObject(raw.comments);
  const summary = asObject(nested.summary);
  const list = Array.isArray(nested.data) ? (nested.data as Json[]) : null;
  return {
    id,
    caption: (str(raw.caption) ?? str(raw.message) ?? str(raw.permalink) ?? str(raw.permalink_url))?.slice(0, 500),
    at: timeOf(raw.timestamp ?? raw.created_time),
    count: num(raw.comments_count) ?? num(summary.total_count) ?? list?.length ?? 0,
    comments: list ? (list.map(readComment).filter(Boolean) as Comment[]) : null,
  };
}

/** A DM. `text` falls back to a note for photos, voice notes and shared posts. */
export type DirectMessage = { id: string; text: string; at: Date | null; from: Person | null; storyMention: boolean };

export function readMessage(raw: Json): DirectMessage | null {
  const id = str(raw.id) ?? str(raw.mid);
  if (!id) return null;
  const from = asObject(raw.from);
  const fromId = str(from.id);
  const attachments = listIn(raw.attachments);
  const storyMention = attachments.some((a) => str(a.type) === "story_mention") || !!asObject(raw.story).mention;
  const text = str(raw.message) ?? str(raw.text) ?? (storyMention ? "Mentioned you in their story" : attachments.length || raw.attachments ? "Sent an attachment" : "");
  return { id, text, at: timeOf(raw.created_time ?? raw.timestamp), from: fromId ? { id: fromId, name: str(from.name), handle: str(from.username) } : null, storyMention };
}

/** A DM thread with its newest messages when the list call nested them, and the other person. */
export type Thread = { id: string; updatedAt: Date | null; messages: DirectMessage[] | null; participants: Person[] };

export function readThread(raw: Json): Thread | null {
  const id = str(raw.id);
  if (!id) return null;
  const nested = asObject(raw.messages);
  const list = Array.isArray(nested.data) ? (nested.data as Json[]).map(readMessage).filter(Boolean) as DirectMessage[] : null;
  // A nested list without text or sender is ids only (Meta's default): the messages are fetched on their own.
  const usable = list && list.length && list.every((m) => m.from) ? list : null;
  const participants = listIn(raw.participants)
    .map((p) => ({ id: str(p.id) ?? "", name: str(p.name), handle: str(p.username) }))
    .filter((p) => p.id);
  return { id, updatedAt: timeOf(raw.updated_time), messages: usable, participants };
}

/** True when the comment or message was written by the business's own account (never answered). */
export function isOwn(from: Person | null, account: { externalAccountId: string; handle?: string | null }): boolean {
  if (!from) return false;
  if (from.id === account.externalAccountId) return true;
  const own = account.handle?.replace(/^@/, "").toLowerCase();
  return !!own && from.handle?.toLowerCase() === own;
}

export type AccountRef = { businessId: string; connectionId: string; channel: Extract<ChannelKind, "INSTAGRAM" | "FACEBOOK"> };

export function commentEvent(account: AccountRef, post: { id: string; caption?: string }, comment: Comment & { from: Person }): InboundEvent {
  return {
    businessId: account.businessId,
    channel: account.channel,
    connectionId: account.connectionId,
    kind: "COMMENT",
    contact: { externalId: comment.from.id, name: comment.from.name, handle: comment.from.handle },
    text: comment.text,
    externalMessageId: comment.id,
    postExternalId: post.id,
    postCaption: post.caption,
    occurredAt: comment.at ?? undefined,
  };
}

export function messageEvent(account: AccountRef, threadId: string | undefined, message: DirectMessage & { from: Person }, extra: { buttonId?: string } = {}): InboundEvent {
  return {
    businessId: account.businessId,
    channel: account.channel,
    connectionId: account.connectionId,
    kind: message.storyMention ? "STORY_MENTION" : "MESSAGE",
    contact: { externalId: message.from.id, name: message.from.name, handle: message.from.handle },
    threadExternalId: threadId,
    text: message.text,
    externalMessageId: message.id,
    occurredAt: message.at ?? undefined,
    ...(extra.buttonId ? { buttonId: extra.buttonId } : {}),
  };
}
