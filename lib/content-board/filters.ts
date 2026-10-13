// The Content page's filters (docs/CONTENT.md): read from the URL so a filtered view can be shared, and turned into
// one Prisma query on the server. Pure (no server imports): the page, the filter sheet and the tests share it.
import type { Prisma } from "@/lib/generated/prisma/client";
import { addDays, dayKey, parseDayKey, zonedTimeToUtc } from "@/lib/publishing/time";
import { NETWORKS, type Network } from "@/lib/social/types";
import { isPostKind, type PostKind } from "./kind";

export const STATUS_FILTERS = ["review", "scheduled", "posted", "failed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { review: "Needs review", scheduled: "Scheduled", posted: "Posted", failed: "Failed" };

/** The post statuses behind each filter. Drafts wait for the owner too, so they count as "Needs review". */
export const STATUS_GROUPS: Record<StatusFilter, readonly string[]> = {
  review: ["PENDING_APPROVAL", "DRAFT"],
  scheduled: ["SCHEDULED", "PUBLISHING", "NEEDS_ACTION"],
  posted: ["PUBLISHED"],
  failed: ["FAILED"],
};

/** Cancelled posts are history: never listed or counted. */
export const LISTED_STATUSES = Object.values(STATUS_GROUPS).flat();

export const DATE_RANGES = ["today", "7d", "30d", "custom"] as const;
export type DateRange = (typeof DATE_RANGES)[number];
export const DATE_RANGE_LABEL: Record<DateRange, string> = { today: "Today", "7d": "7 days", "30d": "30 days", custom: "Custom" };

/** "created": when the post was made. "planned": when it is scheduled or was posted. */
export type DateField = "created" | "planned";

export const SUBJECT_SORTS = ["recent", "review", "name"] as const;
export type SubjectSort = (typeof SUBJECT_SORTS)[number];
export const SUBJECT_SORT_LABEL: Record<SubjectSort, string> = { recent: "Latest activity", review: "Most to review", name: "Name A to Z" };

export const PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 240;

export interface ContentFilters {
  apps: Network[];
  kinds: PostKind[];
  statuses: StatusFilter[];
  dateField: DateField;
  range?: DateRange;
  /** "YYYY-MM-DD", only with range "custom". */
  from?: string;
  to?: string;
  /** Only posts auto-approval scheduled. */
  auto: boolean;
  /** Search: subject names on the grid, post text on a subject's posts. */
  q?: string;
  sort: SubjectSort;
  limit: number;
}

export const EMPTY_FILTERS: ContentFilters = { apps: [], kinds: [], statuses: [], dateField: "created", auto: false, sort: "recent", limit: PAGE_SIZE };

type Raw = string | string[] | undefined | null;
type Params = Record<string, Raw> | URLSearchParams;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string | undefined): string | undefined {
  if (!value || !DAY.test(value)) return undefined;
  const { year, month, day } = parseDayKey(value);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? value : undefined;
}

/** A comma list ("instagram,tiktok") or repeated params, keeping only allowed values, in their canonical order. */
function list<T extends string>(raw: string[], allowed: readonly T[]): T[] {
  const wanted = new Set(raw.flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()));
  return allowed.filter((a) => wanted.has(a));
}

/** Reads the filters from URL search params. Anything unknown or malformed is ignored, never an error. */
export function parseContentFilters(params: Params): ContentFilters {
  const all = (key: string): string[] => {
    if (params instanceof URLSearchParams) return params.getAll(key);
    const v = params[key];
    return v == null ? [] : Array.isArray(v) ? v : [v];
  };
  const get = (key: string) => all(key)[0];

  const rangeRaw = get("range");
  let range = (DATE_RANGES as readonly string[]).includes(rangeRaw ?? "") ? (rangeRaw as DateRange) : undefined;
  let from = range === "custom" ? validDay(get("from")) : undefined;
  let to = range === "custom" ? validDay(get("to")) : undefined;
  if (range === "custom") {
    if (!from && !to) range = undefined;
    else if (from && to && from > to) [from, to] = [to, from];
  }
  const sortRaw = get("sort");
  const limitRaw = Number(get("limit"));
  const q = get("q")?.trim().slice(0, 100);
  return {
    apps: list(all("app"), NETWORKS),
    kinds: list(all("type"), ["post", "carousel", "video", "article"] as const).filter(isPostKind),
    statuses: list(all("status"), STATUS_FILTERS),
    dateField: get("date") === "planned" ? "planned" : "created",
    ...(range ? { range } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    auto: get("auto") === "1",
    ...(q ? { q } : {}),
    sort: (SUBJECT_SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as SubjectSort) : "recent",
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.ceil(limitRaw), MAX_PAGE_SIZE) : PAGE_SIZE,
  };
}

/** The filters as a query string ("" when none), in a stable order. `limit` is left out unless asked for. */
export function contentQuery(filters: Partial<ContentFilters>, options: { limit?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (filters.apps?.length) p.set("app", filters.apps.join(","));
  if (filters.kinds?.length) p.set("type", filters.kinds.join(","));
  if (filters.statuses?.length) p.set("status", filters.statuses.join(","));
  if (filters.range) {
    if (filters.dateField === "planned") p.set("date", "planned");
    p.set("range", filters.range);
    if (filters.range === "custom") {
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
    }
  }
  if (filters.auto) p.set("auto", "1");
  if (filters.q) p.set("q", filters.q);
  if (filters.sort && filters.sort !== "recent") p.set("sort", filters.sort);
  if (options.limit && filters.limit && filters.limit !== PAGE_SIZE) p.set("limit", String(filters.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** How many filters are on (for the "Filters (3)" button). Search and sort are not filters. */
export function activeFilterCount(f: ContentFilters): number {
  return f.apps.length + f.kinds.length + f.statuses.length + (f.range ? 1 : 0) + (f.auto ? 1 : 0);
}

/**
 * The [start, end) instants of the date filter, in the business's zone. Created: the last N days up to the end of today.
 * Planned: N days back and N days ahead (posted ones are in the past, scheduled ones ahead), today counting once.
 */
export function dateWindow(f: Pick<ContentFilters, "range" | "from" | "to" | "dateField">, zone: string, now: Date): { gte?: Date; lt?: Date } | null {
  if (!f.range) return null;
  const today = dayKey(now, zone);
  const at = (key: string) => {
    const { year, month, day } = parseDayKey(key);
    return zonedTimeToUtc(year, month, day, 0, 0, zone);
  };
  if (f.range === "custom") return { ...(f.from ? { gte: at(f.from) } : {}), ...(f.to ? { lt: at(addDays(f.to, 1)) } : {}) };
  const days = f.range === "today" ? 1 : f.range === "7d" ? 7 : 30;
  const end = f.dateField === "planned" ? addDays(today, days) : addDays(today, 1);
  return { gte: at(addDays(today, -(days - 1))), lt: at(end) };
}

export type ContentScope = { kind: "product"; id: string } | { kind: "campaign"; id: string } | { kind: "general" };

/**
 * One Prisma filter for the Content page. Always scoped to the business (no input reaches another business's posts)
 * and never lists cancelled posts. `ignore` leaves parts out (the grid counts every status, so it drops `statuses`).
 */
export function contentWhere(
  businessId: string,
  f: ContentFilters,
  ctx: { zone: string; now: Date; scope?: ContentScope | null; ignore?: ("statuses" | "q")[] },
): Prisma.PostWhereInput {
  const and: Prisma.PostWhereInput[] = [];
  const statuses = ctx.ignore?.includes("statuses") || f.statuses.length === 0 ? LISTED_STATUSES : f.statuses.flatMap((s) => STATUS_GROUPS[s]);
  const where: Prisma.PostWhereInput = { businessId, status: { in: [...statuses] as Prisma.EnumPostStatusFilter["in"] } };
  if (f.apps.length) where.network = { in: f.apps };
  if (f.kinds.length) where.mediaKind = { in: f.kinds };
  if (f.auto) where.autoScheduledAt = { not: null };
  const scope = ctx.scope;
  if (scope?.kind === "product") where.productId = scope.id;
  else if (scope?.kind === "campaign") where.campaignId = scope.id;
  else if (scope?.kind === "general") Object.assign(where, { productId: null, campaignId: null });
  const window = dateWindow(f, ctx.zone, ctx.now);
  if (window) {
    if (f.dateField === "created") where.createdAt = window;
    else and.push({ OR: [{ publishedAt: window }, { publishedAt: null, scheduledAt: window }] });
  }
  if (f.q && !ctx.ignore?.includes("q")) and.push({ OR: [{ text: { contains: f.q, mode: "insensitive" } }, { title: { contains: f.q, mode: "insensitive" } }] });
  if (and.length) where.AND = and;
  return where;
}

/** Local midnight today, for "created today". */
export function startOfToday(zone: string, now: Date): Date {
  const { year, month, day } = parseDayKey(dayKey(now, zone));
  return zonedTimeToUtc(year, month, day, 0, 0, zone);
}
