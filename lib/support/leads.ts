import "server-only";
import { prisma } from "@/lib/db";
import { SUPPORT_LEAD_KIND } from "./prechat";

// BuPulse's own leads from the help chat's form (prechat.ts: ContactRequest rows of kind "support_chat"), for Admin ->
// Live chat's Chat leads tab: newest first, with the person's latest chat to open in the support app.

export const SUPPORT_LEADS_PAGE = 50;

export type SupportLead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  /** The first question they asked. */
  message: string;
  createdAt: string;
  /** Their latest help chat, or null when none was found. */
  conversationId: string | null;
};

const ID = /^[a-z0-9]{10,40}$/i;

/** `limit` at a time (1 to 100); `after` is the last id of the page before. */
export async function listSupportLeads({ after, limit = SUPPORT_LEADS_PAGE }: { after?: string | null; limit?: number } = {}): Promise<{ items: SupportLead[]; next: string | null }> {
  const take = Math.min(Math.max(limit, 1), 100);
  const rows = await prisma.contactRequest.findMany({
    where: { kind: SUPPORT_LEAD_KIND },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: { id: true, name: true, email: true, phone: true, businessName: true, message: true, createdAt: true },
    ...(after && ID.test(after) ? { cursor: { id: after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  const visitors = page.length
    ? await prisma.supportVisitor.findMany({ where: { leadId: { in: page.map((r) => r.id) } }, select: { leadId: true, conversations: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } } } })
    : [];
  // Two visitor rows (two browsers) can share a lead: the newest chat of either.
  const chatOf = new Map<string, { id: string; at: number }>();
  for (const v of visitors) {
    const c = v.conversations[0];
    if (!v.leadId || !c) continue;
    const seen = chatOf.get(v.leadId);
    if (!seen || seen.at < c.createdAt.getTime()) chatOf.set(v.leadId, { id: c.id, at: c.createdAt.getTime() });
  }
  return {
    items: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), conversationId: chatOf.get(r.id)?.id ?? null })),
    next: rows.length > take ? (page.at(-1)?.id ?? null) : null,
  };
}
