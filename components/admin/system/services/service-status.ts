// Admin -> Services: a service's state in words, which filter chip it falls under, and "3 h ago". Pure.
// Tests: tests/admin-system/service-status.test.ts.

import type { PillTone } from "@/components/admin/kit";

export type ServiceHealth = "off" | "down" | "missing" | "not_connected" | "ok" | "untested" | "not_in_use";

export const HEALTH_PILL: Record<ServiceHealth, { label: string; tone: PillTone }> = {
  ok: { label: "Working", tone: "good" },
  down: { label: "Down", tone: "bad" },
  missing: { label: "Key missing", tone: "bad" },
  not_connected: { label: "Not connected", tone: "muted" },
  off: { label: "Switched off", tone: "new" },
  untested: { label: "Not tested yet", tone: "info" },
  not_in_use: { label: "Not in use", tone: "muted" },
};

/** The filter chips on the Services page, in order. "" is every service. */
export const SERVICE_FILTERS = ["", "attention", "working", "untested", "setup"] as const;
export type ServiceFilter = (typeof SERVICE_FILTERS)[number];

export const FILTER_LABEL: Record<ServiceFilter, string> = { "": "All", attention: "Needs you", working: "Working", untested: "Not tested", setup: "Not set up" };

/** Which chip a service falls under: down, missing keys or switched off need the owner. */
export function serviceFilterOf(health: ServiceHealth): Exclude<ServiceFilter, ""> {
  if (health === "down" || health === "missing" || health === "off") return "attention";
  if (health === "ok") return "working";
  if (health === "untested") return "untested";
  return "setup";
}

/** Broken (down, or a core key missing): the only states drawn in red. Switched off on purpose is violet. */
export const isBroken = (health: ServiceHealth) => health === "down" || health === "missing";

/** The icon badge colour for a state. */
export function serviceTone(health: ServiceHealth): "red" | "violet" | "green" | "slate" {
  return isBroken(health) ? "red" : health === "off" ? "violet" : health === "ok" ? "green" : "slate";
}

const ORDER:Record<ServiceHealth, number> = { down: 0, missing: 1, off: 2, untested: 3, ok: 4, not_connected: 5, not_in_use: 6 };

/** Services that need the owner first, then the rest; the catalogue order within each state. */
export function sortServices<T extends { health: ServiceHealth }>(list: readonly T[]): T[] {
  return list.map((s, i) => ({ s, i })).sort((a, b) => ORDER[a.s.health] - ORDER[b.s.health] || a.i - b.i).map((x) => x.s);
}

/** How many services each chip shows. */
export function filterCounts(list: readonly { health: ServiceHealth }[]): Record<ServiceFilter, number> {
  const out: Record<ServiceFilter, number> = { "": list.length, attention: 0, working: 0, untested: 0, setup: 0 };
  for (const s of list) out[serviceFilterOf(s.health)] += 1;
  return out;
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(at: Date | string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(at).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}
