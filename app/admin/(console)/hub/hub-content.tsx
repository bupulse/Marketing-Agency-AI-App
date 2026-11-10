import "server-only";
import { notFound } from "next/navigation";
import { HubView, type HubFigure } from "@/components/admin/kit/hub-view";
import { navFor, type AdminNavGroup, type BadgeKey } from "@/components/admin/nav";
import { notice } from "@/components/admin/ui";
import type { AdminIdentity } from "@/lib/admin/auth";
import { getInboxCounts } from "@/lib/admin/inbox";
import { getClientCounts } from "@/lib/admin/overview";
import { num } from "@/lib/admin/format";

// The body of every group hub (/admin/money, /admin/clients, /admin/system, /admin/hub/<group>): one section card per
// page the viewer may open, with the cheap numbers the console already counts (the sidebar's to-do counts, shared with
// the layout in the same request, and the client counts on the Clients hub). The route files call requirePermission
// themselves before rendering this.

const words = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The to-do lists behind the sidebar badges, as red bubbles on the cards. */
const BUBBLE: Partial<Record<BadgeKey, (n: number) => string>> = {
  quotes: (n) => `${num(n)} ${words(n, "quote request", "quote requests")} to call`,
  payments: (n) => `${num(n)} ${words(n, "payment", "payments")} to check`,
  approvals: (n) => `${num(n)} ${words(n, "request", "requests")} waiting for approval`,
  requests: (n) => `${num(n)} new plan ${words(n, "request", "requests")}`,
  reports: (n) => `${num(n)} open ${words(n, "report", "reports")}`,
};

/** Pure: the figures for a hub from the counts (exported for tests). */
export function hubFiguresFrom(group: AdminNavGroup, counts: Partial<Record<string, number>>, clients?: { total: number; pastDue: number; trial: number } | null): Record<string, HubFigure> {
  const out: Record<string, HubFigure> = {};
  for (const item of group.items) {
    const bubble = item.badge ? BUBBLE[item.badge] : undefined;
    const n = item.badge ? counts[item.badge] : undefined;
    if (bubble && n) out[item.href] = { count: n, countLabel: bubble(n), value: num(n), valueLabel: bubble(n).replace(/^[\d,]+ /, "") };
  }
  const value = (href: string, n: number | undefined, label: (n: number) => string) => {
    if (n == null || !group.items.some((i) => i.href === href) || out[href]) return;
    out[href] = { value: num(n), valueLabel: label(n) };
  };
  value("/admin/demos", counts.demos, (n) => `${words(n, "demo", "demos")} coming up or not marked`);
  value("/admin/invoices", counts.invoices, (n) => `${words(n, "invoice", "invoices")} to check`);
  value("/admin/offers", counts.offers, () => "accepted, waiting for payment");
  value("/admin/errors", counts.errors, (n) => `${words(n, "error", "errors")} in the last 24 hours`);
  if (clients) {
    value("/admin/companies", clients.total, (n) => words(n, "company", "companies"));
    value("/admin/client-health", clients.pastDue, () => "late paying");
  }
  return out;
}

export async function HubContent({ group, me, searchParams }: { group: AdminNavGroup; me: Pick<AdminIdentity, "permissions">; searchParams?: Record<string, string | string[] | undefined> }) {
  // Only the pages this person may open (the route already checked they may open at least one).
  const mine = navFor(me.permissions).find((g) => g.id === group.id);
  if (!mine) notFound();
  const [counts, clients] = await Promise.all([getInboxCounts().catch(() => ({}) as Record<string, number>), group.id === "clients" ? getClientCounts().catch(() => null) : Promise.resolve(null)]);
  const say = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return (
    <HubView group={mine} figures={hubFiguresFrom(mine, counts, clients)}>
      {say(searchParams?.notice) && <p role="status" className={notice.ok}>{say(searchParams?.notice)}</p>}
      {say(searchParams?.error) && <p role="alert" className={notice.bad}>{say(searchParams?.error)}</p>}
    </HubView>
  );
}
