import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { runInBackground } from "./background";
import { LEAD_STATUSES, MAX_PAGE_SIZE, PAGE_SIZE, leadWhere, type LeadFilters, type LeadStatusValue } from "./filters";
import { notifyNewLead } from "./notify";
import { cleanText, normalizeEmail, normalizePageUrl, normalizePhone } from "./normalize";

export type CreateLeadInput = {
  businessId: string;
  sessionId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  interest?: string | null;
  message?: string | null;
  pageUrl?: string | null;
};

export class LeadError extends Error {
  constructor(
    public code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Details that survive cleaning. Anything empty or malformed is left out, so it can never erase a stored value. */
function cleanDetails(input: CreateLeadInput) {
  const details = {
    name: cleanText(input.name, 120),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    interest: cleanText(input.interest, 300),
    message: cleanText(input.message, 2000),
    pageUrl: normalizePageUrl(input.pageUrl),
  };
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined)) as Partial<typeof details>;
}

/**
 * Called by the chat widget when a visitor leaves details. One lead per chat session: a second call
 * merges new details into the same lead and never erases what is already there. Only the first call
 * (the one that claims notifiedAt) sends the owner's instant email and the webhook, in the background.
 */
export async function createLeadFromChat(input: CreateLeadInput): Promise<{ id: string; created: boolean }> {
  const session = await prisma.chatSession.findFirst({ where: { id: input.sessionId, businessId: input.businessId }, select: { id: true } });
  if (!session) throw new LeadError("not_found", "That chat does not belong to this business.");
  const details = cleanDetails(input);

  let id: string;
  let created = false;
  const existing = await prisma.lead.findUnique({ where: { sessionId: session.id }, select: { id: true, businessId: true } });
  if (existing) {
    id = existing.id;
  } else {
    try {
      const lead = await prisma.lead.create({
        data: { businessId: input.businessId, sessionId: session.id, source: "website_chat", ...details },
        select: { id: true },
      });
      id = lead.id;
      created = true;
    } catch (error) {
      // Two submits at the same moment: the other one created it first, so this one merges.
      if (!isUniqueViolation(error)) throw error;
      const lead = await prisma.lead.findUnique({ where: { sessionId: session.id }, select: { id: true } });
      if (!lead) throw error;
      id = lead.id;
    }
  }

  if (!created && Object.keys(details).length > 0) {
    await prisma.lead.update({ where: { id }, data: details });
  }

  // The claim is atomic: of any number of parallel or repeated calls, exactly one updates the row.
  const claimed = await prisma.lead.updateMany({ where: { id, notifiedAt: null }, data: { notifiedAt: new Date() } });
  if (claimed.count === 1) runInBackground(() => notifyNewLead(id), "new lead notification");
  return { id, created };
}

// ---- Inbox: every function takes the businessId of the signed-in owner and scopes by it -----------------------

export const leadListSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  interest: true,
  message: true,
  source: true,
  status: true,
  notes: true,
  pageUrl: true,
  createdAt: true,
} satisfies Prisma.LeadSelect;

export async function listLeads(businessId: string, filters: LeadFilters, limit = PAGE_SIZE) {
  const take = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({ where: leadWhere(businessId, filters), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, select: leadListSelect }),
    prisma.lead.count({ where: leadWhere(businessId, filters) }),
  ]);
  return { leads: rows.slice(0, take), hasMore: rows.length > take, total };
}

/** Counts per status for the filter chips (ignores the status filter itself). */
export async function statusCounts(businessId: string, filters: LeadFilters): Promise<Record<LeadStatusValue | "ALL", number>> {
  const groups = await prisma.lead.groupBy({ by: ["status"], where: leadWhere(businessId, { ...filters, status: undefined }), _count: { _all: true } });
  const counts = { ALL: 0, NEW: 0, CONTACTED: 0, WON: 0, LOST: 0 } as Record<LeadStatusValue | "ALL", number>;
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }
  return counts;
}

export async function leadSources(businessId: string): Promise<string[]> {
  const rows = await prisma.lead.findMany({ where: { businessId }, distinct: ["source"], select: { source: true } });
  return rows.map((r) => r.source).sort();
}

export async function hasAnyLead(businessId: string): Promise<boolean> {
  return (await prisma.lead.count({ where: { businessId }, take: 1 })) > 0;
}

/** One lead with its chat, only if it belongs to the business. */
export async function getLeadDetail(businessId: string, id: string) {
  const lead = await prisma.lead.findFirst({
    where: { id, businessId },
    select: { ...leadListSelect, session: { select: { origin: true, language: true, messages: { orderBy: { createdAt: "asc" }, take: 300, select: { id: true, role: true, content: true, createdAt: true } } } } },
  });
  return lead;
}

function ids(values: string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === "string" && v.length > 0 && v.length <= 60))].slice(0, 200);
}

export async function setLeadStatus(businessId: string, leadIds: string[], status: LeadStatusValue): Promise<number> {
  if (!LEAD_STATUSES.includes(status)) throw new LeadError("invalid", "Choose a status.");
  const result = await prisma.lead.updateMany({ where: { id: { in: ids(leadIds) }, businessId }, data: { status } });
  return result.count;
}

export async function setLeadNotes(businessId: string, id: string, notes: string): Promise<boolean> {
  const result = await prisma.lead.updateMany({ where: { id, businessId }, data: { notes: cleanText(notes, 5000) ?? null } });
  return result.count === 1;
}

export async function deleteLeads(businessId: string, leadIds: string[]): Promise<number> {
  const result = await prisma.lead.deleteMany({ where: { id: { in: ids(leadIds) }, businessId } });
  return result.count;
}
