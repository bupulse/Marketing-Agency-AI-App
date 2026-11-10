// Pure helpers for the Live chat hub (components/admin/live-chat/hub.tsx): one plain line per card.
import type { AgentAdminView } from "@/lib/support/agents";
import type { SupportSettings } from "@/lib/support/settings";
import { WEEKDAYS } from "@/lib/support/settings-form";

const SHORT: Record<string, string> = { "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat", "0": "Sun" };

/** "Mon–Sat 08:00–20:00 · Sun closed": the team's week, Monday first, days with the same hours run together. */
export function hoursSummary(hours: SupportSettings["hours"]): string {
  const days = WEEKDAYS.map(({ key }) => {
    const r = hours[key]?.[0];
    return { key, text: r ? `${r.from}–${r.to}${(hours[key]?.length ?? 0) > 1 ? " +" : ""}` : "closed" };
  });
  const runs: { from: string; to: string; text: string }[] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && last.text === d.text) last.to = d.key;
    else runs.push({ from: d.key, to: d.key, text: d.text });
  }
  if (runs.length === 1) return runs[0].text === "closed" ? "Closed every day" : `Every day ${runs[0].text}`;
  return runs.map((r) => `${SHORT[r.from]}${r.from === r.to ? "" : `–${SHORT[r.to]}`} ${r.text}`).join(" · ");
}

/** How many agents are in each state (pending: asked to join on the support app, waiting for an answer). */
export function agentCounts(agents: Pick<AgentAdminView, "status">[]) {
  const by = (s: string) => agents.filter((a) => a.status === s).length;
  return { total: agents.length, active: by("active"), invited: by("invited"), pending: by("pending"), locked: by("locked") };
}
