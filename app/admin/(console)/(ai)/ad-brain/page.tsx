import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { adBrainOverview, listAdJobs } from "@/lib/ad-brain/service";
import { AdBrainView } from "@/components/admin/content-ai/ad-brain-view";

export const metadata = { title: "Ad Brain" };

/** Admin -> Ad Brain: BuPulse's own self-made video ads (docs/AD_BRAIN.md). Drawn by AdBrainView. */
export default async function AdBrainPage({ searchParams }: PageProps<"/admin/ad-brain">) {
  await requirePermission("ai"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const [overview, jobs] = await Promise.all([adBrainOverview(), listAdJobs(20)]);
  return <AdBrainView overview={overview} jobs={jobs} message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }} />;
}
