import "server-only";
import { prisma } from "@/lib/db";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { alertInBackground } from "@/lib/lead-alerts/channels";
import type { LeadAlert } from "@/lib/lead-alerts/format";
import { normaliseQuotePhone } from "@/lib/quote/phone";
import { chatLink } from "./alerts";
import type { Surface } from "./contract";
import type { VisitorSession } from "./visits";

// The owner's instant alert (email and Telegram, lib/lead-alerts) when someone starts a help chat on BuPulse's own
// marketing site: the "public" surface (docs/SUPPORT_CHAT.md section 1), where a visitor fills in the pre-chat form
// (name, email, business, WhatsApp) before the first message goes. Once per new conversation, never per message, and
// not for chats from the client dashboard, creator pages or link-in-bio pages (those are clients' and creators' help).

/** Only a brand-new chat on the marketing site alerts the owner. Pure. */
export function shouldAlertSupportChat(i: { surface: Surface; newConversation: boolean }): boolean {
  return i.newConversation && i.surface === "public";
}

/** The alert for a new chat: the visitor's details from the pre-chat form, and their first message. Pure. */
export function supportChatAlert(session: VisitorSession, conversationId: string, firstText: string, at: Date): LeadAlert {
  const v = session.visitor;
  return {
    kind: "support_chat",
    name: v.name?.trim() || "A visitor",
    // The form's WhatsApp number is free text; it gets tap-to-call and WhatsApp links only when it reads as a number.
    phone: v.phone ? (normaliseQuotePhone(v.phone) ?? null) : null,
    email: v.email ?? null,
    company: v.businessName ?? null,
    note: firstText.trim() || null,
    source: null,
    page: null,
    at,
    openUrl: chatLink(conversationId),
  };
}

/** The page the visitor is on (the visit's current path), as a full address; null when unknown. */
async function visitPage(visitId: string): Promise<string | null> {
  const visit = await prisma.supportVisit.findUnique({ where: { id: visitId }, select: { currentPath: true } }).catch(() => null);
  return visit?.currentPath?.startsWith("/") ? `${publicSiteUrl()}${visit.currentPath}` : null;
}

/** Sends the alert after the response when the chat qualifies. Never throws and never delays the chat. */
export async function alertNewSupportChat(session: VisitorSession, conversationId: string, firstText: string, newConversation = true): Promise<void> {
  if (!shouldAlertSupportChat({ surface: session.surface, newConversation })) return;
  const at = new Date();
  try {
    await alertInBackground(async () => ({ ...supportChatAlert(session, conversationId, firstText, at), page: await visitPage(session.visitId) }), "support chat lead alert");
  } catch {
    // alertInBackground never throws; this only guards the chat against a programming error here.
  }
}
