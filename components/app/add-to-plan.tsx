import { Check, Clock } from "lucide-react";
import { FEATURE_ICONS } from "@/components/app/nav";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { blockMessage, PLAN_UNKNOWN_MESSAGE, type AccountBlock, type FeatureBlockReason } from "@/lib/entitlements";
import { featureOf, type FeatureKey } from "@/lib/features";
import { askMessage, can, type Role } from "@/lib/team/roles";

/**
 * The friendly page for a feature the company's plan does not include (or whose service is off right now):
 * what it does, what it needs, and how to get it. Custom plans are arranged with the BuPulse team; until the
 * request form exists (R5) the button goes to Billing. (R5 is built: it opens /custom-plan with this feature ticked.)
 */
export function AddToPlan({ feature, reason = "not_in_plan", block = null, role, inPlan }: { feature: FeatureKey; reason?: FeatureBlockReason; block?: AccountBlock | null; role: Role; inPlan: ReadonlySet<FeatureKey> }) {
  const def = featureOf(feature);
  const Icon = FEATURE_ICONS[feature];
  // The account is read-only (lib/entitlements.ts accountBlock): the feature itself is not the problem.
  if (block) {
    return (
      <>
        <PageHeader title={def.label} description={block === "pending_demo" ? "Opens after your demo." : "Your account is read-only for now."} />
        <EmptyState
          icon={Icon}
          title={block === "pending_demo" ? "Your demo comes first" : block === "trial_expired" ? "Your free trial has ended" : block === "past_due" ? "Your last payment did not go through" : "Your plan is not active"}
          text={blockMessage(block)}
          action={block !== "pending_demo" && can(role, "billing") ? <Button href="/dashboard/billing">Go to Billing</Button> : block !== "pending_demo" ? <p className="text-sm text-muted">{askMessage("billing")}</p> : undefined}
        />
      </>
    );
  }
  if (def.status === "coming_soon") {
    return (
      <>
        <PageHeader title={def.label} description="Not available yet." />
        <EmptyState icon={Clock} comingSoon title={`${def.label} is on its way`} text={def.description} />
      </>
    );
  }
  if (reason === "plan_unknown") {
    return (
      <>
        <PageHeader title={def.label} description="Your plan could not be checked." />
        <EmptyState icon={Icon} title="Please try again in a moment" text={PLAN_UNKNOWN_MESSAGE} />
      </>
    );
  }
  if (reason === "service_off") {
    return (
      <>
        <PageHeader title={def.label} description="Part of your plan, paused for a short while." />
        <EmptyState icon={Icon} title="Temporarily unavailable" text={UNAVAILABLE_MESSAGE} />
      </>
    );
  }
  // Members get no purchase prompt: what the feature does, and that the plan is the owner's call.
  if (!can(role, "upgrade")) {
    return (
      <>
        <PageHeader title={def.label} description="Not part of your company's plan." />
        <EmptyState icon={Icon} title={`${def.label} is not in your company's plan`} text={`${def.description} Your company owner decides what the plan includes.`} />
      </>
    );
  }
  const needs = def.requires.filter((k) => !inPlan.has(k)).map((k) => featureOf(k).label);
  const points = [def.description, ...(needs.length ? [`Comes with ${needs.join(" and ")}, which it needs.`] : [])];
  return (
    <>
      <PageHeader title={def.label} description="Not part of your plan yet." />
      <EmptyState
        icon={Icon}
        title={`Add ${def.label} to your plan`}
        text="Custom plans are put together with the BuPulse team: tell us what you need and we send you an offer to accept in Billing."
        points={points}
        action={
          can(role, "billing") ? (
            <Button href={`/custom-plan?from=upgrade&feature=${encodeURIComponent(def.key)}`} leading={<Check aria-hidden className="size-5" />}>
              Ask for a custom plan
            </Button>
          ) : (
            <p className="text-sm text-muted">{askMessage("billing")}</p>
          )
        }
      />
    </>
  );
}
