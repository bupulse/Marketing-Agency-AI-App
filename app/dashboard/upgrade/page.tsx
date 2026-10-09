import { notFound } from "next/navigation";
import { AddToPlan } from "@/components/app/add-to-plan";
import { getAppContext } from "@/components/app/context";
import { isFeatureKey } from "@/lib/features";

export const metadata = { title: "Add to your plan" };

// Where the sidebar's "Add to your plan" group and requireFeature() send people: what the feature does and how to get it.
export default async function UpgradePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { feature, reason } = await searchParams;
  if (!isFeatureKey(feature)) notFound();
  const { role, entitlements } = await getAppContext();
  const serviceOff = reason === "service_off" || (entitlements.inPlan.has(feature) && !entitlements.usable.has(feature));
  return <AddToPlan feature={feature} reason={serviceOff ? "service_off" : "not_in_plan"} role={role} inPlan={entitlements.inPlan} />;
}
