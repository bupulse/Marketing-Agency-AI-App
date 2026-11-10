// Made-up data for the admin console's dev-only preview (app/admin/preview). Placeholder names and numbers only.
import type { ShellBadges } from "@/components/admin/shell";
import type { OverviewData } from "@/components/admin/overview-dashboard";
import type { AttentionItem } from "@/lib/admin/attention";
import type { InboxKey } from "@/lib/admin/inbox";
import type { TimelineItem, TodayPayment } from "@/lib/admin/today";
import { BUILT_IN_ROLES, ALL_PERMISSIONS, type Permission } from "@/lib/staff/permissions";

/** ?role= picks a built-in role (owner by default), to check what each person sees. */
export function previewPermissions(role: string | undefined): { permissions: Permission[]; roleName?: string; email: string } {
  const r = BUILT_IN_ROLES.find((x) => x.key === role);
  if (!r || r.key === "owner") return { permissions: ALL_PERMISSIONS, email: "office@example.com" };
  return { permissions: r.permissions, roleName: r.name, email: `aline.${r.key.replace(/_/g, "")}@example.com` };
}

export const PREVIEW_COUNTS: Record<InboxKey, number> = { quotes: 3, payments: 2, approvals: 1, demos: 2, requests: 1, invoices: 1, offers: 0, contests: 0, regions: 0, reports: 1, errors: 4 };

export const PREVIEW_BADGES: ShellBadges = {
  inbox: { count: 11, tone: "danger", label: "11 items waiting in the inbox" },
  payments: { count: 2, tone: "danger", label: "2 Mobile Money payments to check" },
  approvals: { count: 1, tone: "danger", label: "1 request waiting for approval" },
  quotes: { count: 3, tone: "danger", label: "3 quote requests to call" },
  requests: { count: 1, tone: "violet", label: "1 new plan request" },
  reports: { count: 1, tone: "violet", label: "1 open creator marketplace report" },
  errors: { count: 4, tone: "neutral", label: "4 errors in the last 24 hours" },
};

export const PREVIEW_OVERVIEW: OverviewData = {
  monthLabel: "November 2026",
  prevMonthLabel: "October",
  revenue: { monthCents: 186_400, prevCents: 151_000, lifetimeCents: 1_204_000, customersEver: 41, spark: [62_000, 80_500, 97_000, 120_000, 151_000, 186_400] },
  mrrCents: 214_000,
  arpuCents: 6_300,
  rwf: { month: { rwfMinor: 2_320_000, rwfUsdCents: 160_000 }, lifetime: { rwfMinor: 14_500_000, rwfUsdCents: 1_000_000 }, mrr: { rwfMinor: 2_900_000, rwfUsdCents: 200_000 }, arpu: { rwfMinor: 87_000, rwfUsdCents: 6_000 } },
  profit: { monthCents: 92_300, prevCents: 70_100, costCents: 94_100, estimateCents: 21_000, spark: [10_000, 22_000, 35_000, 51_000, 70_100, 92_300] },
  clients: { active: 34, trial: 9, pastDue: 2, waitingDemo: 3 },
  todo: { inbox: 11, payments: 2, demosToday: 1, nextDemo: "Kigali Bakery at 14:00 UTC", errors24h: 4 },
  ai: { spentCents: 3_240, capCents: 10_000, pct: 32.4, paused: false },
};

export const PREVIEW_ATTENTION: AttentionItem[] = [
  { level: "problem", key: "service:elevenlabs", text: "ElevenLabs is failing: the key was refused (401).", href: "/admin/services" },
  { level: "warning", key: "ai-budget", text: "AI spend is at 82% of the monthly cap.", href: "/admin/ai" },
];

const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 10, h - 2, m)).toISOString();

export const PREVIEW_PAYMENTS: TodayPayment[] = [
  { id: "p1", at: at(9, 12), company: "Kigali Bakery", person: "Aline M.", usdCents: 3_448, localMinor: 50_000, currency: "RWF", amount: "RWF 50,000", method: "Mobile Money", agent: "Eric", href: "/admin/companies/b1" },
  { id: "p2", at: at(11, 40), company: "Nyamirambo Fashion", person: null, usdCents: 5_517, localMinor: 80_000, currency: "RWF", amount: "RWF 80,000", method: "Mobile Money", agent: null, href: "/admin/companies/b2" },
];

export const PREVIEW_TIMELINE: TimelineItem[] = [
  { id: "t1", at: at(13, 5), kind: "signup", text: "Remera Salon signed up and chose the Standard plan.", href: "/admin/companies/b3" },
  { id: "t2", at: at(11, 40), kind: "payment", text: "Nyamirambo Fashion paid RWF 80,000 by Mobile Money.", href: "/admin/companies/b2" },
  { id: "t3", at: at(10, 30), kind: "demo", text: "Kacyiru Dental booked a demo for tomorrow at 10:00.", href: "/admin/demos" },
  { id: "t4", at: at(9, 12), kind: "payment", text: "Kigali Bakery paid RWF 50,000 by Mobile Money.", href: "/admin/companies/b1" },
  { id: "t5", at: at(8, 50), kind: "trial", text: "Gisozi Garage started a 14-day trial.", href: "/admin/companies/b4" },
  { id: "t6", at: at(8, 20), kind: "request", text: "Kimihurura Hotel asked for a custom plan.", href: "/admin/requests" },
  { id: "t7", at: at(7, 55), kind: "cancel", text: "Kanombe Prints cancelled at the end of the month.", href: "/admin/companies/b5" },
  { id: "t8", at: at(7, 10), kind: "signup", text: "Kicukiro Cafe signed up.", href: "/admin/companies/b6" },
];

export type PreviewCompany = { id: string; name: string; plan: string; status: "Active" | "Trial" | "Past due"; mrr: string; lastSeen: string };

export const PREVIEW_COMPANIES: PreviewCompany[] = [
  { id: "b1", name: "Kigali Bakery", plan: "Standard", status: "Active", mrr: "RWF 50,000", lastSeen: "Today" },
  { id: "b2", name: "Nyamirambo Fashion", plan: "Pro", status: "Active", mrr: "RWF 80,000", lastSeen: "Yesterday" },
  { id: "b3", name: "Remera Salon", plan: "Standard", status: "Trial", mrr: "RWF 0", lastSeen: "Today" },
  { id: "b5", name: "Kanombe Prints", plan: "Starter", status: "Past due", mrr: "RWF 29,000", lastSeen: "9 days ago" },
];
