import { Button, GlassCard } from "@/components/ui";
import { blockReason, upgradeHref, type CompanyEntitlements } from "@/lib/entitlements";
import type { FeatureKey } from "@/lib/features";

/**
 * A page whose feature the plan no longer has, but whose existing data the company keeps (webhooks, API keys): the list
 * stays, with this note on top. Same idea as the note on the leads page; an empty page uses `featureGate` instead.
 */
export function KeptDataNote({ feature, label, entitlements, what }: { feature: FeatureKey; label: string; entitlements: CompanyEntitlements; what: string }) {
  const inPlan = entitlements.inPlan.has(feature);
  return (
    <GlassCard role="note" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="text-[14px]">
        {inPlan
          ? `${label[0].toUpperCase()}${label.slice(1)} is paused for a short while. ${what} stay here to look at and remove; the rest works again once it is back.`
          : `${label[0].toUpperCase()}${label.slice(1)} is not part of your plan. ${what} stay here to look at and remove; add ${label} to use them again.`}
      </p>
      {!inPlan && (
        <Button href={upgradeHref(feature, blockReason(entitlements, feature))} size="sm">
          Add {label} to your plan
        </Button>
      )}
    </GlassCard>
  );
}
