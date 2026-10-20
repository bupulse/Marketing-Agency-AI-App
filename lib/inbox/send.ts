import "server-only";
import { prisma } from "@/lib/db";
import type { MessageAuthor, MessageKind } from "@/lib/generated/prisma/client";
import { channelAdapter } from "./channels";
import "./all-channels";
import { previewOf, MAX_TEXT } from "./text";
import { ChannelSendError, type OutboundMessage, type SendTarget } from "./types";

// Sending from the engine (an automation, the AI, a teammate in the inbox) through the conversation's channel. The
// message is stored first (QUEUED), then sent, then marked SENT or FAILED with a plain-English reason the inbox shows.

export type SendOptions = {
  author: Extract<MessageAuthor, "BOT" | "AGENT" | "SYSTEM">;
  agentId?: string | null;
  automationRunId?: string | null;
  /** "COMMENT_REPLY" answers under a comment; "MESSAGE" is a chat or DM. */
  kind?: Extract<MessageKind, "MESSAGE" | "COMMENT_REPLY">;
  /** For COMMENT_REPLY and private replies: the comment being answered. */
  commentExternalId?: string;
  /** Send as a Meta private reply to `commentExternalId` (the first DM to a commenter). */
  privateReply?: boolean;
};

export type SendOutcome = { ok: true; messageId: string } | { ok: false; messageId: string | null; error: string; retry: boolean };

/** The conversation as a channel needs it. */
export async function sendTarget(conversationId: string): Promise<SendTarget | null> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      businessId: true,
      channel: true,
      connectionId: true,
      externalThreadId: true,
      chatSessionId: true,
      contact: { select: { identities: { select: { channel: true, externalId: true, connectionId: true } } } },
    },
  });
  if (!c) return null;
  const identity = c.contact.identities.find((i) => i.channel === c.channel && (!c.connectionId || !i.connectionId || i.connectionId === c.connectionId));
  return {
    businessId: c.businessId,
    conversationId: c.id,
    channel: c.channel,
    connectionId: c.connectionId,
    threadExternalId: c.externalThreadId,
    chatSessionId: c.chatSessionId,
    recipientExternalId: identity?.externalId ?? null,
  };
}

/** Hours since the person last wrote, or null when they never did. */
export function hoursSince(date: Date | null | undefined, now = new Date()): number | null {
  return date ? (now.getTime() - date.getTime()) / 3_600_000 : null;
}

export async function sendToConversation(conversationId: string, message: OutboundMessage, options: SendOptions): Promise<SendOutcome> {
  const target = await sendTarget(conversationId);
  if (!target) return { ok: false, messageId: null, error: "That conversation no longer exists.", retry: false };
  const adapter = channelAdapter(target.channel);
  const kind = options.kind ?? "MESSAGE";
  const text = message.text.trim().slice(0, MAX_TEXT);

  const stored = await prisma.message.create({
    data: {
      businessId: target.businessId,
      conversationId,
      direction: "OUTBOUND",
      author: options.author,
      kind,
      agentId: options.agentId ?? null,
      text,
      payload: message.buttons || message.quickReplies || message.imageUrl ? { buttons: message.buttons, quickReplies: message.quickReplies, imageUrl: message.imageUrl } : undefined,
      status: "QUEUED",
      automationRunId: options.automationRunId ?? null,
    },
    select: { id: true },
  });

  const fail = async (error: string, retry: boolean): Promise<SendOutcome> => {
    await prisma.message.update({ where: { id: stored.id }, data: { status: "FAILED", error } });
    return { ok: false, messageId: stored.id, error, retry };
  };

  if (!adapter || !(await adapter.available())) return fail("This channel is not switched on yet.", false);
  if (kind === "MESSAGE" && !options.privateReply && adapter.capabilities.windowHours !== null) {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { lastInboundAt: true } });
    const hours = hoursSince(conv?.lastInboundAt);
    if (hours === null || hours > adapter.capabilities.windowHours) {
      return fail(`The platform only allows replies within ${adapter.capabilities.windowHours} hours of the person's last message.`, false);
    }
  }

  try {
    const result =
      kind === "COMMENT_REPLY"
        ? adapter.replyToComment && options.commentExternalId
          ? await adapter.replyToComment(target, options.commentExternalId, text)
          : null
        : options.privateReply
          ? adapter.privateReply && options.commentExternalId
            ? await adapter.privateReply(target, options.commentExternalId, { ...message, text })
            : null
          : await adapter.send(target, { ...message, text });
    if (!result) return fail("This channel cannot send that kind of reply.", false);
    await Promise.all([
      prisma.message.update({ where: { id: stored.id }, data: { status: "SENT", externalId: result.externalId ?? null } }),
      prisma.conversation.update({ where: { id: conversationId }, data: { preview: previewOf(text), lastMessageAt: new Date() } }),
    ]);
    return { ok: true, messageId: stored.id };
  } catch (error) {
    if (error instanceof ChannelSendError) return fail(error.message, error.retry);
    console.error("[inbox.send]", error instanceof Error ? error.message : error);
    return fail("The message could not be sent. Please try again.", true);
  }
}
