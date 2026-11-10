// Pure month helpers for the month chips on AI calls and spend (components/admin/content-ai/ai-usage-view.tsx).

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" -> "Nov 2026" (anything else is returned as it is). */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${NAMES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** The `count` months up to and including `last` ("YYYY-MM"), newest first. */
export function recentMonths(last: string, count = 6): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(last);
  if (!m) return [];
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo -= 1;
    if (mo === 0) {
      mo = 12;
      y -= 1;
    }
  }
  return out;
}

/** The month chips: the last six months up to this one, plus the one shown when it is older (a link from Costs). */
export function monthChoices(thisMonth: string, shown: string, count = 6): string[] {
  const list = recentMonths(thisMonth, count);
  return list.includes(shown) || !/^\d{4}-\d{2}$/.test(shown) ? list : [...list, shown];
}
