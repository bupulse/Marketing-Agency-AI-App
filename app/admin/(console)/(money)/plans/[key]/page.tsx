import { notFound } from "next/navigation";
import { Layers } from "lucide-react";
import { requirePermission } from "@/lib/admin/auth";
import { PageHeader } from "@/components/admin/kit";
import { PlanExtras } from "@/components/admin/business/money-plans";
import { MoneyNotices } from "@/components/admin/business/money-common";
import { PlanForm } from "@/components/admin/plan-form";
import { money } from "@/lib/admin/format";
import { getAdminPlan } from "@/lib/admin/plans-service";
import { planRegionOptions } from "@/lib/admin/regions-service";
import { AdminError } from "@/lib/admin/types";

export const metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

export default async function PlanPage({ params, searchParams }: PageProps<"/admin/plans/[key]">) {
  await requirePermission("plans.manage"); // pages render alongside the layout, so check here too
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
  const { plan, counts, paddleConnected } = detail;
  const { subscribers } = counts;
  // A custom plan is priced in its offer's currency (98,000 RWF), never in dollars.
  const cur = plan.currency;
  const regions = plan.isTrial || plan.isCustom ? [] : await planRegionOptions(plan.key);

  return (
    <>
      <PageHeader
        icon={Layers}
        tone="green"
        title={plan.name}
        description={`${plan.key} · ${subscribers} ${subscribers === 1 ? "client" : "clients"}${!plan.isTrial ? ` · ${money(counts.mrrCents, cur)} MRR` : ""}`}
        back={{ href: "/admin/plans", label: "All plans" }}
      />
      <MoneyNotices sp={sp} />
      {!paddleConnected && !plan.isTrial && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm"><strong>Paddle not connected.</strong> This plan is a draft in BuPulse only.</p>
      )}

      <PlanForm
        mode="edit"
        paddleConnected={paddleConnected}
        version={plan.updatedAt?.toISOString()}
        subscribers={counts.payingSubscribers}
        regions={regions}
        initial={{
          key: plan.key,
          name: plan.name,
          description: plan.description,
          isTrial: plan.isTrial,
          isCustom: plan.isCustom,
          currency: cur,
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

      <PlanExtras d={detail} />
    </>
  );
}
