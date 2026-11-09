import { notFound } from "next/navigation";
import { AnalyticsView } from "@/components/support-app/analytics/analytics-view";
import { utcDay } from "@/lib/analytics/collect";
import { getVisitorAnalytics } from "@/lib/analytics/visitors";
import { parseVisitorPeriod, recentMonths } from "@/lib/analytics/visitors-shared";
import { supportBase, requireSupportAgentPage } from "@/lib/support/app-auth";
import { supportHref } from "@/lib/support/app-host";
import { canSeeVisitorAnalytics } from "@/lib/support/roles";

export const metadata = { title: "Analytics" };

/** Visitor analytics (docs/SUPPORT_DASHBOARD.md): every role that may see it (lib/support/roles.ts); others get "not found". */
export default async function SupportAnalyticsPage({ searchParams }: PageProps<"/support/analytics">) {
  const me = await requireSupportAgentPage();
  if (!canSeeVisitorAnalytics(me.role)) notFound();
  const now = new Date();
  const [sp, base] = await Promise.all([searchParams, supportBase()]);
  const period = parseVisitorPeriod(sp, now);
  const data = await getVisitorAnalytics(period, now);
  return (
    <AnalyticsView
      data={data}
      period={period}
      href={supportHref(base, "/analytics")}
      liveHref={supportHref(base, "/visitors")}
      months={recentMonths(now)}
      today={utcDay(now)}
    />
  );
}
