import { notFound } from "next/navigation";
import { LinksView } from "@/components/support-app/links-view";
import { utcDay } from "@/lib/analytics/collect";
import { parseVisitorPeriod, recentMonths } from "@/lib/analytics/visitors-shared";
import { publicSiteUrl } from "@/lib/auth/site-url";
import { trackedLinksReport } from "@/lib/links/service";
import { supportBase, requireSupportAgentPage } from "@/lib/support/app-auth";
import { supportHref } from "@/lib/support/app-host";
import { canSeeVisitorAnalytics } from "@/lib/support/roles";

export const metadata = { title: "Links" };

/**
 * Tracked links (docs/SUPPORT_DASHBOARD.md "Tracked links"): make a bupulse.com/go/<code> link and see what it brings.
 * admin@bupulse.com sees every link and the staff leaderboard; anyone else only their own links and chat leads.
 */
export default async function SupportLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireSupportAgentPage();
  if (!canSeeVisitorAnalytics(me.role)) notFound();
  const now = new Date();
  const [sp, base] = await Promise.all([searchParams, supportBase()]);
  const period = parseVisitorPeriod(sp, now);
  const report = await trackedLinksReport(me, period, now);
  return <LinksView report={report} owner={!!me.owner} period={period} href={supportHref(base, "/links")} months={recentMonths(now)} today={utcDay(now)} site={publicSiteUrl()} />;
}
