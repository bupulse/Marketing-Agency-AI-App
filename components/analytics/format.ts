export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatPct(rate: number | null): string {
  if (rate === null) return "–";
  const pct = rate * 100;
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** "2026-10-08" -> "8 Oct" (date keys carry no time, so no time-zone shift). */
export function formatShortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
