import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/admin/audit";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { QUOTE_KIND } from "./source";

// Admin -> Quote requests: the "Get a free quote" requests (ContactRequest kind "quote"), newest first, with tap-to-call
// and where each came from. "Called" (handled) takes one off the to-do list in the Inbox; it can be undone.

export const QUOTES_PAGE = 50;
export const QUOTE_FILTERS = ["open", "handled", "all"] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];
export const isQuoteFilter = (v: unknown): v is QuoteFilter => typeof v === "string" && (QUOTE_FILTERS as readonly string[]).includes(v);

export type QuoteRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  note: string | null;
  source: string | null;
  pageUrl: string | null;
  handled: boolean;
  createdAt: Date;
};

const ID = /^[a-z0-9]{10,40}$/i;

/** `limit` at a time; `after` is the last id of the page before. */
export async function listQuoteRequests({ filter = "open", after, limit = QUOTES_PAGE }: { filter?: QuoteFilter; after?: string | null; limit?: number } = {}): Promise<{ items: QuoteRow[]; next: string | null }> {
  const take = Math.min(Math.max(limit, 1), 100);
  const rows = await prisma.contactRequest.findMany({
    where: { kind: QUOTE_KIND, ...(filter === "all" ? {} : { handled: filter === "handled" }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: { id: true, name: true, email: true, phone: true, businessName: true, message: true, source: true, pageUrl: true, handled: true, createdAt: true },
    ...(after && ID.test(after) ? { cursor: { id: after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  return {
    items: page.map(({ message, ...r }) => ({ ...r, note: message })),
    next: rows.length > take ? (page.at(-1)?.id ?? null) : null,
  };
}

/** Requests nobody has marked called yet (the Inbox count). */
export function openQuoteCount(): Promise<number> {
  return prisma.contactRequest.count({ where: { kind: QUOTE_KIND, handled: false } });
}

/** Marks a request called (or back to open). Audited. */
export async function setQuoteHandled(ctx: AdminContext, id: string, handled: boolean): Promise<{ name: string }> {
  if (!ID.test(id)) throw new AdminError("invalid", "That request was not found.");
  const row = await prisma.contactRequest.findFirst({ where: { id, kind: QUOTE_KIND }, select: { id: true, name: true, handled: true } });
  if (!row) throw new AdminError("not_found", "That request was not found.");
  if (row.handled === handled) return { name: row.name };
  await prisma.$transaction(async (tx) => {
    await tx.contactRequest.update({ where: { id }, data: { handled } });
    await writeAudit(tx, ctx, handled ? "quote_called" : "quote_reopened", `quote:${id}`, { handled: row.handled }, { handled });
  });
  return { name: row.name };
}
