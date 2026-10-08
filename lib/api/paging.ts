export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** ?limit= (1..100, default 25) and ?cursor= (the id from the previous page's nextCursor). */
export function parsePaging(params: URLSearchParams): { limit: number; cursor: string | null } | { error: string } {
  const raw = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (raw !== null) {
    limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}.` };
  }
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length === 0 || cursor.length > 64 || !/^[A-Za-z0-9_-]+$/.test(cursor))) return { error: "cursor is not valid." };
  return { limit, cursor };
}

/** Prisma args for newest-first paging; fetch limit + 1 rows to know if there is another page. */
export function pageArgs(paging: { limit: number; cursor: string | null }) {
  return {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: paging.limit + 1,
    ...(paging.cursor ? { cursor: { id: paging.cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }>(rows: T[], limit: number): { data: T[]; nextCursor: string | null } {
  const data = rows.slice(0, limit);
  return { data, nextCursor: rows.length > limit ? data[data.length - 1].id : null };
}
