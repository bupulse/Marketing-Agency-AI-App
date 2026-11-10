// Where visitors came from, as donut slices: the five biggest sources and the rest added up as "Other". Each known
// source keeps its own colour slot whatever the period (Google is always orange), so changing the period never repaints
// a source; an unknown source (a website or a campaign name) takes the first slot no known source on screen is using.

export type SourceSlice = { key: string; value: number; slot: number | null };

/** Fixed slots (0-based, in the validated categorical order) for the sources people see most. */
export const SOURCE_SLOTS: Record<string, number> = { direct: 0, google: 1, whatsapp: 2, facebook: 3, instagram: 4, tiktok: 5, linkedin: 6 };

export function sourceSlices(rows: { key: string; visitors: number }[], top = 5): SourceSlice[] {
  const sorted = [...rows].filter((r) => r.visitors > 0).sort((a, b) => b.visitors - a.visitors);
  const shown = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((s, r) => s + r.visitors, 0);
  const used = new Set(shown.map((r) => SOURCE_SLOTS[r.key]).filter((s) => s !== undefined));
  const free = [7, 6, 5, 4, 3, 2, 1, 0].filter((s) => !used.has(s));
  const out: SourceSlice[] = shown.map((r) => {
    let slot = SOURCE_SLOTS[r.key];
    if (slot === undefined) slot = free.shift() ?? 7;
    return { key: r.key, value: r.visitors, slot };
  });
  if (rest > 0) out.push({ key: "__other", value: rest, slot: null });
  return out;
}
