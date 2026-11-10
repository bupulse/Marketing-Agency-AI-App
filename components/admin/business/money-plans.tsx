import Link from "next/link";
import { Archive, ArrowRight, Layers, RefreshCcw, Star, TrendingUp } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { CARD, DataList, EmptyState, ExpandCard, FOCUS, IconBadge, LIFT, StatusPill, type PillTone } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateTime, money, num } from "@/lib/admin/format";
import type { AdminPlanRow, getAdminPlan } from "@/lib/admin/plans-service";
import { cancelPriceChangeAction, retirePlanAction, retryPriceChangeAction, syncPlanAction } from "@/app/admin/(console)/(money)/plans/actions";

// Admin -> Money -> Plans: the plans as cards, and the rarely needed parts of one plan (Paddle, price changes,
// retiring) as cards that open. Plain data in: the pages load it, the dev preview passes made-up data.

export type PlanDetail = Awaited<ReturnType<typeof getAdminPlan>>;

const STATUS: Record<AdminPlanRow["status"], { tone: PillTone; label: string }> = { active: { tone: "good", label: "On sale" }, hidden: { tone: "muted", label: "Hidden" }, retired: { tone: "bad", label: "Retired" } };

function PaddleState({ p }: { p: AdminPlanRow }) {
  if (p.isTrial) return <span className="text-muted">Not sold</span>;
  if (p.syncState === "failed") return <StatusPill tone="bad" dot>Sync failed</StatusPill>;
  if (p.paddleReady || p.syncState === "synced") return <StatusPill tone="good" dot>Synced</StatusPill>;
  return <StatusPill tone="muted" dot>Not in Paddle</StatusPill>;
}

/** Every plan as a card, in the order clients see them: price, clients, MRR and its Paddle state. */
export function PlansGrid({ plans }: { plans: AdminPlanRow[] }) {
  if (plans.length === 0) return <EmptyState icon={Layers} title="No plans yet." hint="Make the first one with New plan." />;
  return (
    <ul className="kit-rise grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {plans.map((p) => (
        <li key={p.key} className="flex">
          <Link href={`/admin/plans/${encodeURIComponent(p.key)}`} className={cn("group relative flex w-full min-w-0 flex-col gap-3 overflow-hidden p-4 text-text no-underline sm:p-5", CARD, LIFT, FOCUS)}>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-brand-gradient opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
            <div className="flex items-start justify-between gap-2">
              <IconBadge icon={p.highlight ? Star : Layers} tone="green" />
              <StatusPill tone={STATUS[p.status].tone} dot>{STATUS[p.status].label}</StatusPill>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[17px] font-bold leading-snug tracking-[-0.01em]">{p.name}</span>
              <span className="text-[12.5px] text-muted"><span className="font-mono">{p.key}</span>{p.isTrial ? ` · ${p.trialDays ?? 7}-day trial` : ""}</span>
            </div>
            <p className="text-[24px] font-bold leading-none tabular-nums tracking-[-0.02em]">
              {p.isTrial ? "Free" : money(p.monthlyPriceCents)}
              {!p.isTrial && <span className="ml-1 text-[13px] font-semibold text-muted">a month · {money(p.yearlyPriceCents)} a year</span>}
            </p>
            <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-soft/70 p-3 text-[13px]">
              <div className="flex flex-col"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Clients</dt><dd className="font-bold tabular-nums">{num(p.subscribers)}</dd></div>
              <div className="flex flex-col"><dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">MRR</dt><dd className="font-bold tabular-nums">{p.isTrial ? "-" : money(p.mrrCents)}</dd></div>
            </dl>
            <div className="mt-auto flex items-center justify-between gap-2">
              <span className="flex flex-col items-start gap-1">
                <PaddleState p={p} />
                {p.latestChange && p.latestChange.status === "scheduled" && <span className="text-[12px] text-muted">Price change {p.latestChange.appliedCount}/{p.latestChange.subscribers} moved</span>}
              </span>
              <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-muted transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:bg-pulse-blue group-hover:text-white motion-reduce:transform-none">
                <ArrowRight className="size-4" />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Change = PlanDetail["changes"][number];
type PaddlePrice = PlanDetail["plan"]["paddlePrices"][number];

/** One plan's Paddle prices, price changes and retiring, as cards that open on hover, tap or focus. */
export function PlanExtras({ d }: { d: PlanDetail }) {
  const { plan, counts, changes, failedItems, priceUse, struggling, paddleConnected } = d;
  if (plan.isTrial) return null;
  const cur = plan.currency;
  const subscribers = counts.subscribers;
  const scheduled = changes.filter((c) => c.status === "scheduled").length;
  const syncLabel = plan.syncState === "synced" ? "Synced" : plan.syncState === "failed" ? "Sync failed" : paddleConnected ? "Not synced" : "Paddle not connected";
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <ExpandCard
        icon={RefreshCcw}
        tone="green"
        title="Paddle"
        summary={`${syncLabel} · ${plan.paddlePrices.length} ${plan.paddlePrices.length === 1 ? "price" : "prices"}`}
        aside={<StatusPill tone={plan.syncState === "synced" ? "good" : plan.syncState === "failed" ? "bad" : "muted"} dot>{syncLabel}</StatusPill>}
        defaultOpen={plan.syncState === "failed"}
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">Prices are never edited in Paddle: a price change creates new ones and old ones are archived when nobody uses them.{plan.paddleProductId ? ` Product ${plan.paddleProductId}.` : ""}</p>
          {plan.syncError && <p role="alert" className={notice.bad}>{plan.syncError}</p>}
          <DataList<PaddlePrice>
            caption="Paddle prices of this plan"
            rows={[...plan.paddlePrices].reverse()}
            rowKey={(p) => p.id}
            columns={[
              { key: "id", header: "Price id", cell: (p) => <span className="break-all font-mono text-[12.5px]">{p.id}</span>, primary: true },
              { key: "billed", header: "Billed", cell: (p) => (p.interval === "YEAR" ? "Yearly" : "Monthly") },
              { key: "amount", header: "Amount", cell: (p) => money(p.amountCents, cur), align: "right" },
              {
                key: "state",
                header: "State",
                cell: (p) =>
                  p.id === plan.paddleMonthlyPriceId || p.id === plan.paddleYearlyPriceId ? <StatusPill tone="good">Current</StatusPill> : p.archivedAt ? <StatusPill tone="muted">Archived</StatusPill> : (priceUse[p.id] ?? 0) > 0 ? <StatusPill tone="new">Old, still used by {priceUse[p.id]}</StatusPill> : <StatusPill tone="muted">Old, no longer used</StatusPill>,
              },
            ]}
            empty={<p className="text-[13px] text-muted">No prices in Paddle yet (plans that sell today may still use the price ids from the environment).</p>}
          />
          <form action={syncPlanAction}>
            <input type="hidden" name="key" value={plan.key} />
            <Button type="submit" size="sm" variant="outline" disabled={!paddleConnected}>Sync with Paddle</Button>
          </form>
        </div>
      </ExpandCard>

      <ExpandCard
        icon={TrendingUp}
        tone="green"
        title="Price changes"
        summary={changes.length === 0 ? "None yet. Clients move at a renewal." : `${changes.length} ${changes.length === 1 ? "change" : "changes"}${scheduled ? `, ${scheduled} running` : ""}`}
        aside={failedItems.length > 0 ? <StatusPill tone="bad" dot>{failedItems.length} failed</StatusPill> : scheduled ? <StatusPill tone="new" dot>Running</StatusPill> : undefined}
        defaultOpen={failedItems.length > 0 || struggling > 0}
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">Existing clients move to a new price at a renewal: increases after a 30-day email notice, decreases at the next renewal.</p>
          <DataList<Change>
            caption="Price changes of this plan"
            rows={changes}
            rowKey={(c) => c.id}
            columns={[
              { key: "change", header: "Change", primary: true, cell: (c) => <span className="flex flex-col"><span>{money(c.oldMonthlyCents, cur)} to {money(c.newMonthlyCents, cur)} / mo</span><span className="text-xs font-normal text-muted">{money(c.oldYearlyCents, cur)} to {money(c.newYearlyCents, cur)} / yr · {c.direction}</span></span> },
              { key: "status", header: "Status", cell: (c) => <StatusPill tone={c.status === "completed" ? "good" : c.status === "scheduled" ? "new" : "muted"} dot>{c.status}</StatusPill> },
              { key: "moved", header: "Moved", cell: (c) => `${c.appliedCount} of ${c.subscribers}${c.failedCount ? `, ${c.failedCount} failed` : ""}`, align: "right" },
              { key: "notified", header: "Notified", cell: (c) => c.notifiedCount, align: "right", hideOnPhone: true },
              { key: "when", header: "When", cell: (c) => dateTime(c.createdAt), hideOnPhone: true },
              { key: "stop", header: <span className="sr-only">Actions</span>, cell: (c) => (c.status === "scheduled" ? <ConfirmButton action={cancelPriceChangeAction} fields={{ key: plan.key, id: c.id }} label="Stop" title="Stop this price change?" description="Clients not yet moved stay on their current price. Clients already moved are not changed back." confirmLabel="Stop it" /> : null) },
            ]}
            empty={<p className="text-[13px] text-muted">No price changes yet.</p>}
          />
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
        </div>
      </ExpandCard>

      <ExpandCard icon={Archive} tone="slate" title={plan.status === "retired" ? "Retired plan" : "Retire this plan"} summary={plan.status === "retired" ? "Not on sale. Clients on it keep it." : `Stop selling it. ${subscribers} current ${subscribers === 1 ? "client keeps" : "clients keep"} it.`} className="lg:col-span-2">
        <div className="flex flex-col items-start gap-3">
          <p className="text-[13px] text-muted">A retired plan disappears for new sign-ups. Clients already on it stay on it, with the same price and limits.</p>
          {plan.status === "retired" ? (
            <ConfirmButton action={retirePlanAction} fields={{ key: plan.key, status: "active" }} label="Put back on sale" title="Put this plan back on sale?" description="It shows on the pricing page again." confirmLabel="Put on sale" />
          ) : (
            <ConfirmButton action={retirePlanAction} fields={{ key: plan.key, status: "retired" }} label="Retire plan" title={`Retire ${plan.name}?`} description={`New clients can no longer pick it. ${subscribers} current ${subscribers === 1 ? "client stays" : "clients stay"} on it.`} confirmLabel="Retire" variant="outline" />
          )}
        </div>
      </ExpandCard>
    </div>
  );
}
