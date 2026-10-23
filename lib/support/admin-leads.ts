import "server-only";
import { prisma } from "@/lib/db";

// Chat leads for Admin -> Live chat: the people who filled in the help chat's form (name, email, business, WhatsApp)
// and their first question. sc-core stores them as ContactRequest rows of kind "support_chat" and will expose
// listSupportLeads({ after, limit }) in lib/support/leads.ts: when it lands, chatLeads calls it instead of the query
// below. The page only uses chatLeads and ChatLead.

export const SUPPORT_LEAD_KIND = "support_chat";
export const CHAT_LEADS_PAGE = 50;

export type ChatLead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  /** The first question they asked. */
  message: string;
  createdAt: string;
  /** Their latest help chat, to open in the support app; null when none was found. */
  conversationId: string | null;
};

const ID = /^[a-z0-9]{10,40}$/i;

/** Newest first, `limit` at a time; `after` is the last id of the page before. */
export async function chatLeads({ after, limit = CHAT_LEADS_PAGE }: { after?: string | null; limit?: number } = {}): Promise<{ items: ChatLead[]; next: string | null }> {
  const take = Math.min(Math.max(limit, 1), 100);
  const rows = await prisma.contactRequest.findMany({
    where: { kind: SUPPORT_LEAD_KIND },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(after && ID.test(after) ? { cursor: { id: after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  // The pre-chat form links the visitor to its lead (SupportVisitor.leadId); their newest chat is the one to open.
  const visitors = page.length
    ? await prisma.supportVisitor.findMany({
        where: { leadId: { in: page.map((r) => r.id) } },
        select: { leadId: true, conversations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
      })
    : [];
  const chatOf = new Map(visitors.map((v) => [v.leadId, v.conversations[0]?.id ?? null]));
  return {
    items: page.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, businessName: r.businessName, message: r.message, createdAt: r.createdAt.toISOString(), conversationId: chatOf.get(r.id) ?? null })),
    next: rows.length > take ? (page.at(-1)?.id ?? null) : null,
  };
}
