// The inbox filters, shared by the page and the CSV export so both show the same leads.
import type { Prisma } from "@/lib/generated/prisma/client";

export const LEAD_STATUSES = ["NEW", "CONTACTED", "WON", "LOST"] as const;
export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const STATUS_LABELS: Record<LeadStatusValue, string> = { NEW: "New", CONTACTED: "Contacted", WON: "Won", LOST: "Lost" };

export const SOURCES = ["website_chat", "instagram", "contact_form"] as const;
export const SOURCE_LABELS: Record<string, string> = { website_chat: "Website chat", instagram: "Instagram", contact_form: "Contact form" };

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;
export const MAX_EXPORT = 10000;

export type LeadFilters = { status?: LeadStatusValue; source?: string; q?: string };

export function isLeadStatus(value: unknown): value is LeadStatusValue {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}

type Raw = string | string[] | undefined | null;
const first = (value: Raw) => (Array.isArray(value) ? value[0] : value) ?? undefined;

/** Reads filters from URL search params; anything unknown is ignored. */
export function parseFilters(params: Record<string, Raw> | URLSearchParams): LeadFilters {
  const get = (key: string): string | undefined => (params instanceof URLSearchParams ? (params.get(key) ?? undefined) : first(params[key]));
  const status = get("status")?.toUpperCase();
  const source = get("source")?.trim();
  const q = get("q")?.trim().slice(0, 100);
  return {
    ...(isLeadStatus(status) ? { status } : {}),
    ...(source && /^[a-z_]{1,40}$/.test(source) ? { source } : {}),
    ...(q ? { q } : {}),
  };
}

/** Always scoped to the business: there is no way to build a filter that reaches another business's leads. */
export function leadWhere(businessId: string, filters: LeadFilters = {}): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { businessId };
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" as const };
    where.OR = [{ name: contains }, { email: contains }, { phone: contains }, { interest: contains }, { message: contains }, { notes: contains }];
  }
  return where;
}
