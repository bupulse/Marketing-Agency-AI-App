// Pure helpers for the URL-based filters (FilterChips, ChoiceTiles): a page stays a server component and reads its
// choice from searchParams; each chip is a plain link to the same page with one parameter changed.

export type SearchParamsLike = Record<string, string | string[] | undefined>;

/** Parameters that never survive a filter change: one-off messages and the page number of a list. */
export const DROPPED_ON_FILTER = ["notice", "error", "page", "cursor", "before", "after"] as const;

/**
 * The page's URL with `key` set to `value` (or removed when `value` is the "all" value), keeping the other current
 * parameters (the first value of a repeated one) and dropping messages and paging.
 */
export function hrefWith(base: string, params: SearchParamsLike | undefined, key: string, value: string, allValue = ""): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (k === key || (DROPPED_ON_FILTER as readonly string[]).includes(k)) continue;
    const first = Array.isArray(v) ? v[0] : v;
    if (first != null && first !== "") next.set(k, first);
  }
  if (value !== allValue) next.set(key, value);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

/** The current choice of a filter: the parameter's first value when it is one of the options, otherwise the fallback. */
export function chosen(params: SearchParamsLike | undefined, key: string, values: readonly string[], fallback = ""): string {
  const raw = params?.[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v != null && values.includes(v) ? v : fallback;
}
