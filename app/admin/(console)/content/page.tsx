import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Bars } from "@/components/admin/charts";
import { Empty, Panel, RangeTabs, TableWrap, Td, Th } from "@/components/admin/ui";
import { num, parseRange } from "@/lib/admin/format";
import { getTopContent } from "@/lib/analytics/queries";

export const metadata = { title: "Content performance" };

export default async function ContentPage({ searchParams }: PageProps<"/admin/content">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const { key, range } = parseRange((await searchParams).range);
  const top = await getTopContent(range);
  const none = top.topPosts.length === 0 && top.byNetwork.length === 0;
  return (
    <>
      <PageHeader title="Content performance" description={`What customers’ posts earn across all businesses, ${range.from} to ${range.to}. From the metrics collected for published posts.`} action={<RangeTabs current={key} base="/admin/content" />} />
      {none ? (
        <Empty>No published posts with metrics in this range yet.</Empty>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Networks" description="Average engagement per post.">
              <Bars rows={top.byNetwork.map((n) => ({ label: n.network, value: n.avgEngagement, text: `${Math.round(n.avgEngagement)} avg · ${n.posts} posts · reach ${num(Math.round(n.avgReach))}` }))} />
            </Panel>
            <Panel title="Formats" description="Average engagement per post.">
              <Bars color="var(--color-pulse-violet)" rows={top.byFormat.map((n) => ({ label: n.format, value: n.avgEngagement, text: `${Math.round(n.avgEngagement)} avg · ${n.posts} posts` }))} />
            </Panel>
          </div>
          <Panel title="Top posts" description="Customer content, shown so you can see what works. Open the business from the Users page.">
            <TableWrap caption="Top posts by engagement">
              <thead><tr><Th>Post</Th><Th>Network</Th><Th>Format</Th><Th right>Reach</Th><Th right>Engagement</Th></tr></thead>
              <tbody>
                {top.topPosts.map((p) => (
                  <tr key={p.postId}><Td className="max-w-[22rem]">{p.excerpt}</Td><Td>{p.network}</Td><Td>{p.format}</Td><Td right>{num(p.reach)}</Td><Td right>{num(p.engagement)}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
        </>
      )}
    </>
  );
}
