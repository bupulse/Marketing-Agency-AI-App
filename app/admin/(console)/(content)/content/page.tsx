import { CalendarCheck, ChartLine, FileImage, Network, PauseCircle, Trophy } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { Bars } from "@/components/admin/charts";
import { CARD, DataList, EmptyState, IconBadge, PageHeader, StatusPill } from "@/components/admin/kit";
import { Panel, RangeTabs } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { num, parseRange } from "@/lib/admin/format";
import { getTopContent } from "@/lib/analytics/queries";
import { dailyPostsToday } from "@/lib/daily-posts/service";
import { dailyTodayLine } from "@/lib/daily-posts/budget";

export const metadata = { title: "Content performance" };

type TopPost = Awaited<ReturnType<typeof getTopContent>>["topPosts"][number];

export default async function ContentPage({ searchParams }: PageProps<"/admin/content">) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const { key, range } = parseRange((await searchParams).range);
  const [top, daily] = await Promise.all([getTopContent(range), dailyPostsToday()]);
  const none = top.topPosts.length === 0 && top.byNetwork.length === 0;
  return (
    <>
      <PageHeader icon={ChartLine} tone="pink" title="Content performance" description={`What clients' posts earn across all businesses, ${range.from} to ${range.to}, from the metrics collected for published posts.`} actions={<RangeTabs current={key} base="/admin/content" />} />
      <section aria-label="Daily posts" className={cn("flex items-start gap-3 p-4 sm:p-5", CARD)}>
        <IconBadge icon={daily.paused ? PauseCircle : CalendarCheck} tone="pink" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-bold">Daily posts</h2>
            <StatusPill tone={daily.paused ? "warn" : "good"} dot>{daily.paused ? "Paused" : "Running"}</StatusPill>
          </div>
          <p className="mt-1 text-[14px]">{dailyTodayLine(daily)}</p>
          <p className="mt-1 text-[12.5px] text-muted">Posts BuPulse made for clients last night. Pause them in Settings, Daily posts for clients.</p>
        </div>
      </section>
      {none ? (
        <EmptyState icon={ChartLine} title="No published posts with metrics in this range yet." hint="Pick a longer range above, or come back after posts have run for a day." />
      ) : (
        <>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Panel icon={Network} tone="pink" title="Networks" description="Average engagement per post, by network.">
              <Bars color="var(--color-pulse-violet)" rows={top.byNetwork.map((n) => ({ label: n.network, value: n.avgEngagement, text: `${Math.round(n.avgEngagement)} avg · ${n.posts} posts · reach ${num(Math.round(n.avgReach))}` }))} />
            </Panel>
            <Panel icon={FileImage} tone="pink" title="Formats" description="Average engagement per post, by format.">
              <Bars color="var(--color-pulse-violet)" rows={top.byFormat.map((n) => ({ label: n.format, value: n.avgEngagement, text: `${Math.round(n.avgEngagement)} avg · ${n.posts} posts` }))} />
            </Panel>
          </div>
          <Panel icon={Trophy} tone="pink" title="Top posts" description="Client content, shown so you can see what works. Open the business from the Users page.">
            <DataList<TopPost>
              caption="Top posts by engagement"
              rows={top.topPosts}
              rowKey={(p) => p.postId}
              columns={[
                { key: "post", header: "Post", primary: true, className: "max-w-[22rem]", cell: (p) => <span className="line-clamp-3 font-medium">{p.excerpt}</span> },
                { key: "network", header: "Network", cell: (p) => p.network },
                { key: "format", header: "Format", cell: (p) => p.format },
                { key: "reach", header: "Reach", align: "right", cell: (p) => num(p.reach) },
                { key: "engagement", header: "Engagement", align: "right", cell: (p) => num(p.engagement) },
              ]}
            />
          </Panel>
        </>
      )}
    </>
  );
}
