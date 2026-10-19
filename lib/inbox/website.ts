import "server-only";
import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/entitlements";
import { saveDetails } from "@/lib/contacts/core";
import { ingestInbound, type IngestResult } from "./ingest";
import { previewOf } from "./text";
import type { OutboundButton } from "./types";

// The website chat (lib/widget/chat.ts) in the inbox: visitor messages go through ingestInbound (so automations can
// answer them), the chat's own AI replies are copied into the conversation, and leads are linked to their contact.
// Only for companies whose plan has the inbox. Nothing here may break the chat: every function catches its errors.

/** Stores a visitor message in the inbox and runs automations. Null when the plan has no inbox or something failed. */
export async function ingestWebsiteMessage(input: { businessId: string; sessionId: string; visitorId: string; text: string; chatMessageId: string; language?: string | null }): Promise<IngestResult | null> {
  try {
    if (!(await hasFeature(input.businessId, "inbox"))) return null;
    return await ingestInbound({
      businessId: input.businessId,
      channel: "WEBSITE",
      kind: "MESSAGE",
      chatSessionId: input.sessionId,
      contact: { externalId: input.visitorId, language: input.language ?? undefined },
      text: input.text,
      externalMessageId: input.chatMessageId,
    });
  } catch (error) {
    console.error("[inbox.website] ingest", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Copies the website chat's own AI reply into the conversation (the inbox shows the whole chat). */
export async function mirrorWebsiteReply(sessionId: string, chatMessageId: string, text: string): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { chatSessionId: sessionId }, select: { id: true, businessId: true } });
    if (!conversation) return;
    await prisma.message.create({
      data: { businessId: conversation.businessId, conversationId: conversation.id, direction: "OUTBOUND", author: "BOT", kind: "MESSAGE", text, externalId: chatMessageId, status: "SENT" },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { preview: previewOf(text), lastMessageAt: new Date() } });
  } catch (error) {
    console.error("[inbox.website] mirror", error instanceof Error ? error.message : error);
  }
}

/** Links the chat's lead to the conversation's contact and copies the details the visitor gave onto the contact. */
export async function linkLeadToContact(sessionId: string): Promise<void> {
  try {
    const [conversation, lead] = await Promise.all([
      prisma.conversation.findUnique({ where: { chatSessionId: sessionId }, select: { contactId: true, businessId: true } }),
      prisma.lead.findUnique({ where: { sessionId }, select: { id: true, name: true, email: true, phone: true, contactId: true } }),
    ]);
    if (!conversation || !lead) return;
    if (!lead.contactId) await prisma.lead.update({ where: { id: lead.id }, data: { contactId: conversation.contactId } });
    await saveDetails(conversation.businessId, conversation.contactId, { name: lead.name, email: lead.email, phone: lead.phone });
  } catch (error) {
    console.error("[inbox.website] lead", error instanceof Error ? error.message : error);
  }
}

export type WidgetMessage = { id: string; text: string; buttons?: OutboundButton[]; at: string };

/**
 * Replies added to a website chat after `after` (a teammate in the inbox, an automation after a wait): what the chat
 * bubble shows when it checks for new messages. Only outbound chat messages that were sent; notes never leave the inbox.
 */
export async function websiteMessagesSince(businessId: string, sessionId: string, after: Date): Promise<WidgetMessage[]> {
  const conversation = await prisma.conversation.findUnique({ where: { chatSessionId: sessionId }, select: { id: true, businessId: true } });
  if (!conversation || conversation.businessId !== businessId) return [];
  const rows = await prisma.message.findMany({
    where: { conversationId: conversation.id, direction: "OUTBOUND", kind: "MESSAGE", status: "SENT", createdAt: { gt: after } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, text: true, payload: true, createdAt: true },
  });
  return rows.map((m) => {
    const payload = m.payload && typeof m.payload === "object" && !Array.isArray(m.payload) ? (m.payload as { buttons?: OutboundButton[] }) : {};
    return { id: m.id, text: m.text, buttons: Array.isArray(payload.buttons) && payload.buttons.length ? payload.buttons.slice(0, 3) : undefined, at: m.createdAt.toISOString() };
  });
}
