// The Content page's grid (docs/CONTENT.md): one card per product, one per campaign and a "General" card for posts
// tied to neither (tips, brand posts), each with its post counts. Pure: the server passes rows, the tests pass fixtures.
import { STATUS_GROUPS, type ContentFilters, type StatusFilter, type SubjectSort } from "./filters";

export type SubjectKind = "product" | "campaign" | "general";

export interface SubjectRow {
  id: string;
  name: string;
  /** "Physical product", "Service", "Event"... */
  label: string;
  status: string;
  updatedAt: Date;
  /** First album photo (storage path), or null. */
  coverPath: string | null;
}

/** One `post.groupBy(["productId", "campaignId", "status"])` row. */
export interface CountRow {
  productId: string | null;
  campaignId: string | null;
  status: string;
  count: number;
  /** Newest post in the bucket. */
  lastCreatedAt: Date | null;
}

export type Counts = Record<StatusFilter, number>;

export interface SubjectCard {
  key: string;
  kind: SubjectKind;
  id: string | null;
  name: string;
  label: string;
  href: string;
  coverPath: string | null;
  counts: Counts;
  total: number;
  lastActivity: Date | null;
}

export const GENERAL_NAME = "General";
export const GENERAL_LABEL = "Tips and brand posts";

export function subjectHref(kind: SubjectKind, id: string | null): string {
  if (kind === "general" || !id) return "/dashboard/content/general";
  return `/dashboard/content/${kind === "product" ? "products" : "campaigns"}/${id}`;
}

const zero = (): Counts => ({ review: 0, scheduled: 0, posted: 0, failed: 0 });

function bucketOf(status: string): StatusFilter | null {
  for (const [key, statuses] of Object.entries(STATUS_GROUPS) as [StatusFilter, readonly string[]][]) if (statuses.includes(status)) return key;
  return null;
}

/** Adds up count rows per subject key ("product:<id>", "campaign:<id>", "general"). */
export function countBySubject(rows: readonly CountRow[]): Map<string, { counts: Counts; last: Date | null }> {
  const out = new Map<string, { counts: Counts; last: Date | null }>();
  for (const row of rows) {
    const bucket = bucketOf(row.status);
    if (!bucket) continue;
    const key = row.productId ? `product:${row.productId}` : row.campaignId ? `campaign:${row.campaignId}` : "general";
    const entry = out.get(key) ?? { counts: zero(), last: null };
    entry.counts[bucket] += row.count;
    if (row.lastCreatedAt && (!entry.last || row.lastCreatedAt > entry.last)) entry.last = row.lastCreatedAt;
    out.set(key, entry);
  }
  return out;
}

const total = (c: Counts) => c.review + c.scheduled + c.posted + c.failed;

/**
 * The grid's cards. Archived products and campaigns show only when they have posts. When a post filter is on (app,
 * type, date, status, auto-scheduled), only subjects with matching posts show, so the grid answers the filter.
 * `q` searches names; `sort` orders: latest activity, most to review, or name.
 */
export function buildSubjectCards(input: {
  products: readonly SubjectRow[];
  campaigns: readonly SubjectRow[];
  counts: readonly CountRow[];
  filters: Pick<ContentFilters, "apps" | "kinds" | "statuses" | "range" | "auto" | "q" | "sort">;
}): SubjectCard[] {
  const { filters } = input;
  const byKey = countBySubject(input.counts);
  const filtering = filters.apps.length > 0 || filters.kinds.length > 0 || filters.statuses.length > 0 || Boolean(filters.range) || filters.auto;

  const card = (kind: SubjectKind, row: SubjectRow | null): SubjectCard => {
    const key = row ? `${kind}:${row.id}` : "general";
    const found = byKey.get(key);
    const counts = found?.counts ?? zero();
    return {
      key,
      kind,
      id: row?.id ?? null,
      name: row?.name ?? GENERAL_NAME,
      label: row?.label ?? GENERAL_LABEL,
      href: subjectHref(kind, row?.id ?? null),
      coverPath: row?.coverPath ?? null,
      counts,
      total: total(counts),
      lastActivity: found?.last ?? row?.updatedAt ?? null,
    };
  };

  let cards = [
    ...input.products.map((p) => ({ card: card("product", p), archived: p.status === "ARCHIVED" })),
    ...input.campaigns.map((c) => ({ card: card("campaign", c), archived: c.status === "ARCHIVED" })),
    { card: card("general", null), archived: false },
  ]
    .filter(({ card: c, archived }) => (archived ? c.total > 0 : true))
    .map(({ card: c }) => c);

  if (filtering) {
    cards = cards.filter((c) => (filters.statuses.length ? filters.statuses.some((s) => c.counts[s] > 0) : c.total > 0));
  }
  const q = filters.q?.trim().toLowerCase();
  if (q) cards = cards.filter((c) => c.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
  return sortCards(cards, filters.sort);
}

export function sortCards(cards: SubjectCard[], sort: SubjectSort): SubjectCard[] {
  const time = (c: SubjectCard) => c.lastActivity?.getTime() ?? 0;
  const byName = (a: SubjectCard, b: SubjectCard) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const sorted = [...cards];
  if (sort === "name") sorted.sort(byName);
  else if (sort === "review") sorted.sort((a, b) => b.counts.review - a.counts.review || time(b) - time(a) || byName(a, b));
  else sorted.sort((a, b) => time(b) - time(a) || byName(a, b));
  return sorted;
}
