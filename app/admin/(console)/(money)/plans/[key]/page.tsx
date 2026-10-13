import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { PlanForm } from "@/components/admin/plan-form";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button } from "@/components/ui";
import { dateTime, money, param } from "@/lib/admin/format";
import { getAdminPlan, listAdminPlans } from "@/lib/admin/plans-service";
import { AdminError } from "@/lib/admin/types";
import { cancelPriceChangeAction, retirePlanAction, retryPriceChangeAction, syncPlanAction } from "../actions";

export const metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

export default async function PlanPage({ params, searchParams }: PageProps<"/admin/plans/[key]">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const sp = await searchParams;
  let detail: Awaited<ReturnType<typeof getAdminPlan>>;
  try {
    detail = await getAdminPlan(key);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const { plan, changes, failedItems, priceUse, struggling, paddleConnected } = detail;
  const row = (await listAdminPlans()).plans.find((p) => p.key === key);
  const subscribers = row?.subscribers ?? 0;

  return (
    <>
      <PageHeader
        title={plan.name}
        description={`${plan.key} · ${subscribers} ${subscribers === 1 ? "client" : "clients"}${row && !plan.isTrial ? ` · ${money(row.mrrCents)} MRR` : ""}`}
        action={<Link href="/admin/plans" className="text-sm font-medium underline">All plans</Link>}
      />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}
      {!paddleConnected && !plan.isTrial && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm"><strong>Paddle not connected.</strong> This plan is a draft in BuPulse only.</p>
      )}

      <PlanForm
        mode="edit"
        paddleConnected={paddleConnected}
        version={plan.updatedAt?.toISOString()}
        subscribers={row?.payingSubscribers ?? 0}
        initial={{
          key: plan.key,
          name: plan.name,
          description: plan.description,
          isTrial: plan.isTrial,
          trialDays: plan.trialDays,
          status: plan.status,
          sortOrder: plan.sortOrder,
          highlight: plan.highlight,
          monthlyPriceCents: plan.monthlyPriceCents,
          yearlyPriceCents: plan.yearlyPriceCents,
          limits: plan.limits,
          highlights: plan.highlights,
          features: plan.features,
        }}
      />

      {!plan.isTrial && (
        <Panel
          title="Paddle"
          description="Prices are never edited in Paddle: a price change creates new ones and old ones are archived when nobody uses them."
          action={
            <form action={syncPlanAction}>
              <input type="hidden" name="key" value={plan.key} />
              <Button type="submit" size="sm" variant="outline" disabled={!paddleConnected}>Sync with Paddle</Button>
            </form>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={plan.syncState === "synced" ? "success" : plan.syncState === "failed" ? "danger" : "neutral"}>
              {plan.syncState === "synced" ? "Synced" : plan.syncState === "failed" ? "Sync failed" : paddleConnected ? "Not synced" : "Paddle not connected"}
            </Badge>
            {plan.paddleProductId && <span className="text-muted">Product {plan.paddleProductId}</span>}
          </div>
          {plan.syncError && <p role="alert" className={notice.bad}>{plan.syncError}</p>}
          {plan.paddlePrices.length > 0 ? (
            <TableWrap caption="Paddle prices of this plan">
              <thead><tr><Th>Price id</Th><Th>Billed</Th><Th right>Amount</Th><Th>State</Th></tr></thead>
              <tbody>
                {[...plan.paddlePrices].reverse().map((p) => {
                  const current = p.id === plan.paddleMonthlyPriceId || p.id === plan.paddleYearlyPriceId;
                  return (
                    <tr key={p.id}>
                      <Td className="break-all">{p.id}</Td>
                      <Td>{p.interval === "YEAR" ? "Yearly" : "Monthly"}</Td>
                      <Td right>{money(p.amountCents)}</Td>
                      <Td>{current ? <Badge tone="success">Current</Badge> : p.archivedAt ? <Badge tone="neutral">Archived</Badge> : (priceUse[p.id] ?? 0) > 0 ? <Badge tone="violet">Old, still used by {priceUse[p.id]}</Badge> : <Badge tone="neutral">Old, no longer used</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          ) : (
            <p className="text-sm text-muted">No prices in Paddle yet (plans that sell today may still use the price ids from the environment).</p>
          )}
        </Panel>
      )}

      {!plan.isTrial && (
        <Panel title="Price changes" description="Existing clients move to a new price at a renewal: increases after a 30-day email notice, decreases at the next renewal.">
          {changes.length === 0 ? (
            <Empty>No price changes yet.</Empty>
          ) : (
            <TableWrap caption="Price changes of this plan">
              <thead><tr><Th>When</Th><Th>Change</Th><Th>Status</Th><Th right>Clients</Th><Th right>Notified</Th><Th right>Moved</Th><Th right>Failed</Th><Th /></tr></thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <Td>{dateTime(c.createdAt)}</Td>
                    <Td>{money(c.oldMonthlyCents)} to {money(c.newMonthlyCents)} / mo<br /><span className="text-xs text-muted">{money(c.oldYearlyCents)} to {money(c.newYearlyCents)} / yr · {c.direction}</span></Td>
                    <Td><Badge tone={c.status === "completed" ? "success" : c.status === "scheduled" ? "violet" : "neutral"}>{c.status}</Badge></Td>
                    <Td right>{c.subscribers}</Td>
                    <Td right>{c.notifiedCount}</Td>
                    <Td right>{c.appliedCount}</Td>
                    <Td right>{c.failedCount}</Td>
                    <Td>
                      {c.status === "scheduled" && (
                        <ConfirmButton action={cancelPriceChangeAction} fields={{ key: plan.key, id: c.id }} label="Stop" title="Stop this price change?" description="Clients not yet moved stay on their current price. Clients already moved are not changed back." confirmLabel="Stop it" />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          {struggling > 0 && (
            <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">{struggling} {struggling === 1 ? "client is" : "clients are"} waiting for a notice that could not be sent yet (no email address, no renewal date, or the email service refusing). Each is tried again daily and marked failed after 5 tries.</p>
          )}
          {failedItems.length > 0 && (
            <div role="alert" className={notice.bad}>
              {failedItems.length} {failedItems.length === 1 ? "client" : "clients"} could not be moved. First error: {failedItems[0].error}
              <div className="mt-2">
                <ConfirmButton action={retryPriceChangeAction} fields={{ key: plan.key, id: failedItems[0].changeId }} label="Retry" title="Retry the failed clients?" description="They are queued again. A client whose notice email may not have gone out is emailed again." confirmLabel="Retry" />
              </div>
            </div>
          )}
        </Panel>
      )}

      {!plan.isTrial && (
        <Panel title={plan.status === "retired" ? "Retired plan" : "Retire this plan"} description="A retired plan disappears for new sign-ups. Clients already on it stay on it, with the same price and limits.">
          {plan.status === "retired" ? (
            <ConfirmButton action={retirePlanAction} fields={{ key: plan.key, status: "active" }} label="Put back on sale" title="Put this plan back on sale?" description="It shows on the pricing page again." confirmLabel="Put on sale" />
          ) : (
            <ConfirmButton action={retirePlanAction} fields={{ key: plan.key, status: "retired" }} label="Retire plan" title={`Retire ${plan.name}?`} description={`New clients can no longer pick it. ${subscribers} current ${subscribers === 1 ? "client stays" : "clients stay"} on it.`} confirmLabel="Retire" variant="outline" />
          )}
        </Panel>
      )}
    </>
  );
}
