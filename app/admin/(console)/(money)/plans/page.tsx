import Link from "next/link";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Empty, Panel, Stat, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, buttonClasses } from "@/components/ui";
import { money, num, param } from "@/lib/admin/format";
import { listAdminPlans } from "@/lib/admin/plans-service";

export const metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "success", hidden: "neutral", retired: "danger" } as const;

export default async function PlansPage({ searchParams }: PageProps<"/admin/plans">) {
  await requirePermission("plans.manage"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const { plans, paddleConnected } = await listAdminPlans();
  const totalMrr = plans.reduce((s, p) => s + p.mrrCents, 0);
  const paying = plans.reduce((s, p) => s + p.payingSubscribers, 0);

  return (
    <>
      <PageHeader
        title="Plans"
        description="What clients can buy. The pricing page, checkout, limits and the Jarvis tools all read these plans."
        action={<Link href="/admin/plans/new" className={buttonClasses({ size: "md" })}>New plan</Link>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {!paddleConnected && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          <strong>Paddle not connected.</strong> Plans can be drafted and edited, but nothing is created in Paddle and prices of plans that already sell cannot change until Paddle is connected in <Link href="/admin/settings#paddle" className="underline">Settings → Card payments</Link>.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="MRR from plans" value={money(totalMrr)} source="Current plan prices" href="/admin/revenue" />
        <Stat label="Paying clients" value={num(paying)} source="Active and past due" />
        <Stat label="Plans" value={num(plans.length)} source={`${plans.filter((p) => p.status === "active").length} active`} />
      </div>

      <Panel title="All plans" description="In the order clients see them.">
        {plans.length === 0 ? (
          <Empty>No plans yet.</Empty>
        ) : (
          <TableWrap caption="Plans with price, clients and MRR">
            <thead>
              <tr><Th>Plan</Th><Th>Status</Th><Th right>Monthly</Th><Th right>Yearly</Th><Th right>Clients</Th><Th right>MRR</Th><Th>Paddle</Th></tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.key}>
                  <Td>
                    <Link href={`/admin/plans/${encodeURIComponent(p.key)}`} className="font-semibold underline">{p.name}</Link>
                    <span className="block text-xs text-muted">{p.key}{p.isTrial ? ` · ${p.trialDays ?? 7}-day trial` : ""}</span>
                  </Td>
                  <Td><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></Td>
                  <Td right>{p.isTrial ? "Free" : money(p.monthlyPriceCents)}</Td>
                  <Td right>{p.isTrial ? "Free" : money(p.yearlyPriceCents)}</Td>
                  <Td right>{num(p.subscribers)}</Td>
                  <Td right>{p.isTrial ? "-" : money(p.mrrCents)}</Td>
                  <Td>
                    {p.isTrial ? <span className="text-muted">Not sold</span> : p.syncState === "failed" ? <Badge tone="danger">Sync failed</Badge> : p.paddleReady || p.syncState === "synced" ? <Badge tone="success">Synced</Badge> : <Badge tone="neutral">Not in Paddle</Badge>}
                    {p.latestChange && p.latestChange.status === "scheduled" && (
                      <span className="mt-1 block text-xs text-muted">Price change {p.latestChange.appliedCount}/{p.latestChange.subscribers} moved</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
