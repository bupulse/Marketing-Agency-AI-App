import { notFound } from "next/navigation";
import { AddToPlan } from "@/components/app/add-to-plan";
import { getAppContext } from "@/components/app/context";
import { blockReason } from "@/lib/entitlements";
import { isFeatureKey } from "@/lib/features";

export const metadata = { title: "Add to your plan" };

// Where the sidebar's "Add to your plan" group and requireFeature() send people: what the feature does and how to get it.
export default async function UpgradePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { feature, reason } = await searchParams;
  if (!isFeatureKey(feature)) notFound();
  const { role, entitlements } = await getAppContext();
  // The link's reason wins only while the lookup agrees the feature is not usable; a usable feature is shown as "not in plan" copy anyway.
  const found = entitlements.usable.has(feature) ? "not_in_plan" : blockReason(entitlements, feature);
  return <AddToPlan feature={feature} reason={reason === "service_off" && found !== "plan_unknown" ? "service_off" : found} role={role} inPlan={entitlements.inPlan} />;
}
