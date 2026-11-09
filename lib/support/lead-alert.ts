import "server-only";
import { prisma } from "@/lib/db";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { ALERT_CHANNELS, alertInBackground, telegramChannel } from "@/lib/lead-alerts/channels";
import type { LeadAlert } from "@/lib/lead-alerts/format";
import { waitUntil } from "@/lib/platform/background";
import { normaliseQuotePhone } from "@/lib/quote/phone";
import { chatLink, pushToAgents } from "./alerts";
import type { Surface } from "./contract";
import type { VisitorSession } from "./visits";

// The owner's and agents' alerts about the support chat (docs/SUPPORT_CHAT.md section 3, "Alerts for a new chat or a
// hand-over"), on the channels that already exist: web push to the agents on duty (lib/support/alerts.ts), and the
// owner's lead alerts (email and Telegram, lib/lead-alerts).
//
// - A new chat, any surface: a push to the agents on duty. On BuPulse's own marketing site (the "public" surface, where
//   a visitor fills in the pre-chat form: name, email, business, WhatsApp) also the owner's email and Telegram alert,
//   once per new conversation, never per message.
// - A hand-over (the chat waits for a person), any surface: in team hours a Telegram ping to the owner at once (the
//   agents on duty get a push at once and an email after 2 minutes, lib/support/jobs.ts, which falls back to the admin
//   addresses when nobody is on duty); outside team hours (a ticket) the owner's email and Telegram, since nobody is on
//   duty to see a push.
// Everything runs after the response and never throws into the chat.

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
async function visitPage(visitId: string | null): Promise<string | null> {
  if (!visitId) return null;
  const visit = await prisma.supportVisit.findUnique({ where: { id: visitId }, select: { currentPath: true } }).catch(() => null);
  return visit?.currentPath?.startsWith("/") ? `${publicSiteUrl()}${visit.currentPath}` : null;
}

/** Sends the alerts for a new chat after the response. Never throws and never delays the chat. */
export async function alertNewSupportChat(session: VisitorSession, conversationId: string, firstText: string, newConversation = true): Promise<void> {
  if (!newConversation) return;
  try {
    // pushToAgents never throws; off without VAPID keys or agents on duty.
    waitUntil(pushToAgents(conversationId, "New chat"));
    if (!shouldAlertSupportChat({ surface: session.surface, newConversation })) return;
    const at = new Date();
    await alertInBackground(async () => ({ ...supportChatAlert(session, conversationId, firstText, at), page: await visitPage(session.visitId) }), "support chat lead alert");
  } catch {
    // alertInBackground never throws; this only guards the chat against a programming error here.
  }
}

/** Where a chat started, as the alert's source line. */
const SURFACE_SOURCE: Record<string, string> = { public: "website chat", dashboard: "client dashboard chat", creator: "creator page chat", bio: "link in bio chat" };

type WaitingChat = {
  number: number;
  surface: string;
  visitId: string | null;
  visitor: { name: string | null; email: string | null; phone: string | null; businessName: string | null };
};

/** The alert for a chat that waits for a person (a hand-over). Pure. */
export function waitingChatAlert(c: WaitingChat & { company?: string | null }, conversationId: string, lastText: string | null, reason: string, away: boolean, at: Date): LeadAlert {
  const v = c.visitor;
  return {
    kind: "support_waiting",
    name: v.name?.trim() || "A visitor",
    phone: v.phone ? (normaliseQuotePhone(v.phone) ?? null) : null,
    email: v.email ?? null,
    company: v.businessName ?? c.company ?? null,
    note: lastText?.trim() || null,
    source: SURFACE_SOURCE[c.surface] ?? null,
    page: null,
    at,
    openUrl: chatLink(conversationId),
    chat: { number: c.number, reason, away },
  };
}

/** Builds the waiting-chat alert from the database (in the background). */
async function loadWaitingAlert(conversationId: string, reason: string, away: boolean, at: Date): Promise<LeadAlert> {
  const c = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    select: { number: true, surface: true, visitId: true, visitor: { select: { name: true, email: true, phone: true, businessName: true, businessId: true } } },
  });
  if (!c) throw new Error(`chat ${conversationId} not found for its hand-over alert`);
  const [last, business, page] = await Promise.all([
    prisma.supportMessage.findFirst({ where: { conversationId, author: "VISITOR" }, orderBy: { createdAt: "desc" }, select: { body: true } }).catch(() => null),
    // A signed-in client's chat has their company on the account, not in a pre-chat form.
    !c.visitor.businessName && c.visitor.businessId ? prisma.business.findUnique({ where: { id: c.visitor.businessId }, select: { name: true } }).catch(() => null) : null,
    visitPage(c.visitId),
  ]);
  return { ...waitingChatAlert({ ...c, company: business?.name ?? null }, conversationId, last?.body.slice(0, 500) ?? null, reason, away, at), page };
}

/**
 * The owner's alert when a chat is handed over to people. In team hours Telegram only (agents also get a push now and
 * an email after 2 minutes, so a missing Telegram is not an error); outside team hours email and Telegram.
 */
export async function alertWaitingChat(conversationId: string, reason: string, away: boolean): Promise<void> {
  const at = new Date();
  try {
    await alertInBackground(() => loadWaitingAlert(conversationId, reason, away, at), "support hand-over alert", away ? ALERT_CHANNELS : [telegramChannel], { quietIfNone: !away });
  } catch {
    // alertInBackground never throws; this only guards the hand-over against a programming error here.
  }
}
