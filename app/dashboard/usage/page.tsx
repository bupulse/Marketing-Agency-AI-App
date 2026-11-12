import { getAppContext } from "@/components/app/context";
import { UsageView, type UsageRow } from "@/components/billing/usage-view";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Usage" };

export default async function UsagePage() {
  const { usage, isTrial, entitlements, role } = await getAppContext();
  const { used, limits, plan, subscription } = usage;
  const rows: UsageRow[] = [
    { label: "Text generations", unit: "generations", key: "text" as const },
    { label: "AI image credits", unit: "credits", key: "image" as const },
    { label: "Videos", unit: "videos", key: "videos" as const },
    { label: "Voice characters", unit: "characters", key: "voiceCharacters" as const },
    // Video Studio credits (docs/VIDEO_APP_INTEGRATION.md): only for plans with the studio; unused ones do not roll over.
    ...(entitlements.inPlan.has("videoStudio") ? [{ label: "Video Studio credits", unit: "credits", key: "videoCredits" as const }] : []),
  ].map((r) => ({ ...r, used: used[r.key], limit: limits[r.key] }));
  const periodEnd = subscription.currentPeriodEnd;
  const period = isTrial
    ? "What you have used during your free trial."
    : `What you have used this billing period${periodEnd ? `, which ends ${periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.`;

  return <UsageView planName={plan.name} period={period} rows={rows} videosToday={{ used: usage.videosToday, max: usage.videosPerDay }} canBill={can(role, "billing")} />;
}
