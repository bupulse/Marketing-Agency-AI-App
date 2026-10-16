import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Bars } from "@/components/admin/charts";
import { Empty, Panel, RangeTabs, TableWrap, Td, Th } from "@/components/admin/ui";
import { num, parseRange, pct } from "@/lib/admin/format";
import { getFunnel, getWhatsWorking } from "@/lib/analytics/queries";
import type { Ranked } from "@/lib/analytics/types";

export const metadata = { title: "Funnels" };

function RankedTable({ rows, caption, first }: { rows: Ranked[]; caption: string; first: string }) {
  if (rows.length === 0) return <Empty>No data in this range yet.</Empty>;
  const hasVisits = rows.some((r) => r.visits != null);
  return (
    <TableWrap caption={caption}>
      <thead>
        <tr>
          <Th>{first}</Th>
          {hasVisits && <Th right>Visits</Th>}
          <Th right>Sign-ups</Th>
          <Th right>Paid</Th>
          <Th right>Sign-up rate</Th>
          <Th right>Paid rate</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td className="max-w-[16rem] truncate">{r.key || "(none)"}</Td>
            {hasVisits && <Td right>{num(r.visits ?? 0)}</Td>}
            <Td right>{num(r.signups)}</Td>
            <Td right>{num(r.paid)}</Td>
            <Td right>{pct(r.signupPct)}</Td>
            <Td right>{pct(r.paidPct)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default async function FunnelsPage({ searchParams }: PageProps<"/admin/funnels">) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const { key, range } = parseRange((await searchParams).range);
  const [funnel, working] = await Promise.all([getFunnel(range), getWhatsWorking(range)]);
  const none = funnel.steps.every((s) => s.count === 0);
  return (
    <>
      <PageHeader title="Funnels" description={`Visit to sign-up to onboarded to paid, ${range.from} to ${range.to}. Counts are distinct people, from page views and product events.`} action={<RangeTabs current={key} base="/admin/funnels" />} />
      <Panel title="Overall funnel">
        {none ? (
          <Empty>No visits or sign-ups in this range yet.</Empty>
        ) : (
          <>
            <Bars rows={funnel.steps.map((s) => ({ label: s.label, value: s.count, text: `${num(s.count)}${s.fromPreviousPct != null ? ` · ${pct(s.fromPreviousPct)} of previous step` : ""}` }))} />
          </>
        )}
      </Panel>
      <Panel title="By traffic source" description="Where visitors came from (referrer or utm_source), and how far they got.">
        <RankedTable rows={working.sources} caption="Funnel by traffic source" first="Source" />
      </Panel>
      <Panel title="By industry" description="Businesses created, and how many of them now pay.">
        <RankedTable rows={working.industries} caption="Funnel by industry" first="Industry" />
      </Panel>
      <Panel title="By landing page" description="The first page of the visit that ended in a sign-up.">
        <RankedTable rows={working.landingPages} caption="Funnel by landing page" first="Page" />
      </Panel>
    </>
  );
}
