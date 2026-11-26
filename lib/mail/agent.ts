import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/api/keys";
import { RateLimitError, rateLimit, type RateLimitRule } from "@/lib/rate-limit";
import type { Addr } from "./addresses";
import { agentSendsLeft, bearerAgentKey, encodeCursor, generateAgentKey, type AgentSendInput, type Cursor } from "./agent-rules";
import { queueMessage, sendsLeftToday, type QueueResult } from "./send";
import type { MailMe } from "./session";

// The B Mail agent API (docs/mail-crm/AGENT_API.md): an outreach agent (Sellbird) sends from one mailbox and reads what
// arrives in it, with a key a mail admin makes in the Mail console. The key is tied to that mailbox only.

export const AGENT_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 }; // per key
const LAST_USED_EVERY_MS = 60_000;
/** Without a cursor or ?since=, the inbox list starts this far back. */
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const keySelect = { id: true, name: true, prefix: true, mailboxId: true, memberId: true, fromName: true, signature: true, dailyLimit: true, lastUsedAt: true, revokedAt: true, createdBy: true, createdAt: true } as const;

export type AgentKeyRow = { id: string; name: string; prefix: string; mailboxId: string; memberId: string | null; fromName: string | null; signature: boolean; dailyLimit: number; lastUsedAt: Date | null; revokedAt: Date | null; createdBy: string; createdAt: Date };
export type AgentContext = { key: AgentKeyRow; mailbox: { id: string; address: string; name: string; kind: string } };

/** Every error is JSON: { "error": { "code": "...", "message": "..." } }. */
export function agentError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function agentJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Checks the bearer key, its mailbox and the per-key rate limit. Returns the context or the error to send. */
export async function authenticateAgent(request: Request): Promise<{ ok: true; ctx: AgentContext } | { ok: false; response: NextResponse }> {
  const unauthorized = (message: string) => ({ ok: false as const, response: agentError(401, "unauthorized", message, { "www-authenticate": "Bearer" }) });
  const raw = bearerAgentKey(request.headers.get("authorization"));
  if (!raw) return unauthorized("Send your B Mail agent key as: Authorization: Bearer bpm_live_...");
  const key = await prisma.mailAgentKey.findUnique({ where: { hash: await hashApiKey(raw) }, select: keySelect });
  if (!key || key.revokedAt) return unauthorized("This agent key is not valid or was revoked.");
  const mailbox = await prisma.mailbox.findUnique({ where: { id: key.mailboxId }, select: { id: true, address: true, name: true, kind: true } });
  if (!mailbox?.address) return { ok: false, response: agentError(403, "mailbox_unavailable", "The mailbox this key belongs to no longer exists or has no address.") };
  try {
    await rateLimit(`mail-agent:${key.id}`, AGENT_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, response: agentError(429, "rate_limited", `Too many requests. Limit: ${AGENT_RATE_LIMIT.limit} per minute per key.`, { "retry-after": String(error.retryAfterSeconds) }) };
    }
    throw error;
  }
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    await prisma.mailAgentKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { ok: true, ctx: { key, mailbox: { ...mailbox, address: mailbox.address } } };
}

/** Wraps a handler: authentication, then the handler, with any unexpected error turned into a JSON 500. */
export function agentRoute<A extends unknown[]>(handler: (ctx: AgentContext, request: Request, ...args: A) => Promise<NextResponse>) {
  return async (request: Request, ...args: A): Promise<NextResponse> => {
    try {
      const auth = await authenticateAgent(request);
      if (!auth.ok) return auth.response;
      return await handler(auth.ctx, request, ...args);
    } catch (error) {
      console.error("[api/mail/agent] failed:", error instanceof Error ? error.message : error);
      return agentError(500, "server_error", "Something went wrong on our side. Please try again.");
    }
  };
}

const utcMidnight = (d = new Date()) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

/** Emails this key sent (or is sending) since 00:00 UTC, the same day MailSendDay counts. */
export async function keySentToday(keyId: string): Promise<number> {
  return prisma.mailMessage.count({ where: { agentKeyId: keyId, direction: "out", status: { in: ["queued", "sending", "sent"] }, createdAt: { gte: utcMidnight() } } });
}

export async function agentSendsLeftNow(key: AgentKeyRow): Promise<{ left: number; keySentToday: number; teamLeft: number }> {
  const [sent, teamLeft] = await Promise.all([keySentToday(key.id), sendsLeftToday()]);
  return { left: agentSendsLeft({ dailyLimit: key.dailyLimit, keySentToday: sent, teamLeft }), keySentToday: sent, teamLeft };
}

/** Who the agent sends as: only its own mailbox, with the signature of the admin who made the key. */
async function agentMe(ctx: AgentContext): Promise<MailMe> {
  const member = ctx.key.memberId ? await prisma.mailMember.findUnique({ where: { id: ctx.key.memberId }, select: { id: true, email: true, name: true } }) : null;
  return {
    userId: `agent:${ctx.key.id}`,
    email: member?.email ?? ctx.key.createdBy,
    name: ctx.key.fromName?.trim() || member?.name || ctx.mailbox.name,
    memberId: member?.id ?? null,
    isOwner: false,
    isAdmin: false,
    isSuper: false,
    mailboxIds: [ctx.mailbox.id],
    departmentIds: [],
    photoPath: null,
    prefs: {},
  };
}

export type AgentSendResult =
  | { ok: true; id: string; threadId: string; messageId: string | null }
  | { ok: false; error: string; code: "limit" | "not_sent" };

/** Queues one email from the key's mailbox, threaded under the message it answers when that is in the mailbox. */
export async function sendAsAgent(ctx: AgentContext, input: AgentSendInput): Promise<AgentSendResult> {
  const { left, teamLeft } = await agentSendsLeftNow(ctx.key);
  if (left < 1) {
    return { ok: false, code: "limit", error: teamLeft < 1 ? "The team's free sends for today are used up. It resets at 02:00 Kigali time." : `This key's ${ctx.key.dailyLimit} sends for today are used up. It resets at 02:00 Kigali time.` };
  }
  const parent = input.inReplyTo
    ? await prisma.mailMessage.findFirst({ where: { mailboxId: ctx.mailbox.id, messageId: input.inReplyTo, status: { not: "draft" } }, select: { id: true } })
    : null;
  const r: QueueResult = await queueMessage(await agentMe(ctx), {
    fromMailboxId: ctx.mailbox.id,
    to: [input.to],
    cc: [],
    bcc: [],
    subject: input.subject,
    text: input.text,
    parentId: parent?.id ?? null,
    mode: parent ? "reply" : "new",
    includeQuote: false,
    agent: { keyId: ctx.key.id, fromName: ctx.key.fromName, signature: ctx.key.signature },
  });
  if (!r.ok) return { ok: false, code: "not_sent", error: r.error };
  const row = await prisma.mailMessage.findUnique({ where: { id: r.messageId }, select: { messageId: true } });
  return { ok: true, id: r.messageId, threadId: r.threadId, messageId: row?.messageId ?? null };
}

/** One sent message's status, for a message this key sent. */
export async function agentMessageStatus(ctx: AgentContext, id: string) {
  const m = await prisma.mailMessage.findFirst({
    where: { id, agentKeyId: ctx.key.id, mailboxId: ctx.mailbox.id },
    select: { id: true, threadId: true, status: true, messageId: true, providerId: true, error: true, date: true, sendAt: true },
  });
  if (!m) return null;
  return { id: m.id, threadId: m.threadId, status: m.status, messageId: m.messageId, providerId: m.providerId, error: m.error, sentAt: m.status === "sent" ? m.date.toISOString() : null };
}

/**
 * What arrived in the key's mailbox after the cursor, oldest first: received mail only (never drafts or what we sent),
 * spam included with its folder so the agent can tell. Without a cursor it starts at ?since= (or 7 days back).
 */
export async function listInbound(ctx: AgentContext, o: { cursor: Cursor | null; since: Date | null; limit: number }) {
  const after = o.cursor
    ? { OR: [{ createdAt: { gt: o.cursor.at } }, { createdAt: o.cursor.at, id: { gt: o.cursor.id } }] }
    : { createdAt: { gte: o.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS) } };
  const rows = await prisma.mailMessage.findMany({
    where: { mailboxId: ctx.mailbox.id, direction: "in", status: "received", ...after },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: o.limit + 1,
    select: {
      id: true, threadId: true, messageId: true, inReplyTo: true, references: true, fromAddress: true, fromName: true, to: true, cc: true,
      replyTo: true, subject: true, text: true, date: true, authResults: true, createdAt: true, thread: { select: { folder: true } },
    },
  });
  const page = rows.slice(0, o.limit);
  const data = page.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
    references: m.references,
    from: { name: m.fromName, address: m.fromAddress },
    to: m.to as Addr[],
    cc: m.cc as Addr[],
    replyTo: m.replyTo,
    subject: m.subject,
    text: m.text,
    date: m.date.toISOString(),
    folder: m.thread.folder,
    authResults: m.authResults,
    cursor: encodeCursor({ at: m.createdAt, id: m.id }),
  }));
  const last = page[page.length - 1];
  return {
    data,
    // Where the next call starts: after the last message returned, or where this one started when nothing was new.
    nextCursor: last ? encodeCursor({ at: last.createdAt, id: last.id }) : o.cursor ? encodeCursor(o.cursor) : null,
    hasMore: rows.length > o.limit,
  };
}

// ---- Mail console: making and revoking keys -------------------------------------------------------------------------

export const MAX_AGENT_KEYS = 10;

export async function listAgentKeys() {
  return prisma.mailAgentKey.findMany({ orderBy: { createdAt: "desc" }, select: keySelect });
}

/** Creates a key for one mailbox. The full key is returned once; only its hash is stored. */
export async function createAgentKey(o: { name: string; mailboxId: string; dailyLimit: number; fromName: string | null; signature: boolean; memberId: string | null; createdBy: string }) {
  if ((await prisma.mailAgentKey.count({ where: { revokedAt: null } })) >= MAX_AGENT_KEYS) {
    return { ok: false as const, error: `You can have up to ${MAX_AGENT_KEYS} active agent keys. Revoke one first.` };
  }
  const mailbox = await prisma.mailbox.findUnique({ where: { id: o.mailboxId }, select: { address: true } });
  if (!mailbox?.address) return { ok: false as const, error: "Pick a mailbox with its own address." };
  const { key, prefix } = generateAgentKey();
  const row = await prisma.mailAgentKey.create({ data: { ...o, prefix, hash: await hashApiKey(key) }, select: keySelect });
  return { ok: true as const, key, row };
}

export async function revokeAgentKey(id: string): Promise<boolean> {
  const r = await prisma.mailAgentKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count === 1;
}
