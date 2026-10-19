import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/leads/normalize";
import { dispatchInbound } from "@/lib/automations/dispatch";
import type { OutboundMessage } from "./types";
import { MAX_TEXT, previewOf } from "./text";
import type { ChannelKind, InboundEvent } from "./types";

export { MAX_TEXT, previewOf };

// Every channel hands what arrives to ingestInbound(): it finds or creates the contact and the conversation, stores the
// message once (the same platform id twice is a duplicate, so polling twice is harmless), updates the inbox counters
// and then lets the automations (and the AI) answer. docs/INBOX.md.

/**
 * `handled`: an automation answered (or a teammate took over: `paused`), so the website chat must not add its own AI
 * reply. `replies`: what the automation sent during this call, for the website chat to show at once.
 */
export type IngestResult = { duplicate: boolean; contactId: string; conversationId: string; messageId: string | null; handled: boolean; paused: boolean; replies: OutboundMessage[] };

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** The thread key for a conversation: the platform thread, one comments thread per person and account, or the website session. */
export function threadKey(event: Pick<InboundEvent, "channel" | "kind" | "threadExternalId" | "connectionId" | "contact" | "chatSessionId">): string | null {
  if (event.channel === "WEBSITE") return null; // website conversations are keyed by chatSessionId
  if (event.kind === "COMMENT") return `comments:${event.connectionId ?? "-"}:${event.contact.externalId}`;
  return event.threadExternalId || `dm:${event.connectionId ?? "-"}:${event.contact.externalId}`;
}

/** Finds the contact for this channel identity, or creates one (joining an existing contact with the same email or phone). */
export async function resolveContact(businessId: string, channel: ChannelKind, connectionId: string | null | undefined, who: InboundEvent["contact"]) {
  const email = normalizeEmail(who.email) ?? null;
  const phone = normalizePhone(who.phone) ?? null;
  const existing = await prisma.contactIdentity.findUnique({
    where: { businessId_channel_externalId: { businessId, channel, externalId: who.externalId } },
    select: { id: true, contactId: true, handle: true, displayName: true },
  });
  if (existing) {
    if ((who.handle && who.handle !== existing.handle) || (who.name && who.name !== existing.displayName)) {
      await prisma.contactIdentity.update({ where: { id: existing.id }, data: { handle: who.handle ?? existing.handle, displayName: who.name ?? existing.displayName } });
    }
    return existing.contactId;
  }
  // Same person on another channel? Only an exact email or phone joins them; anything vaguer is left to "Merge".
  const match =
    email || phone
      ? await prisma.contact.findFirst({
          where: { businessId, mergedIntoId: null, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
          select: { id: true },
        })
      : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const contactId =
        match?.id ??
        (
          await tx.contact.create({
            data: { businessId, name: who.name ?? who.handle ?? null, email, phone, avatarUrl: who.avatarUrl ?? null, language: who.language ?? null, lastChannel: channel },
            select: { id: true },
          })
        ).id;
      await tx.contactIdentity.create({
        data: { businessId, contactId, channel, externalId: who.externalId, connectionId: connectionId ?? null, handle: who.handle ?? null, displayName: who.name ?? null },
      });
      return contactId;
    });
  } catch (error) {
    // Two events for a new person at once: the other one created the identity first.
    if (!isUnique(error)) throw error;
    const again = await prisma.contactIdentity.findUnique({ where: { businessId_channel_externalId: { businessId, channel, externalId: who.externalId } }, select: { contactId: true } });
    if (!again) throw error;
    return again.contactId;
  }
}

async function resolveConversation(event: InboundEvent, contactId: string) {
  const { businessId, channel } = event;
  if (channel === "WEBSITE") {
    if (!event.chatSessionId) throw new Error("A website event needs its chatSessionId");
    return prisma.conversation.upsert({
      where: { chatSessionId: event.chatSessionId },
      create: { businessId, contactId, channel, chatSessionId: event.chatSessionId },
      update: {},
      select: { id: true, botPausedUntil: true },
    });
  }
  const externalThreadId = threadKey(event)!;
  try {
    return await prisma.conversation.upsert({
      where: { businessId_channel_externalThreadId: { businessId, channel, externalThreadId } },
      create: { businessId, contactId, channel, connectionId: event.connectionId ?? null, externalThreadId },
      update: {},
      select: { id: true, botPausedUntil: true },
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    return prisma.conversation.findUniqueOrThrow({ where: { businessId_channel_externalThreadId: { businessId, channel, externalThreadId } }, select: { id: true, botPausedUntil: true } });
  }
}

/** Stores an inbound event and lets automations answer it. Safe to call twice with the same event. */
export async function ingestInbound(event: InboundEvent): Promise<IngestResult> {
  const text = (event.text ?? "").trim().slice(0, MAX_TEXT);
  const at = event.occurredAt ?? new Date();
  const contactId = await resolveContact(event.businessId, event.channel, event.connectionId, event.contact);
  const conversation = await resolveConversation(event, contactId);

  let messageId: string;
  try {
    const message = await prisma.message.create({
      data: {
        businessId: event.businessId,
        conversationId: conversation.id,
        direction: "INBOUND",
        author: "CONTACT",
        kind: event.kind,
        text,
        externalId: event.externalMessageId ?? null,
        postExternalId: event.postExternalId ?? null,
        payload: event.buttonId ? { buttonId: event.buttonId } : undefined,
        status: "RECEIVED",
        createdAt: at,
      },
      select: { id: true },
    });
    messageId = message.id;
  } catch (error) {
    if (isUnique(error)) return { duplicate: true, contactId, conversationId: conversation.id, messageId: null, handled: true, paused: false, replies: [] };
    throw error;
  }

  await Promise.all([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { preview: previewOf(text), lastMessageAt: at, lastInboundAt: at, unread: { increment: 1 }, status: "OPEN" },
    }),
    prisma.contact.update({
      where: { id: contactId },
      data: { lastSeenAt: at, lastChannel: event.channel, ...(event.contact.language ? { language: event.contact.language } : {}) },
    }),
  ]);

  const botPaused = !!conversation.botPausedUntil && conversation.botPausedUntil > new Date();
  try {
    const result = await dispatchInbound({ event: { ...event, text }, contactId, conversationId: conversation.id, messageId, botPaused });
    return { duplicate: false, contactId, conversationId: conversation.id, messageId, handled: result.handled, paused: !!result.paused, replies: result.replies };
  } catch (error) {
    // The message is saved and visible in the inbox even when an automation fails.
    console.error("[inbox.dispatch]", error instanceof Error ? error.message : error);
    return { duplicate: false, contactId, conversationId: conversation.id, messageId, handled: botPaused, paused: botPaused, replies: [] };
  }
}
