import { Lock } from "lucide-react";
import { AddToPlan } from "./add-to-plan";
import { getAppContext } from "./context";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import type { FeatureKey } from "@/lib/features";
import { askMessage, can, type Permission } from "@/lib/team/roles";

/**
 * Pages that need more than the Member role start with `const blocked = await pageGate("billing"); if (blocked) return blocked;`.
 * The matching actions and routes check the role again on the server; this only replaces the page with a friendly message.
 */
export async function pageGate(permission: Permission) {
  const { role } = await getAppContext();
  if (can(role, permission)) return null;
  return (
    <>
      <PageHeader title="Not available for your role" description="This part of BuPulse is managed by your company's owner or admins." />
      <EmptyState icon={Lock} title="Ask your company owner" text={askMessage(permission)} />
    </>
  );
}

/**
 * Pages of a plan feature start with `const blocked = await featureGate("autopilot"); if (blocked) return blocked;`:
 * the "Add to your plan" page replaces them when the company's plan lacks the feature (or its service is off).
 * The matching actions and routes call `assertFeature` themselves (lib/entitlements.ts).
 */
export async function featureGate(feature: FeatureKey) {
  const { role, entitlements } = await getAppContext();
  if (entitlements.usable.has(feature)) return null;
  return <AddToPlan feature={feature} reason={entitlements.inPlan.has(feature) ? "service_off" : "not_in_plan"} role={role} inPlan={entitlements.inPlan} />;
}
