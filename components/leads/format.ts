import type { LeadStatusValue } from "@/lib/leads/filters";
import type { BadgeTone } from "@/components/ui";

export const STATUS_TONE: Record<LeadStatusValue, BadgeTone> = { NEW: "violet", CONTACTED: "blue", WON: "success", LOST: "neutral" };

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function timeAgo(iso: string | Date, now = Date.now()): string {
  const date = new Date(iso);
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

export type InboxLead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string | null;
  message: string | null;
  source: string;
  status: LeadStatusValue;
  notes: string | null;
  pageUrl: string | null;
  createdAt: string;
};
