import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { ANALYTICS_VIEWS, AnalyticsScreen, type AnalyticsView } from "@/components/analytics/analytics-screen";
import { chosen } from "@/components/admin/kit";
import { parseRange } from "@/lib/analytics/compute";
import { loadClientAnalytics } from "@/lib/analytics/service";

export const metadata = { title: "Analytics" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("analytics");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const params = await searchParams;
  const days = parseRange(params.range);
  const view = chosen(params, "view", ANALYTICS_VIEWS, "overview") as AnalyticsView;
  const data = await loadClientAnalytics(business.id, days);
  return <AnalyticsScreen data={data} days={days} view={view} params={params} />;
}
