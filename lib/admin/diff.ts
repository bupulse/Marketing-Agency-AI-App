export type DiffRow = { path: string; before: unknown; after: unknown; kind: "added" | "removed" | "changed" };

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Flat list of what differs between two JSON values, by dotted path. */
export function diffJson(before: unknown, after: unknown, path = ""): DiffRow[] {
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffJson(before[k], after[k], path ? `${path}.${k}` : k));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const p = path || "(value)";
  if (before === undefined || before === null) return [{ path: p, before, after, kind: "added" }];
  if (after === undefined || after === null) return [{ path: p, before, after, kind: "removed" }];
  return [{ path: p, before, after, kind: "changed" }];
}

export const show = (v: unknown) => (v === undefined || v === null ? "(none)" : typeof v === "string" ? v : JSON.stringify(v));
